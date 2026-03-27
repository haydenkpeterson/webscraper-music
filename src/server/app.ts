import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import type {
  CompareJobEvent,
  CompareLinkRequest,
  CompareHistoryResponse,
  CreatePresetRequest,
  SearchHistoryResponse,
  SearchJobEvent,
  SearchRequest
} from '../shared/types.js';
import { createCompareJobService, type CompareJobService } from './services/compareJobService.js';
import { createCompareService, type CompareService } from './services/compareService.js';
import { listCompareHistory, listSearchHistory } from './services/historyStore.js';
import { createJobScheduler, type JobScheduler } from './services/jobScheduler.js';
import { createSearchJobService, type SearchJobService } from './services/searchJobService.js';
import { createPreset, deletePreset, getPreset, listPresets } from './services/presetStore.js';
import { createSearchService, type SearchService } from './services/searchService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistDir = path.resolve(__dirname, '../client');
const clientIndexPath = path.join(clientDistDir, 'index.html');

function writeSseEvent(response: express.Response, event: SearchJobEvent | CompareJobEvent): void {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function streamJobEvents<T extends SearchJobEvent | CompareJobEvent>(
  req: express.Request,
  res: express.Response,
  job:
    | { id: string; events: T[]; terminal: boolean }
    | undefined,
  subscribe: ((jobId: string, listener: (event: T) => void) => (() => void) | undefined) | undefined,
  notFoundMessage: string
): void {
  if (!job) {
    res.status(404).json({ error: notFoundMessage });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write('retry: 1000\n\n');

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  for (const event of job.events) {
    writeSseEvent(res, event);
  }

  if (job.terminal) {
    clearInterval(heartbeat);
    res.end();
    return;
  }

  const unsubscribe = subscribe?.(job.id, (event) => {
    writeSseEvent(res, event);
    if (event.type === 'completed' || event.type === 'failed') {
      unsubscribe?.();
      clearInterval(heartbeat);
      res.end();
    }
  });

  req.on('close', () => {
    unsubscribe?.();
    clearInterval(heartbeat);
  });
}

export function createApp(options: {
  searchService?: SearchService;
  searchJobService?: SearchJobService;
  compareJobService?: CompareJobService;
  compareService?: CompareService;
  scheduler?: JobScheduler;
} = {}) {
  const app = express();
  const searchService = options.searchService ?? createSearchService();
  const scheduler = options.scheduler ?? createJobScheduler();
  const compareService = options.compareService ?? createCompareService(searchService);
  const searchJobService = options.searchJobService ?? createSearchJobService({ searchService, scheduler });
  const compareJobService = options.compareJobService ?? createCompareJobService({ compareService, scheduler });

  app.use(express.json());

  app.get('/api/presets', async (_req, res) => {
    const presets = await listPresets();
    res.json({ presets });
  });

  app.get('/api/search-history', async (_req, res) => {
    const payload: SearchHistoryResponse = {
      history: await listSearchHistory()
    };
    res.json(payload);
  });

  app.get('/api/compare-history', async (_req, res) => {
    const payload: CompareHistoryResponse = {
      entries: await listCompareHistory()
    };
    res.json(payload);
  });

  app.post('/api/presets', async (req, res) => {
    try {
      const preset = await createPreset(req.body as CreatePresetRequest);
      res.status(201).json({ preset });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create preset.';
      res.status(400).json({ error: message });
    }
  });

  app.delete('/api/presets/:id', async (req, res) => {
    const deleted = await deletePreset(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Preset not found.' });
      return;
    }

    res.status(204).send();
  });

  app.post('/api/search', async (req, res) => {
    const body = req.body as SearchRequest;
    const preset = await getPreset(body?.presetId ?? '');
    if (!preset) {
      res.status(400).json({ error: 'Unknown presetId.' });
      return;
    }

    try {
      const response = await searchService.search(preset, { forceRefresh: Boolean(body.forceRefresh) });
      res.json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected search failure.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/search-jobs', async (req, res) => {
    const body = req.body as SearchRequest;
    const preset = await getPreset(body?.presetId ?? '');
    if (!preset) {
      res.status(400).json({ error: 'Unknown presetId.' });
      return;
    }

    try {
      const response = await searchJobService.start(preset, {
        forceRefresh: Boolean(body.forceRefresh)
      });
      res.status(202).json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create search job.';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/search-jobs/:jobId/events', (req, res) => {
    streamJobEvents(
      req,
      res,
      searchJobService.get(req.params.jobId),
      searchJobService.subscribe.bind(searchJobService),
      'Search job not found.'
    );
  });

  app.post('/api/compare-jobs', async (req, res) => {
    const body = req.body as CompareLinkRequest;
    if (!body?.url) {
      res.status(400).json({ error: 'A listing URL is required.' });
      return;
    }

    try {
      const presets = await listPresets();
      const response = await compareJobService.start(body.url, presets, {
        forceRefresh: Boolean(body.forceRefresh)
      });
      res.status(202).json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create compare job.';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/compare-jobs/:jobId/events', (req, res) => {
    streamJobEvents(
      req,
      res,
      compareJobService.get(req.params.jobId),
      compareJobService.subscribe.bind(compareJobService),
      'Compare job not found.'
    );
  });

  app.post('/api/compare-link', async (req, res) => {
    const body = req.body as CompareLinkRequest;
    if (!body?.url) {
      res.status(400).json({ error: 'A listing URL is required.' });
      return;
    }

    try {
      const presets = await listPresets();
      const response = await compareService.compare(body.url, presets, {
        forceRefresh: Boolean(body.forceRefresh)
      });
      res.json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to compare listing.';
      res.status(500).json({ error: message });
    }
  });

  if (fs.existsSync(clientIndexPath)) {
    app.use(express.static(clientDistDir));
    app.use((_req, res) => {
      res.sendFile(clientIndexPath);
    });
  }

  return app;
}
