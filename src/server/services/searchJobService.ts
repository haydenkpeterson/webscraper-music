import { randomUUID } from 'node:crypto';
import type {
  Preset,
  SearchJobCompletedEvent,
  SearchJobEvent,
  SearchJobFailedEvent,
  SearchJobQueuedEvent,
  SearchJobSourceCompletedEvent,
  SearchJobSourceStartedEvent,
  SearchJobStartResponse,
  SearchJobStartedEvent
} from '../../shared/types.js';
import { SEARCH_JOB_TTL_MS } from '../config.js';
import { createJobScheduler, type JobScheduler } from './jobScheduler.js';
import { createSearchService, type SearchService } from './searchService.js';

type SearchJobRecord = {
  id: string;
  presetId: string;
  events: SearchJobEvent[];
  listeners: Set<(event: SearchJobEvent) => void>;
  cleanupTimer: NodeJS.Timeout | null;
  terminal: boolean;
};

export interface SearchJobService {
  start(preset: Preset, options?: { forceRefresh?: boolean; cacheKey?: string }): Promise<SearchJobStartResponse>;
  get(jobId: string): { id: string; presetId: string; events: SearchJobEvent[]; terminal: boolean } | undefined;
  subscribe(jobId: string, listener: (event: SearchJobEvent) => void): (() => void) | undefined;
}

export interface SearchJobServiceDependencies {
  searchService?: SearchService;
  scheduler?: JobScheduler;
  ttlMs?: number;
}

function isTerminalEvent(event: SearchJobEvent): boolean {
  return event.type === 'completed' || event.type === 'failed';
}

export function createSearchJobService(dependencies: SearchJobServiceDependencies = {}): SearchJobService {
  const searchService = dependencies.searchService ?? createSearchService();
  const scheduler = dependencies.scheduler ?? createJobScheduler();
  const ttlMs = dependencies.ttlMs ?? SEARCH_JOB_TTL_MS;
  const jobs = new Map<string, SearchJobRecord>();

  function touch(job: SearchJobRecord): void {
    if (job.cleanupTimer) {
      clearTimeout(job.cleanupTimer);
    }

    job.cleanupTimer = setTimeout(() => {
      jobs.delete(job.id);
    }, ttlMs);
  }

  function emit(job: SearchJobRecord, event: SearchJobEvent): void {
    job.events.push(event);
    job.terminal = isTerminalEvent(event);
    touch(job);

    for (const listener of job.listeners) {
      listener(event);
    }
  }

  function createJob(presetId: string): SearchJobRecord {
    const job: SearchJobRecord = {
      id: randomUUID(),
      presetId,
      events: [],
      listeners: new Set(),
      cleanupTimer: null,
      terminal: false
    };
    jobs.set(job.id, job);
    touch(job);
    return job;
  }

  return {
    async start(preset, options = {}) {
      const totalSources = preset.sources.length;
      const job = createJob(preset.id);
      const queuedEvent: SearchJobQueuedEvent = {
        type: 'queued',
        at: new Date().toISOString(),
        jobId: job.id,
        presetId: preset.id,
        totalSources,
        forceRefresh: Boolean(options.forceRefresh)
      };
      emit(job, queuedEvent);

      const cachedResponse = !options.forceRefresh
        ? await searchService.peekCached(preset, { cacheKey: options.cacheKey })
        : undefined;
      if (cachedResponse) {
        const startedEvent: SearchJobStartedEvent = {
          type: 'started',
          at: new Date().toISOString(),
          jobId: job.id,
          presetId: preset.id,
          totalSources
        };
        const completedEvent: SearchJobCompletedEvent = {
          type: 'completed',
          at: new Date().toISOString(),
          jobId: job.id,
          presetId: preset.id,
          completedSources: totalSources,
          totalSources,
          cached: true,
          response: cachedResponse
        };
        emit(job, startedEvent);
        emit(job, completedEvent);
        return {
          jobId: job.id,
          cached: true,
          response: cachedResponse
        };
      }

      void scheduler.enqueue(async () => {
        let completedSources = 0;

        try {
          const response = await searchService.search(preset, {
            forceRefresh: options.forceRefresh,
            cacheKey: options.cacheKey,
            onProgress(progressEvent) {
              if (progressEvent.type === 'started') {
                const event: SearchJobStartedEvent = {
                  ...progressEvent,
                  jobId: job.id,
                  presetId: preset.id
                };
                emit(job, event);
                return;
              }

              if (progressEvent.type === 'source_started') {
                const event: SearchJobSourceStartedEvent = {
                  ...progressEvent,
                  jobId: job.id,
                  presetId: preset.id
                };
                emit(job, event);
                return;
              }

              completedSources = progressEvent.completedSources;
              const event: SearchJobSourceCompletedEvent = {
                ...progressEvent,
                jobId: job.id,
                presetId: preset.id
              };
              emit(job, event);
            }
          });

          const completedEvent: SearchJobCompletedEvent = {
            type: 'completed',
            at: new Date().toISOString(),
            jobId: job.id,
            presetId: preset.id,
            completedSources: totalSources,
            totalSources,
            cached: response.cached,
            response
          };
          emit(job, completedEvent);
        } catch (error) {
          const failedEvent: SearchJobFailedEvent = {
            type: 'failed',
            at: new Date().toISOString(),
            jobId: job.id,
            presetId: preset.id,
            completedSources,
            totalSources,
            error: error instanceof Error ? error.message : 'Search job failed.'
          };
          emit(job, failedEvent);
        }
      });

      return { jobId: job.id };
    },

    get(jobId) {
      const job = jobs.get(jobId);
      if (!job) {
        return undefined;
      }

      return {
        id: job.id,
        presetId: job.presetId,
        events: [...job.events],
        terminal: job.terminal
      };
    },

    subscribe(jobId, listener) {
      const job = jobs.get(jobId);
      if (!job) {
        return undefined;
      }

      job.listeners.add(listener);
      touch(job);

      return () => {
        job.listeners.delete(listener);
      };
    }
  };
}
