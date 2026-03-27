import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app';
import type { SearchJobEvent, SearchResponse } from '../src/shared/types';
import type { SearchService } from '../src/server/services/searchService';

function createPreset() {
  return {
    id: 'blue_fender_telecaster',
    label: 'Blue Fender Telecaster',
    description: 'Blue Telecaster preset',
    category: 'guitar' as const,
    sources: ['ebay', 'reverb', 'guitarcenter'] as const,
    searchTerms: ['fender telecaster blue'],
    includeKeywords: ['fender', 'telecaster'],
    excludeKeywords: ['squier'],
    blueFinishKeywords: ['blue']
  };
}

function createSearchResponse(overrides: Partial<SearchResponse> = {}): SearchResponse {
  const preset = createPreset();

  return {
    preset,
    results: [
      {
        id: 'ebay:https://example.com/item',
        source: 'ebay',
        title: 'Fender Telecaster Pelham Blue',
        condition: 'Used',
        itemPrice: 799,
        shippingPrice: 49,
        totalPrice: 848,
        currency: 'USD',
        location: 'United States',
        url: 'https://example.com/item',
        imageUrl: null,
        fetchedAt: '2026-03-26T00:00:00.000Z',
        shippingLabel: '$49 shipping',
        localOnly: false,
        distanceMiles: null
      }
    ],
    summary: {
      totalResults: 1,
      bestOverall: {
        id: 'ebay:https://example.com/item',
        source: 'ebay',
        title: 'Fender Telecaster Pelham Blue',
        condition: 'Used',
        itemPrice: 799,
        shippingPrice: 49,
        totalPrice: 848,
        currency: 'USD',
        location: 'United States',
        url: 'https://example.com/item',
        imageUrl: null,
        fetchedAt: '2026-03-26T00:00:00.000Z',
        shippingLabel: '$49 shipping',
        localOnly: false,
        distanceMiles: null
      },
      bestBySource: {}
    },
    sourceStatuses: [
      { source: 'ebay', ok: true, count: 1, durationMs: 100 },
      { source: 'reverb', ok: true, count: 0, durationMs: 110 },
      { source: 'guitarcenter', ok: true, count: 0, durationMs: 120 }
    ],
    cached: false,
    fetchedAt: '2026-03-26T00:00:00.000Z',
    ...overrides
  };
}

function parseSseEvents(payload: string): SearchJobEvent[] {
  return payload
    .split('\n\n')
    .map((chunk) =>
      chunk
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('\n')
    )
    .filter(Boolean)
    .map((chunk) => JSON.parse(chunk) as SearchJobEvent);
}

async function withTestServer(searchService: SearchService) {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'webscraper-music-'));
  const storePath = path.join(tempDir, 'presets.json');
  const previousStorePath = process.env.PRESET_STORE_PATH;
  process.env.PRESET_STORE_PATH = storePath;
  await writeFile(storePath, `${JSON.stringify([createPreset()], null, 2)}\n`, 'utf8');

  const app = createApp({ searchService });
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const started = app.listen(0, () => resolve(started));
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to bind test server.');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async cleanup() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      if (previousStorePath === undefined) {
        delete process.env.PRESET_STORE_PATH;
      } else {
        process.env.PRESET_STORE_PATH = previousStorePath;
      }

      await rm(tempDir, { recursive: true, force: true });
    }
  };
}

