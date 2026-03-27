import { randomUUID } from 'node:crypto';
import type {
  CompareJobCompletedEvent,
  CompareJobEvent,
  CompareJobFailedEvent,
  CompareJobQueuedEvent,
  CompareJobSourceCompletedEvent,
  CompareJobSourceStartedEvent,
  CompareJobStageCompletedEvent,
  CompareJobStartResponse,
  CompareJobStartedEvent,
  Preset
} from '../../shared/types.js';
import { SEARCH_JOB_TTL_MS } from '../config.js';
import { createCompareService, type CompareService } from './compareService.js';
import { createJobScheduler, type JobScheduler } from './jobScheduler.js';

type CompareJobRecord = {
  id: string;
  url: string;
  events: CompareJobEvent[];
  listeners: Set<(event: CompareJobEvent) => void>;
  cleanupTimer: NodeJS.Timeout | null;
  terminal: boolean;
};

export interface CompareJobService {
  start(url: string, presets: Preset[], options?: { forceRefresh?: boolean }): Promise<CompareJobStartResponse>;
  get(jobId: string): { id: string; url: string; events: CompareJobEvent[]; terminal: boolean } | undefined;
  subscribe(jobId: string, listener: (event: CompareJobEvent) => void): (() => void) | undefined;
}

export interface CompareJobServiceDependencies {
  compareService?: CompareService;
  scheduler?: JobScheduler;
  ttlMs?: number;
}

function isTerminalEvent(event: CompareJobEvent): boolean {
  return event.type === 'completed' || event.type === 'failed';
}

export function createCompareJobService(dependencies: CompareJobServiceDependencies = {}): CompareJobService {
  const compareService = dependencies.compareService ?? createCompareService();
  const scheduler = dependencies.scheduler ?? createJobScheduler();
  const ttlMs = dependencies.ttlMs ?? SEARCH_JOB_TTL_MS;
  const jobs = new Map<string, CompareJobRecord>();

  function touch(job: CompareJobRecord): void {
    if (job.cleanupTimer) {
      clearTimeout(job.cleanupTimer);
    }

    job.cleanupTimer = setTimeout(() => {
      jobs.delete(job.id);
    }, ttlMs);
  }

  function emit(job: CompareJobRecord, event: CompareJobEvent): void {
    job.events.push(event);
    job.terminal = isTerminalEvent(event);
    touch(job);

    for (const listener of job.listeners) {
      listener(event);
    }
  }

  function createJob(url: string): CompareJobRecord {
    const job: CompareJobRecord = {
      id: randomUUID(),
      url,
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
    async start(url, presets, options = {}) {
      const job = createJob(url);
      const queuedEvent: CompareJobQueuedEvent = {
        type: 'queued',
        at: new Date().toISOString(),
        jobId: job.id,
        url,
        totalUnits: 1,
        forceRefresh: Boolean(options.forceRefresh)
      };
      emit(job, queuedEvent);

      const cachedResponse = !options.forceRefresh ? await compareService.peekCached(url) : undefined;
      if (cachedResponse) {
        const totalUnits = 1 + cachedResponse.derivedPreset.sources.length;
        const startedEvent: CompareJobStartedEvent = {
          type: 'started',
          at: new Date().toISOString(),
          jobId: job.id,
          url,
          totalUnits
        };
        const completedEvent: CompareJobCompletedEvent = {
          type: 'completed',
          at: new Date().toISOString(),
          jobId: job.id,
          url,
          completedUnits: totalUnits,
          totalUnits,
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
        let completedUnits = 0;
        let totalUnits = 1;

        try {
          const response = await compareService.compare(url, presets, {
            forceRefresh: options.forceRefresh,
            onProgress(progressEvent) {
              if (progressEvent.type === 'started') {
                totalUnits = progressEvent.totalUnits;
                const event: CompareJobStartedEvent = {
                  ...progressEvent,
                  jobId: job.id,
                  url
                };
                emit(job, event);
                return;
              }

              if (progressEvent.type === 'stage_completed') {
                completedUnits = progressEvent.completedUnits;
                totalUnits = progressEvent.totalUnits;
                const event: CompareJobStageCompletedEvent = {
                  ...progressEvent,
                  jobId: job.id,
                  url
                };
                emit(job, event);
                return;
              }

              if (progressEvent.type === 'source_started') {
                totalUnits = progressEvent.totalUnits;
                const event: CompareJobSourceStartedEvent = {
                  ...progressEvent,
                  jobId: job.id,
                  url
                };
                emit(job, event);
                return;
              }

              completedUnits = progressEvent.completedUnits;
              totalUnits = progressEvent.totalUnits;
              const event: CompareJobSourceCompletedEvent = {
                ...progressEvent,
                jobId: job.id,
                url
              };
              emit(job, event);
            }
          });

          const completedEvent: CompareJobCompletedEvent = {
            type: 'completed',
            at: new Date().toISOString(),
            jobId: job.id,
            url,
            completedUnits: totalUnits,
            totalUnits,
            cached: response.cached,
            response
          };
          emit(job, completedEvent);
        } catch (error) {
          const failedEvent: CompareJobFailedEvent = {
            type: 'failed',
            at: new Date().toISOString(),
            jobId: job.id,
            url,
            completedUnits,
            totalUnits,
            error: error instanceof Error ? error.message : 'Compare job failed.'
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
        url: job.url,
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
