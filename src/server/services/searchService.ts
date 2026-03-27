import { chromium } from 'playwright';
import type { BrowserContext } from 'playwright';
import { sortListings } from '../../shared/filters.js';
import type {
  Listing,
  MarketplaceSource,
  Preset,
  SearchProgressEvent,
  SearchResponse,
  SourceStatus
} from '../../shared/types.js';
import { ExpiringCache } from '../cache.js';
import { CACHE_TTL_MS } from '../config.js';
import { type MarketplaceAdapter } from '../adapters/common.js';
import { EbayAdapter } from '../adapters/ebay.js';
import { GuitarCenterAdapter } from '../adapters/guitarCenter.js';
import { ReverbAdapter } from '../adapters/reverb.js';
import { getLatestSavedSearchResponse, saveSearchHistory } from './historyStore.js';
import { applyLocalPickupRadius } from './localPickupService.js';

const cache = new ExpiringCache<SearchResponse>(CACHE_TTL_MS);
const defaultAdapters: Record<MarketplaceSource, MarketplaceAdapter> = {
  ebay: new EbayAdapter(),
  reverb: new ReverbAdapter(),
  guitarcenter: new GuitarCenterAdapter()
};

type BrowserSession = {
  context: BrowserContext;
  close: () => Promise<void>;
};

export interface SearchServiceOptions {
  forceRefresh?: boolean;
  cacheKey?: string;
  persistKey?: string | null;
  onProgress?: (event: SearchProgressEvent) => void;
}

export interface SearchService {
  peekCached(
    preset: Preset,
    options?: Pick<SearchServiceOptions, 'cacheKey' | 'persistKey'>
  ): Promise<SearchResponse | undefined>;
  search(preset: Preset, options?: SearchServiceOptions): Promise<SearchResponse>;
}

export interface SearchServiceDependencies {
  adapters?: Record<MarketplaceSource, MarketplaceAdapter>;
  createBrowserSession?: () => Promise<BrowserSession>;
}

function createSummary(results: Listing[]) {
  const bestBySource: Partial<Record<MarketplaceSource, Listing>> = {};
  for (const listing of results) {
    if (!bestBySource[listing.source]) {
      bestBySource[listing.source] = listing;
    }
  }

  return {
    totalResults: results.length,
    bestOverall: results[0] ?? null,
    bestBySource
  };
}

function hydrateCachedResponse(cached: SearchResponse): SearchResponse {
  return {
    ...cached,
    cached: true,
    sourceStatuses: cached.sourceStatuses.map((status) => ({ ...status, cached: true }))
  };
}

async function createDefaultBrowserSession(): Promise<BrowserSession> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'en-US',
    timezoneId: 'America/Denver',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
  });

  return {
    context,
    async close() {
      await context.close();
      await browser.close();
    }
  };
}

export function createSearchService(dependencies: SearchServiceDependencies = {}): SearchService {
  const serviceAdapters = dependencies.adapters ?? defaultAdapters;
  const createBrowserSession = dependencies.createBrowserSession ?? createDefaultBrowserSession;

  async function peekCachedResponse(
    preset: Preset,
    options: Pick<SearchServiceOptions, 'cacheKey' | 'persistKey'> = {}
  ): Promise<SearchResponse | undefined> {
    const cacheKey = options.cacheKey ?? preset.id;
    const cached = cache.get(cacheKey);
    if (cached) {
      return hydrateCachedResponse(cached);
    }

    const persistKey = options.persistKey === undefined ? preset.id : options.persistKey;
    if (!persistKey) {
      return undefined;
    }

    const saved = await getLatestSavedSearchResponse(persistKey);
    if (!saved) {
      return undefined;
    }

    cache.set(cacheKey, saved);
    return hydrateCachedResponse(saved);
  }

  return {
    peekCached(preset, options = {}) {
      return peekCachedResponse(preset, options);
    },
    async search(
      preset: Preset,
      options: SearchServiceOptions = {}
    ): Promise<SearchResponse> {
      const cacheKey = options.cacheKey ?? preset.id;
      const persistKey = options.persistKey === undefined ? preset.id : options.persistKey;
      if (!options.forceRefresh) {
        const cached = await peekCachedResponse(preset, {
          cacheKey,
          persistKey
        });
        if (cached) {
          return cached;
        }
      }

      const browserSession = await createBrowserSession();
      const fetchedAt = new Date().toISOString();
      const totalSources = preset.sources.length;
      let completedSources = 0;

      options.onProgress?.({
        type: 'started',
        at: new Date().toISOString(),
        totalSources
      });

      try {
        const settled = await Promise.all(
          preset.sources.map(async (source) => {
            options.onProgress?.({
              type: 'source_started',
              at: new Date().toISOString(),
              source,
              completedSources,
              totalSources
            });

            const started = performance.now();
            try {
              const listings = await serviceAdapters[source].search(browserSession.context, preset, fetchedAt);
              const filteredListings = await applyLocalPickupRadius(listings, preset);
              const status: SourceStatus = {
                source,
                ok: true,
                count: filteredListings.length,
                durationMs: Math.round(performance.now() - started)
              };
              completedSources += 1;
              options.onProgress?.({
                type: 'source_completed',
                at: new Date().toISOString(),
                source,
                completedSources,
                totalSources,
                status
              });
              return { listings: filteredListings, status };
            } catch (error) {
              const status: SourceStatus = {
                source,
                ok: false,
                count: 0,
                durationMs: Math.round(performance.now() - started),
                message: error instanceof Error ? error.message : 'Scrape failed.'
              };
              completedSources += 1;
              options.onProgress?.({
                type: 'source_completed',
                at: new Date().toISOString(),
                source,
                completedSources,
                totalSources,
                status
              });
              return { listings: [] as Listing[], status };
            }
          })
        );

        const listings = sortListings(settled.flatMap((entry) => entry.listings));
        const response: SearchResponse = {
          preset,
          results: listings,
          summary: createSummary(listings),
          sourceStatuses: settled.map((entry) => entry.status),
          cached: false,
          fetchedAt
        };

        cache.set(cacheKey, response);
        if (persistKey) {
          await saveSearchHistory(persistKey, response);
        }
        return response;
      } finally {
        await browserSession.close();
      }
    }
  };
}
