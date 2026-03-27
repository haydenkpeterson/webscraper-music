import * as cheerio from 'cheerio';
import type { BrowserContext, Page } from 'playwright';
import type { Listing, MarketplaceSource, Preset } from '../../shared/types.js';
import {
  compactWhitespace,
  computeTotalPrice,
  createListingId,
  detailMatchesBlue,
  isUsedConditionText,
  matchesPresetTitle,
  needsBlueVerification
} from '../../shared/filters.js';
import { MAX_BLUE_DETAIL_CHECKS, REQUEST_TIMEOUT_MS } from '../config.js';

export interface CandidateListing {
  title: string;
  url: string;
  condition: string;
  itemPrice: number;
  shippingPrice: number | null;
  currency: string;
  location: string;
  imageUrl: string | null;
  shippingLabel?: string | null;
  localOnly?: boolean;
}

export interface DetailData {
  text: string;
  condition?: string;
  location?: string;
  shippingPrice?: number | null;
  shippingLabel?: string | null;
  localOnly?: boolean;
}

export interface MarketplaceAdapter {
  readonly source: MarketplaceSource;
  search(context: BrowserContext, preset: Preset, fetchedAt: string): Promise<Listing[]>;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

export async function createPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  page.setDefaultTimeout(REQUEST_TIMEOUT_MS);
  await page.setExtraHTTPHeaders({
    'accept-language': 'en-US,en;q=0.9'
  });
  return page;
}

export async function loadHtml(
  context: BrowserContext,
  url: string,
  options?: { waitForSelector?: string; delayMs?: number }
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const page = await createPage(context);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT_MS });
      if (options?.waitForSelector) {
        await page.locator(options.waitForSelector).first().waitFor({ timeout: REQUEST_TIMEOUT_MS });
      }
      if (options?.delayMs) {
        await page.waitForTimeout(options.delayMs);
      }
      return await page.content();
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || !/timeout/i.test(error.message) || attempt === 1) {
        throw error;
      }
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Unable to load ${url}`);
}

export async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      'accept-language': 'en-US,en;q=0.9'
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status} for ${url}`);
  }

  return await response.text();
}

export function parseBodyText(html: string): string {
  const $ = cheerio.load(html);
  return compactWhitespace($('body').text());
}

export function absoluteUrl(baseUrl: string, value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value, baseUrl);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!items.length) {
    return [];
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

export async function finalizeCandidates(
  candidates: CandidateListing[],
  preset: Preset,
  source: MarketplaceSource,
  fetchedAt: string,
  detailLoader?: (candidate: CandidateListing) => Promise<DetailData | null>,
  options?: { detailConcurrency?: number }
): Promise<Listing[]> {
  const matchingCandidates = candidates.filter((candidate) => matchesPresetTitle(candidate.title, preset));
  let blueChecks = 0;

  const detailPlans = matchingCandidates.map((candidate) => {
    const shouldLoadForBlue = needsBlueVerification(candidate.title, preset);
    const needsDetail = Boolean(detailLoader && (!candidate.location || !candidate.condition || shouldLoadForBlue));
    let loadDetail = false;

    if (needsDetail && detailLoader) {
      if (!shouldLoadForBlue || blueChecks < MAX_BLUE_DETAIL_CHECKS) {
        loadDetail = true;
        if (shouldLoadForBlue) {
          blueChecks += 1;
        }
      }
    }

    return { candidate, loadDetail };
  });

  const detailResults = await runWithConcurrency(
    detailPlans,
    options?.detailConcurrency ?? 1,
    async ({ candidate, loadDetail }) => {
      if (!loadDetail || !detailLoader) {
        return null;
      }
      return detailLoader(candidate);
    }
  );

  const accepted: Listing[] = [];

  for (const [index, candidate] of matchingCandidates.entries()) {
    const detail = detailResults[index];
    let condition = candidate.condition || 'Used';
    let location = candidate.location;
    let shippingPrice = candidate.shippingPrice;
    let shippingLabel = candidate.shippingLabel ?? null;
    let localOnly = Boolean(candidate.localOnly);
    let detailText = '';

    if (detail) {
      detailText = detail.text;
      condition = detail.condition ?? condition;
      location = detail.location ?? location;
      if (detail.shippingPrice !== undefined) {
        shippingPrice = detail.shippingPrice;
      }
      if (detail.shippingLabel !== undefined) {
        shippingLabel = detail.shippingLabel;
      }
      if (detail.localOnly !== undefined) {
        localOnly = detail.localOnly;
      }
    }

    if (!isUsedConditionText(condition)) {
      continue;
    }

    if (needsBlueVerification(candidate.title, preset) && !detailMatchesBlue(detailText, preset)) {
      continue;
    }

    accepted.push({
      id: createListingId(source, candidate.url),
      source,
      title: candidate.title,
      condition,
      itemPrice: candidate.itemPrice,
      shippingPrice,
      totalPrice: computeTotalPrice(candidate.itemPrice, shippingPrice),
      currency: candidate.currency,
      location,
      url: candidate.url,
      imageUrl: candidate.imageUrl,
      fetchedAt,
      shippingLabel,
      localOnly,
      distanceMiles: null
    });
  }

  return accepted;
}
