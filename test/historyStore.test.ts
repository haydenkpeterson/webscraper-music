import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getLatestSavedCompareResponse,
  getLatestSavedSearchResponse,
  listCompareHistory,
  listSearchHistoryForPreset,
  saveCompareHistory,
  saveSearchHistory
} from '../src/server/services/historyStore';
import type { CompareLinkResponse, SearchResponse } from '../src/shared/types';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) {
    await cleanups.pop()?.();
  }
});

function createSearchResponse(fetchedAt: string): SearchResponse {
  return {
    preset: {
      id: 'blue_fender_telecaster',
      label: 'Blue Fender Telecaster',
      description: 'Blue Telecaster preset',
      category: 'guitar',
      sources: ['ebay', 'reverb', 'guitarcenter'],
      searchTerms: ['fender telecaster blue'],
      includeKeywords: ['fender', 'telecaster'],
      excludeKeywords: ['squier'],
      blueFinishKeywords: ['blue']
    },
    results: [],
    summary: {
      totalResults: 0,
      bestOverall: null,
      bestBySource: {}
    },
    sourceStatuses: [],
    cached: false,
    fetchedAt
  };
}

function createCompareResponse(fetchedAt: string): CompareLinkResponse {
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
    search: createSearchResponse(fetchedAt),
    cached: false
  };
}

async function withTempHistoryFiles() {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'webscraper-music-history-'));
  const previousSearchPath = process.env.SEARCH_HISTORY_PATH;
  const previousComparePath = process.env.COMPARE_HISTORY_PATH;
  process.env.SEARCH_HISTORY_PATH = path.join(tempDir, 'search-history.json');
  process.env.COMPARE_HISTORY_PATH = path.join(tempDir, 'compare-history.json');

  cleanups.push(async () => {
    if (previousSearchPath === undefined) {
      delete process.env.SEARCH_HISTORY_PATH;
    } else {
      process.env.SEARCH_HISTORY_PATH = previousSearchPath;
    }

    if (previousComparePath === undefined) {
      delete process.env.COMPARE_HISTORY_PATH;
    } else {
      process.env.COMPARE_HISTORY_PATH = previousComparePath;
    }

    await rm(tempDir, { recursive: true, force: true });
  });
}

describe('history store', () => {
  it('persists the latest fresh search response and trims old history', async () => {
    await withTempHistoryFiles();
    const baseTime = Date.now();

    for (let index = 0; index < 12; index += 1) {
      const fetchedAt = new Date(baseTime + index * 60_000).toISOString();
      await saveSearchHistory('blue_fender_telecaster', createSearchResponse(fetchedAt));
    }

    const entries = await listSearchHistoryForPreset('blue_fender_telecaster');
    const latest = await getLatestSavedSearchResponse('blue_fender_telecaster');

    expect(entries).toHaveLength(10);
    expect(entries[0]?.response.fetchedAt).toBe(new Date(baseTime + 11 * 60_000).toISOString());
    expect(latest?.fetchedAt).toBe(new Date(baseTime + 11 * 60_000).toISOString());
  });

  it('persists compare history and returns the latest fresh compare response', async () => {
    await withTempHistoryFiles();

    const response = createCompareResponse(new Date().toISOString());
    await saveCompareHistory('https://reverb.com/item/test-sequential-take-5', response);

    const entries = await listCompareHistory();
    const latest = await getLatestSavedCompareResponse('https://reverb.com/item/test-sequential-take-5');

    expect(entries).toHaveLength(1);
    expect(entries[0]?.response.derivedPreset.label).toBe('Sequential Take 5');
    expect(latest?.sourceListing.url).toBe('https://reverb.com/item/test-sequential-take-5');
  });
});
