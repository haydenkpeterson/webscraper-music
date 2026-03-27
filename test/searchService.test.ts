import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { BrowserContext } from 'playwright';
import { describe, expect, it } from 'vitest';
import type { MarketplaceAdapter } from '../src/server/adapters/common';
import { createSearchService } from '../src/server/services/searchService';
import type { Listing, Preset, SearchProgressEvent } from '../src/shared/types';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPreset(): Preset {
  return {
    id: 'test_preset',
    label: 'Test Preset',
    description: 'Test preset',
    category: 'other',
    sources: ['ebay', 'reverb', 'guitarcenter'],
    searchTerms: ['test preset'],
    includeKeywords: ['test'],
    excludeKeywords: []
  };
}

function createListing(source: Listing['source'], title: string, itemPrice: number, shippingPrice: number): Listing {
  return {
    id: `${source}:${title}`,
    source,
    title,
    condition: 'Used',
    itemPrice,
    shippingPrice,
    totalPrice: itemPrice + shippingPrice,
    currency: 'USD',
    location: 'United States',
    url: `https://example.com/${source}/${title}`,
    imageUrl: null,
    fetchedAt: '2026-03-26T00:00:00.000Z',
    shippingLabel: `$${shippingPrice} shipping`,
    localOnly: false,
    distanceMiles: null
  };
}

describe('search service progress', () => {
  it('emits source progress in completion order with accurate counts', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'webscraper-music-search-service-'));
    const previousHistoryPath = process.env.SEARCH_HISTORY_PATH;
    process.env.SEARCH_HISTORY_PATH = path.join(tempDir, 'search-history.json');

    const adapters = {
      ebay: {
        source: 'ebay',
        async search() {
          await delay(25);
          return [createListing('ebay', 'ebay-item', 800, 25)];
        }
      },
      reverb: {
        source: 'reverb',
        async search() {
          await delay(5);
          return [createListing('reverb', 'reverb-item', 700, 15)];
        }
      },
      guitarcenter: {
        source: 'guitarcenter',
        async search() {
          await delay(15);
          return [createListing('guitarcenter', 'gc-item', 900, 0)];
        }
      }
    } satisfies Record<Listing['source'], MarketplaceAdapter>;

    const events: SearchProgressEvent[] = [];
    const searchService = createSearchService({
      adapters,
      async createBrowserSession() {
        return {
          context: {} as BrowserContext,
          async close() {}
        };
      }
    });

    try {
      const response = await searchService.search(createPreset(), {
        forceRefresh: true,
        onProgress(event) {
          events.push(event);
        }
      });

      expect(events[0]?.type).toBe('started');
      expect(events.filter((event) => event.type === 'source_started').map((event) => event.source)).toEqual([
        'ebay',
        'reverb',
        'guitarcenter'
      ]);
      expect(events.filter((event) => event.type === 'source_completed').map((event) => event.source)).toEqual([
        'reverb',
        'guitarcenter',
        'ebay'
      ]);
      expect(
        events
          .filter((event) => event.type === 'source_completed')
          .map((event) => event.completedSources)
      ).toEqual([1, 2, 3]);
      expect(response.results[0]?.source).toBe('reverb');
    } finally {
      if (previousHistoryPath === undefined) {
        delete process.env.SEARCH_HISTORY_PATH;
      } else {
        process.env.SEARCH_HISTORY_PATH = previousHistoryPath;
      }

      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