describe('search job api', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) {
      const cleanup = cleanups.pop();
      await cleanup?.();
    }
  });

  it('streams queued, progress, and completed events for a search job', async () => {
    const searchResponse = createSearchResponse();
    const searchService: SearchService = {
      peekCached() {
        return undefined;
      },
      async search(_preset, options = {}) {
        options.onProgress?.({
          type: 'started',
          at: '2026-03-26T00:00:00.000Z',
          totalSources: 3
        });
        options.onProgress?.({
          type: 'source_started',
          at: '2026-03-26T00:00:01.000Z',
          source: 'ebay',
          completedSources: 0,
          totalSources: 3
        });
        options.onProgress?.({
          type: 'source_completed',
          at: '2026-03-26T00:00:02.000Z',
          source: 'ebay',
          completedSources: 1,
          totalSources: 3,
          status: { source: 'ebay', ok: true, count: 1, durationMs: 100 }
        });
        return searchResponse;
      }
    };

    const { baseUrl, cleanup } = await withTestServer(searchService);
    cleanups.push(cleanup);

    const startResponse = await fetch(`${baseUrl}/api/search-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presetId: 'blue_fender_telecaster', forceRefresh: false })
    });
    expect(startResponse.status).toBe(202);
    const startedPayload = (await startResponse.json()) as { jobId: string };

    const eventsResponse = await fetch(`${baseUrl}/api/search-jobs/${startedPayload.jobId}/events`);
    const events = parseSseEvents(await eventsResponse.text());

    expect(events.map((event) => event.type)).toEqual([
      'queued',
      'started',
      'source_started',
      'source_completed',
      'completed'
    ]);
    expect(events.at(-1)?.type).toBe('completed');
  });

  it('includes failed source statuses in the progress stream and final response', async () => {
    const searchResponse = createSearchResponse({
      sourceStatuses: [
        { source: 'ebay', ok: true, count: 1, durationMs: 100 },
        { source: 'reverb', ok: false, count: 0, durationMs: 220, message: 'Blocked' },
        { source: 'guitarcenter', ok: true, count: 0, durationMs: 120 }
      ]
    });

    const searchService: SearchService = {
      peekCached() {
        return undefined;
      },
      async search(_preset, options = {}) {
        options.onProgress?.({
          type: 'started',
          at: '2026-03-26T00:00:00.000Z',
          totalSources: 3
        });
        options.onProgress?.({
          type: 'source_started',
          at: '2026-03-26T00:00:01.000Z',
          source: 'reverb',
          completedSources: 0,
          totalSources: 3
        });
        options.onProgress?.({
          type: 'source_completed',
          at: '2026-03-26T00:00:02.000Z',
          source: 'reverb',
          completedSources: 1,
          totalSources: 3,
          status: { source: 'reverb', ok: false, count: 0, durationMs: 220, message: 'Blocked' }
        });
        return searchResponse;
      }
    };

    const { baseUrl, cleanup } = await withTestServer(searchService);
    cleanups.push(cleanup);

    const startResponse = await fetch(`${baseUrl}/api/search-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presetId: 'blue_fender_telecaster', forceRefresh: false })
    });
    const startedPayload = (await startResponse.json()) as { jobId: string };

    const eventsResponse = await fetch(`${baseUrl}/api/search-jobs/${startedPayload.jobId}/events`);
    const events = parseSseEvents(await eventsResponse.text());
    const failedSourceEvent = events.find((event) => event.type === 'source_completed');
    const completedEvent = events.find((event) => event.type === 'completed');

    expect(failedSourceEvent && failedSourceEvent.type === 'source_completed' ? failedSourceEvent.status.ok : true).toBe(
      false
    );
    expect(completedEvent && completedEvent.type === 'completed'
      ? completedEvent.response.sourceStatuses.some((status) => !status.ok)
      : false).toBe(true);
  });

  it('returns cached results immediately and records terminal events', async () => {
    const cachedResponse = createSearchResponse({ cached: true });
    const searchService: SearchService = {
      peekCached() {
        return cachedResponse;
      },
      async search() {
        throw new Error('search should not run for cached jobs');
      }
    };

    const { baseUrl, cleanup } = await withTestServer(searchService);
    cleanups.push(cleanup);

    const startResponse = await fetch(`${baseUrl}/api/search-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presetId: 'blue_fender_telecaster', forceRefresh: false })
    });
    expect(startResponse.status).toBe(202);
    const startedPayload = (await startResponse.json()) as { jobId: string; cached?: boolean; response?: SearchResponse };
    expect(startedPayload.cached).toBe(true);
    expect(startedPayload.response?.cached).toBe(true);

    const eventsResponse = await fetch(`${baseUrl}/api/search-jobs/${startedPayload.jobId}/events`);
    const events = parseSseEvents(await eventsResponse.text());

    expect(events.map((event) => event.type)).toEqual(['queued', 'started', 'completed']);
  });
});
