import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
import {
  commonBlueFinishKeywords,
  commonHxStompExcludes,
  commonTelecasterExcludes,
  DEFAULT_LOCAL_PICKUP_RADIUS_MILES,
  PROVO_HOME_BASE
} from '../../shared/presets.js';
import { compactWhitespace, matchesPresetTitle, parseMoney, parseShipping } from '../../shared/filters.js';
import type {
  ComparableSourceListing,
  CompareHistoryEntry,
  CompareLinkResponse,
  CompareProgressEvent,
  MarketplaceSource,
  Preset
} from '../../shared/types.js';
import { CACHE_TTL_MS } from '../config.js';
import { ExpiringCache } from '../cache.js';
import { loadHtml, parseBodyText } from '../adapters/common.js';
import { parseGuitarCenterDetailHtml } from '../adapters/guitarCenter.js';
import { parseReverbDetailHtml } from '../adapters/reverb.js';
import { getLatestSavedCompareResponse, listCompareHistory, saveCompareHistory } from './historyStore.js';
import { createSearchService, type SearchService } from './searchService.js';

const genericAccessoryExcludes = [
  'case',
  'gig bag',
  'bag',
  'cover',
  'stand',
  'stands',
  'power supply',
  'footswitch',
  'for parts',
  'parts only',
  'repair'
];

const genericStopWords = new Set([
  'the',
  'and',
  'with',
  'used',
  'mint',
  'excellent',
  'very',
  'good',
  'fair',
  'pre',
  'owned',
  'local',
  'pickup',
  'only',
  'guitar',
  'pedal',
  'effects',
  'effect',
  'amp',
  'amplifier'
]);

const genericDescriptorTokens = new Set([
  'present',
  'compact',
  'polyphonic',
  'analog',
  'digital',
  'synth',
  'synthesizer',
  'keyboard',
  'workstation',
  'voice',
  'voices',
  'key',
  'keys',
  'black',
  'white',
  'silver',
  'red',
  'blue',
  'green',
  'grey',
  'gray',
  'natural',
  'walnut',
  'burst',
  'sunburst',
  'edition',
  'limited'
]);

function extractTitleFromHtml(html: string, fallbackUrl: string): string {
  const $ = cheerio.load(html);
  const title =
    compactWhitespace($('meta[property="og:title"]').attr('content') ?? '') ||
    compactWhitespace($('title').text()) ||
    compactWhitespace($('h1').first().text());

  return title.replace(/\s*\|\s*[^|]+$/, '').trim() || fallbackUrl;
}

function sourceFromUrl(url: string): MarketplaceSource | 'unknown' {
  const host = new URL(url).hostname.toLowerCase();
  if (host.includes('reverb.com')) {
    return 'reverb';
  }
  if (host.includes('guitarcenter.com')) {
    return 'guitarcenter';
  }
  if (host.includes('ebay.com')) {
    return 'ebay';
  }
  return 'unknown';
}

