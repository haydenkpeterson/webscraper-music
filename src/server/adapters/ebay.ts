import * as cheerio from 'cheerio';
import type { BrowserContext } from 'playwright';
import { compactWhitespace, parseMoney, parseShipping } from '../../shared/filters.js';
import type { Listing, Preset } from '../../shared/types.js';
import { ADAPTER_DETAIL_PAGE_CONCURRENCY, ADAPTER_SEARCH_PAGE_CONCURRENCY } from '../config.js';
import {
  finalizeCandidates,
  fetchHtml,
  parseBodyText,
  runWithConcurrency,
  type CandidateListing,
  type DetailData,
  type MarketplaceAdapter
} from './common.js';

const EBAY_BASE_URL = 'https://www.ebay.com';

function pickFirstText($: cheerio.CheerioAPI, element: Parameters<cheerio.CheerioAPI>[0], selectors: string[]): string {
  for (const selector of selectors) {
    const value = compactWhitespace($(element).find(selector).first().text());
    if (value) {
      return value;
    }
  }

  return '';
}

function extractFallbackCurrencyText(cardText: string): string {
  const match = cardText.match(/(?:US\s*)?\$\d[\d,]*(?:\.\d{2})?(?:\s+to\s+(?:US\s*)?\$\d[\d,]*(?:\.\d{2})?)?/i);
  return compactWhitespace(match?.[0] ?? '');
}

function extractLocation(cardText: string, locationText: string): string {
  const normalizedLocation = compactWhitespace(locationText.replace(/^Located in\s*/i, ''));
  if (normalizedLocation) {
    return normalizedLocation;
  }

  const locationMatch = cardText.match(/Located in\s+(.+?)(?=(?:\s+(?:Seller|Shop|Top Rated|Sponsored|See details|Opens in a new window|Pre-Owned|Used|Brand New|Open box|For parts))|$)/i);
  const fallbackLocation = compactWhitespace(locationMatch?.[1] ?? '');
  const unitedStatesIndex = fallbackLocation.indexOf('United States');
  if (unitedStatesIndex >= 0) {
    return fallbackLocation.slice(0, unitedStatesIndex + 'United States'.length).trim();
  }

  return fallbackLocation;
}

function buildSearchUrls(preset: Preset): string[] {
  return preset.searchTerms.map((query) => {
    const url = new URL('/sch/i.html', EBAY_BASE_URL);
    url.searchParams.set('_nkw', query);
    url.searchParams.set('_sop', '15');
    url.searchParams.set('LH_ItemCondition', '3000');
    url.searchParams.set('LH_PrefLoc', '1');
    return url.toString();
  });
}

export function parseEbaySearchHtml(html: string): CandidateListing[] {
  const $ = cheerio.load(html);
  const candidates: CandidateListing[] = [];

  $('ul.srp-results li.s-card, ul.srp-results li.s-item').each((_, element) => {
    const href = $(element).find('a[href*="/itm/"]').first().attr('href');
    const url = href ? new URL(href, EBAY_BASE_URL).toString() : null;
    const cardText = compactWhitespace($(element).text());
    if (!url || !cardText) {
      return;
    }

    const titleText =
      pickFirstText($, element, ['.s-item__title', '.s-card__title', '[role="heading"]']) ||
      compactWhitespace(cardText.split('Opens in a new window or tab')[0] ?? cardText);
    const title = compactWhitespace(titleText.replace(/^New Listing\s*/i, ''));
    const conditionText = pickFirstText($, element, ['.SECONDARY_INFO', '.s-item__subtitle', '.s-card__subtitle']);
    const conditionMatch = (conditionText || cardText).match(/(Pre-Owned|Used|Brand New|Open box|For parts or not working)/i);
    const locationText = pickFirstText($, element, ['.s-item__location', '.s-card__location', '[data-testid="ux-textspans--location"]']);
    const imageUrl = $(element).find('img').first().attr('src') ?? $(element).find('img').first().attr('data-defer-load') ?? null;
    const itemPriceText =
      pickFirstText($, element, ['.s-item__price', '.s-card__price', '[data-testid="x-price-primary"]', '[data-testid="x-price"]']) ||
      extractFallbackCurrencyText(cardText);
    const itemPrice = parseMoney(itemPriceText);
    if (itemPrice === null) {
      return;
    }

    const shippingText =
      pickFirstText($, element, ['.s-item__shipping', '.s-item__logisticsCost', '.s-card__shipping']) || cardText;
    const shippingMatch = shippingText.match(/(?:\+\s*)?(\$[\d,.]+)\s+(?:delivery|shipping)/i);
    const shippingLabel =
      shippingMatch?.[0] ??
      (/free (?:delivery|shipping)/i.test(shippingText) ? 'Free delivery' : /local pickup/i.test(shippingText) ? 'Local pickup' : null);
    const shippingPrice = shippingMatch ? parseShipping(shippingMatch[0]) : /free (?:delivery|shipping)/i.test(shippingText) ? 0 : null;
    const localOnly = /local pickup/i.test(shippingText);

    candidates.push({
      title,
      url,
      condition: conditionMatch?.[1] ?? 'Used',
      itemPrice,
      shippingPrice,
      currency: 'USD',
      location: extractLocation(cardText, locationText),
      imageUrl,
      shippingLabel,
      localOnly
    });
  });

  return candidates;
}

async function loadEbayDetail(candidate: CandidateListing): Promise<DetailData | null> {
  const html = await fetchHtml(candidate.url);
  const text = parseBodyText(html);
  const locationMatch =
    text.match(/Item location[:\s]+([A-Za-z.' -]+,\s*[A-Z]{2})/i) ??
    text.match(/Located in[:\s]+([A-Za-z.' -]+,\s*[A-Z]{2})/i) ??
    html.match(/"itemLocation":"([^"]+)"/i);
  return {
    text,
    location: locationMatch?.[1] ?? '',
    shippingLabel: /local pickup/i.test(text) ? 'Local pickup' : undefined,
    localOnly: /local pickup/i.test(text)
  };
}

export class EbayAdapter implements MarketplaceAdapter {
  readonly source = 'ebay' as const;

  async search(_context: BrowserContext, preset: Preset, fetchedAt: string): Promise<Listing[]> {
    const seen = new Map<string, CandidateListing>();
    const batches = await runWithConcurrency(buildSearchUrls(preset), ADAPTER_SEARCH_PAGE_CONCURRENCY, async (url) => {
      const html = await fetchHtml(url);
      return parseEbaySearchHtml(html);
    });

    for (const batch of batches) {
      for (const candidate of batch) {
        seen.set(candidate.url, candidate);
      }
    }

    const shortlist = [...seen.values()].sort((left, right) => left.itemPrice - right.itemPrice).slice(0, 20);
    const finalized = await finalizeCandidates(shortlist, preset, this.source, fetchedAt, loadEbayDetail, {
      detailConcurrency: ADAPTER_DETAIL_PAGE_CONCURRENCY
    });
    return finalized.slice(0, 12);
  }
}
