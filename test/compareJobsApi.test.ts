import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app';
import type { CompareJobEvent, CompareLinkResponse, Preset } from '../src/shared/types';
import type { CompareService } from '../src/server/services/compareService';

function createPreset(): Preset {
  return {
    id: 'blue_fender_telecaster',
    label: 'Blue Fender Telecaster',
    description: 'Blue Telecaster preset',
    category: 'guitar',
    sources: ['ebay', 'reverb', 'guitarcenter'],
    searchTerms: ['fender telecaster blue'],
    includeKeywords: ['fender', 'telecaster'],
    excludeKeywords: ['squier'],
    blueFinishKeywords: ['blue']
  };
}

function createCompareResponse(): CompareLinkResponse {
  return {
    sourceListing: {
      source: 'reverb',
      title: 'Sequential Take 5',
      url: 'https://reverb.com/item/test-sequential-take-5',
      condition: 'Used',
      itemPrice: 1000,
      shippingPrice: 100,
      location: 'United States',
      shippingLabel: '$100 shipping',
      localOnly: false
    },
    derivedPreset: {
      id: 'compare_sequential_take_5',
      label: 'Sequential Take 5',
      description: 'Derived preset',
      category: 'other',
      sources: ['ebay', 'reverb', 'guitarcenter'],
      searchTerms: ['sequential take 5'],
      includeKeywords: ['sequential', 'take 5'],
      excludeKeywords: ['stand']
    },
    search: {
      preset: {
        id: 'compare_sequential_take_5',
        label: 'Sequential Take 5',
        description: 'Derived preset',
        category: 'other',
        sources: ['ebay', 'reverb', 'guitarcenter'],
        searchTerms: ['sequential take 5'],
        includeKeywords: ['sequential', 'take 5'],
        excludeKeywords: ['stand']
      },
      results: [],
      summary: {
        totalResults: 0,
        bestOverall: null,
        bestBySource: {}
      },
      sourceStatuses: [],
      cached: false,
      fetchedAt: '2026-03-26T00:00:00.000Z'
    },
    cached: false
  };
}

function parseSseEvents(payload: string): CompareJobEvent[] {
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
    .map((chunk) => JSON.parse(chunk) as CompareJobEvent);
}

async function withTestServer(compareService: CompareService) {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'webscraper-music-compare-'));
  const storePath = path.join(tempDir, 'presets.json');
  const previousStorePath = process.env.PRESET_STORE_PATH;
  process.env.PRESET_STORE_PATH = storePath;
  await writeFile(storePath, `${JSON.stringify([createPreset()], null, 2)}\n`, 'utf8');

  const app = createApp({ compareService });
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

describe('compare job api', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) {
      await cleanups.pop()?.();
    }
  });

  it('streams queued, stage progress, and completion events for a compare job', async () => {
    const compareResponse = createCompareResponse();
    const compareService: CompareService = {
      async peekCached() {
        return undefined;
      },
      async listHistory() {
        return [];
      },
      async compare(url, _presets, options = {}) {
        options.onProgress?.({
          type: 'started',
          at: '2026-03-26T00:00:00.000Z',
          totalUnits: 1
        });
        options.onProgress?.({
          type: 'stage_completed',
          at: '2026-03-26T00:00:01.000Z',
          stage: 'fetch_listing',
          completedUnits: 1,
          totalUnits: 4,
          derivedPreset: compareResponse.derivedPreset
        });
        options.onProgress?.({
          type: 'source_started',
          at: '2026-03-26T00:00:02.000Z',
          source: 'reverb',
          completedUnits: 1,
          totalUnits: 4
        });
        options.onProgress?.({
          type: 'source_completed',
          at: '2026-03-26T00:00:03.000Z',
          source: 'reverb',
          completedUnits: 2,
          totalUnits: 4,
          status: { source: 'reverb', ok: true, count: 1, durationMs: 125 }
        });
        expect(url).toBe('https://reverb.com/item/test-sequential-take-5');
        return compareResponse;
      }
    };

    const { baseUrl, cleanup } = await withTestServer(compareService);
    cleanups.push(cleanup);

    const startResponse = await fetch(`${baseUrl}/api/compare-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://reverb.com/item/test-sequential-take-5', forceRefresh: false })
    });
    expect(startResponse.status).toBe(202);
    const startedPayload = (await startResponse.json()) as { jobId: string };

    const eventsResponse = await fetch(`${baseUrl}/api/compare-jobs/${startedPayload.jobId}/events`);
    const events = parseSseEvents(await eventsResponse.text());

    expect(events.map((event) => event.type)).toEqual([
      'queued',
      'started',
      'stage_completed',
      'source_started',
      'source_completed',
      'completed'
    ]);
    expect(events.at(-1)?.type).toBe('completed');
  });
});