function extractGenericComparable(html: string, url: string): ComparableSourceListing {
  const $ = cheerio.load(html);
  const text = parseBodyText(html);
  const title = extractTitleFromHtml(html, url);
  const conditionMatch = text.match(/\b(Mint|Excellent|Very Good|Good|Fair|Used|Pre-Owned)\b/i);
  const shippingMatch = text.match(/(\$[\d,.]+)\s+shipping/i);
  const localOnly = /local pickup/i.test(text);
  const locationMatch = text.match(/([A-Za-z.' -]+,\s*[A-Z]{2}(?:,\s*United States)?)/);

  return {
    source: sourceFromUrl(url),
    title,
    url,
    condition: conditionMatch?.[1] ?? 'Used',
    itemPrice:
      parseMoney($('meta[property="product:price:amount"]').attr('content') ?? '') ??
      parseMoney(text) ??
      null,
    shippingPrice: shippingMatch ? parseShipping(shippingMatch[0]) : null,
    location: locationMatch?.[1] ?? '',
    shippingLabel: localOnly ? 'Local Pickup' : shippingMatch?.[0] ?? null,
    localOnly
  };
}

function extractReverbComparable(html: string, url: string): ComparableSourceListing {
  const $ = cheerio.load(html);
  const detail = parseReverbDetailHtml(html);
  return {
    source: 'reverb',
    title: compactWhitespace($('h1').first().text()) || extractTitleFromHtml(html, url),
    url,
    condition: detail.condition ?? 'Used',
    itemPrice:
      parseMoney($('meta[itemprop="price"]').first().attr('content') ?? '') ??
      parseMoney(textAround($, '.rc-price-block__price')) ??
      null,
    shippingPrice: detail.shippingPrice ?? null,
    location: detail.location ?? '',
    shippingLabel: detail.shippingLabel ?? null,
    localOnly: detail.localOnly ?? false
  };
}

function textAround($: cheerio.CheerioAPI, selector: string): string {
  return compactWhitespace($(selector).first().text());
}

function extractGuitarCenterComparable(html: string, url: string): ComparableSourceListing {
  const $ = cheerio.load(html);
  const detail = parseGuitarCenterDetailHtml(html);
  const jsonLd = $('script[type="application/ld+json"]')
    .toArray()
    .map((element) => $(element).contents().text())
    .find((value) => value.includes('"@type":"Product"'));

  let itemPrice: number | null = null;
  if (jsonLd) {
    try {
      const parsed = JSON.parse(jsonLd) as { offers?: { price?: string } };
      itemPrice = parseMoney(parsed.offers?.price ?? '');
    } catch {
      itemPrice = null;
    }
  }

  return {
    source: 'guitarcenter',
    title: compactWhitespace($('h1').first().text()) || extractTitleFromHtml(html, url),
    url,
    condition: detail.condition ?? 'Used',
    itemPrice,
    shippingPrice: null,
    location: detail.location ?? '',
    shippingLabel: detail.shippingLabel ?? null,
    localOnly: detail.localOnly ?? false
  };
}

function extractEbayComparable(html: string, url: string): ComparableSourceListing {
  return extractGenericComparable(html, url);
}

function normalizeComparableTitle(title: string): string {
  return compactWhitespace(
    title
      .replace(/\s*\|\s*[^|]+$/, '')
      .replace(/\b(used|pre-owned|pre owned|mint|excellent|very good|good|fair|brand new|open box)\b/gi, ' ')
      .replace(/\b(local pickup only|local pickup)\b/gi, ' ')
      .split(/\b(?:with|w\/|includes?|incl\.?|plus)\b/i)[0] ?? title
  );
}

function tokenizeComparableTitle(title: string): string[] {
  return title.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
}

function isDescriptorToken(token: string): boolean {
  return (
    genericStopWords.has(token) ||
    genericDescriptorTokens.has(token) ||
    /^\d{4}$/.test(token) ||
    /^\d+-key$/.test(token) ||
    /^\d+-voice$/.test(token)
  );
}

function cleanDerivedTitle(title: string): string {
  return compactWhitespace(
    title
      .replace(/\b(19|20)\d{2}\b/g, ' ')
      .replace(/\bpresent\b/gi, ' ')
      .replace(/\s*-\s*-\s*/g, ' - ')
      .replace(/\s+-\s+/g, ' - ')
  );
}

function buildBrandModelQuery(title: string): string | null {
  const tokens = tokenizeComparableTitle(title).filter((token) => !isDescriptorToken(token));
  if (!tokens.length) {
    return null;
  }

  const brand = tokens[0];
  if (tokens.length === 1) {
    return brand;
  }

  const modelTokens = [tokens[1]];
  if (tokens[2] && (/^\d+$/.test(tokens[1]) || /^\d+$/.test(tokens[2]) || tokens[2].length <= 6)) {
    modelTokens.push(tokens[2]);
  }

  return [brand, ...modelTokens].join(' ');
}

function detectProductType(title: string): string | null {
  const lower = title.toLowerCase();
  if (lower.includes('synthesizer') || lower.includes('synth')) {
    return 'synthesizer';
  }
  if (lower.includes('keyboard')) {
    return 'keyboard';
  }
  if (lower.includes('pedal') || lower.includes('stomp') || lower.includes('overdrive') || lower.includes('distortion')) {
    return 'pedal';
  }
  if (lower.includes('guitar')) {
    return 'guitar';
  }
  if (lower.includes('bass')) {
    return 'bass';
  }
  if (lower.includes('amp') || lower.includes('amplifier') || lower.includes('combo') || lower.includes('head')) {
    return 'amp';
  }

  return null;
}

function buildGenericKeywords(title: string): string[] {
  const brandModelQuery = buildBrandModelQuery(title);
  if (brandModelQuery) {
    const [brand, ...modelTokens] = brandModelQuery.split(' ');
    if (brand && modelTokens.length) {
      return [brand, modelTokens.join(' ')];
    }

    if (brand) {
      return [brand];
    }
  }

  const tokens = tokenizeComparableTitle(title).filter((token) => token.length > 1 && !isDescriptorToken(token));

  const keywords: string[] = [];
  if (tokens[0]) {
    keywords.push(tokens[0]);
  }

  const distinctive = tokens.find((token, index) => index > 0 && (/\d/.test(token) || token.length >= 5));
  if (distinctive && !keywords.includes(distinctive)) {
    keywords.push(distinctive);
  }

  if (!keywords.length && tokens[0]) {
    keywords.push(tokens[0]);
  }

  return keywords;
}

function buildGenericSearchTerms(title: string): string[] {
  const brandModelQuery = buildBrandModelQuery(title);
  const productType = detectProductType(title);
  const searchTerms = [brandModelQuery, productType && brandModelQuery ? `${brandModelQuery} ${productType}` : null, title]
    .filter((value): value is string => Boolean(value))
    .map((value) => compactWhitespace(value));

  return [...new Set(searchTerms)];
}

function buildGenericExcludeKeywords(title: string): string[] {
  const lower = title.toLowerCase();
  const excludes = [...genericAccessoryExcludes];

  if (!lower.includes('module')) {
    excludes.push('module');
  }

  if (!lower.includes('desktop')) {
    excludes.push('desktop');
  }

  if (!lower.includes('rack')) {
    excludes.push('rack');
    excludes.push('rackmount');
  }

  return [...new Set(excludes)];
}

export function buildDerivedPreset(title: string): Preset {
  const cleanedTitle = normalizeComparableTitle(title);
  const lower = cleanedTitle.toLowerCase();

  if (lower.includes('fender') && lower.includes('telecaster')) {
    return {
      id: 'compare_blue_fender_telecaster',
      label: cleanedTitle,
      description: 'Derived from pasted listing URL.',
      category: 'guitar',
      sources: ['ebay', 'reverb', 'guitarcenter'],
      searchTerms: [cleanedTitle, 'fender telecaster'],
      includeKeywords: ['fender', 'telecaster'],
      excludeKeywords: commonTelecasterExcludes,
      blueFinishKeywords: commonBlueFinishKeywords,
      localPickupRadiusMiles: DEFAULT_LOCAL_PICKUP_RADIUS_MILES,
      homeBaseLabel: PROVO_HOME_BASE
    };
  }

  if (lower.includes('line 6') && lower.includes('hx stomp')) {
    return {
      id: 'compare_line6_hx_stomp',
      label: cleanedTitle,
      description: 'Derived from pasted listing URL.',
      category: 'effects',
      sources: ['ebay', 'reverb', 'guitarcenter'],
      searchTerms: [cleanedTitle, 'line 6 hx stomp'],
      includeKeywords: ['line 6', 'hx stomp'],
      excludeKeywords: commonHxStompExcludes,
      localPickupRadiusMiles: DEFAULT_LOCAL_PICKUP_RADIUS_MILES,
      homeBaseLabel: PROVO_HOME_BASE
    };
  }

  const trimmedTitle = cleanDerivedTitle(cleanedTitle);
  const genericKeywords = buildGenericKeywords(trimmedTitle);
  const searchTerms = buildGenericSearchTerms(trimmedTitle);
  const excludeKeywords = buildGenericExcludeKeywords(trimmedTitle);

  return {
    id: `compare_${trimmedTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)}`,
    label: trimmedTitle,
    description: 'Derived from pasted listing URL.',
    category: lower.includes('pedal') || lower.includes('stomp') ? 'effects' : lower.includes('guitar') ? 'guitar' : 'other',
    sources: ['ebay', 'reverb', 'guitarcenter'],
    searchTerms,
    includeKeywords: genericKeywords,
    excludeKeywords,
    localPickupRadiusMiles: DEFAULT_LOCAL_PICKUP_RADIUS_MILES,
    homeBaseLabel: PROVO_HOME_BASE
  };
}

const compareCache = new ExpiringCache<CompareLinkResponse>(CACHE_TTL_MS);

function hydrateCachedCompareResponse(response: CompareLinkResponse): CompareLinkResponse {
  return {
    ...response,
    cached: true,
    search: {
      ...response.search,
      cached: true,
      sourceStatuses: response.search.sourceStatuses.map((status) => ({ ...status, cached: true }))
    }
  };
}

export function normalizeCompareUrl(url: string): string {
  const parsedUrl = new URL(url);
  parsedUrl.hash = '';
  return parsedUrl.toString();
}

export interface CompareServiceOptions {
  forceRefresh?: boolean;
  onProgress?: (event: CompareProgressEvent) => void;
}

export interface CompareService {
  peekCached(url: string): Promise<CompareLinkResponse | undefined>;
  listHistory(url?: string): Promise<CompareHistoryEntry[]>;
  compare(url: string, presets: Preset[], options?: CompareServiceOptions): Promise<CompareLinkResponse>;
}

export function createCompareService(searchService: SearchService = createSearchService()): CompareService {
  async function peekCachedResponse(url: string): Promise<CompareLinkResponse | undefined> {
    const normalizedUrl = normalizeCompareUrl(url);
    const cached = compareCache.get(normalizedUrl);
    if (cached) {
      return hydrateCachedCompareResponse(cached);
    }

    const saved = await getLatestSavedCompareResponse(normalizedUrl);
    if (!saved) {
      return undefined;
    }

    compareCache.set(normalizedUrl, saved);
    return hydrateCachedCompareResponse(saved);
  }

  return {
    peekCached(url) {
      return peekCachedResponse(url);
    },

    listHistory(url) {
      return listCompareHistory(url);
    },

    async compare(url: string, presets: Preset[], options: CompareServiceOptions = {}): Promise<CompareLinkResponse> {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(normalizeCompareUrl(url));
      } catch {
        throw new Error('Enter a valid listing URL.');
      }

      if (!options.forceRefresh) {
        const cached = await peekCachedResponse(parsedUrl.toString());
        if (cached) {
          return cached;
        }
      }

      options.onProgress?.({
        type: 'started',
        at: new Date().toISOString(),
        totalUnits: 1
      });

      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        locale: 'en-US',
        timezoneId: 'America/Denver',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
      });

      try {
        const html = await loadHtml(context, parsedUrl.toString(), { delayMs: 1500 });
        const source = sourceFromUrl(parsedUrl.toString());
        const sourceListing =
          source === 'reverb'
            ? extractReverbComparable(html, parsedUrl.toString())
            : source === 'guitarcenter'
              ? extractGuitarCenterComparable(html, parsedUrl.toString())
              : source === 'ebay'
                ? extractEbayComparable(html, parsedUrl.toString())
                : extractGenericComparable(html, parsedUrl.toString());

        const matchedPreset = presets.find((preset) => matchesPresetTitle(sourceListing.title, preset));
        const derivedPreset = matchedPreset ?? buildDerivedPreset(sourceListing.title);
        const totalUnits = 1 + derivedPreset.sources.length;

        options.onProgress?.({
          type: 'stage_completed',
          at: new Date().toISOString(),
          stage: 'fetch_listing',
          completedUnits: 1,
          totalUnits,
          derivedPreset
        });

        const search = await searchService.search(derivedPreset, {
          forceRefresh: options.forceRefresh,
          cacheKey: `compare:${parsedUrl.toString()}`,
          persistKey: null,
          onProgress(progressEvent) {
            if (progressEvent.type === 'source_started') {
              options.onProgress?.({
                type: 'source_started',
                at: progressEvent.at,
                source: progressEvent.source,
                completedUnits: 1 + progressEvent.completedSources,
                totalUnits
              });
              return;
            }

            if (progressEvent.type === 'source_completed') {
              options.onProgress?.({
                type: 'source_completed',
                at: progressEvent.at,
                source: progressEvent.source,
                completedUnits: 1 + progressEvent.completedSources,
                totalUnits,
                status: progressEvent.status
              });
            }
          }
        });

        const response: CompareLinkResponse = {
          sourceListing,
          derivedPreset,
          search,
          cached: false
        };

        compareCache.set(parsedUrl.toString(), response);
        await saveCompareHistory(parsedUrl.toString(), response);
        return response;
      } finally {
        await context.close();
        await browser.close();
      }
    }
  };
}
