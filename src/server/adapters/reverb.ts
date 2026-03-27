import * as cheerio from 'cheerio';
import type { BrowserContext } from 'playwright';
import { compactWhitespace, parseMoney, parseShipping } from '../../shared/filters.js';
import type { Listing, Preset } from '../../shared/types.js';
import { ADAPTER_DETAIL_PAGE_CONCURRENCY, ADAPTER_SEARCH_PAGE_CONCURRENCY } from '../config.js';
import {
  absoluteUrl,
  finalizeCandidates,
  loadHtml,
  parseBodyText,
  runWithConcurrency,
  type CandidateListing,
  type DetailData,
  type MarketplaceAdapter
} from './common.js';

const REVERB_BASE_URL = 'https://reverb.com';

function buildSearchUrls(preset: Preset): string[] {
  return preset.searchTerms.map((query) => {
    const url = new URL('/marketplace', REVERB_BASE_URL);
    url.searchParams.set('query', query);
    return url.toString();
  });
}

export function parseReverbSearchHtml(html: string): CandidateListing[] {
  const $ = cheerio.load(html);
  const candidates: CandidateListing[] = [];

  $('.rc-listing-card').each((_, element) => {
    const title = compactWhitespace($(element).find('.rc-listing-card__title').first().text());
    const href =
      $(element).find('.rc-listing-card__title-element').first().attr('href') ??
      $(element).find('meta[itemprop="url"]').attr('content');
    const url = absoluteUrl(REVERB_BASE_URL, href);
    const priceText =
      $(element).find('meta[itemprop="price"]').attr('content') ??
      $(element).find('.rc-price-block__price').first().text();
    const itemPrice = parseMoney(priceText ?? '');
    if (!title || !url || itemPrice === null) {
      return;
    }

    const condition = compactWhitespace($(element).find('.rc-listing-card__condition').first().text()) || 'Used';
    const imageUrl = $(element).find('img').first().attr('src') ?? null;
    const shippingText = compactWhitespace($(element).find('.rc-nudge__icon__label').first().text());
    const shippingPrice = shippingText ? parseShipping(shippingText) : null;
    const localOnly = /local pickup/i.test(shippingText);

    candidates.push({
      title,
      url,
      condition,
      itemPrice,
      shippingPrice,
      currency: 'USD',
      location: '',
      imageUrl,
      shippingLabel: shippingText || null,
      localOnly
    });
  });

  return candidates;
}

export function parseReverbDetailHtml(html: string): DetailData {
  const $ = cheerio.load(html);
  const text = parseBodyText(html);
  const exactLocationText = $('body *')
    .toArray()
    .map((element) => compactWhitespace($(element).text()))
    .find((value) => /^[A-Za-z.'-]+(?: [A-Za-z.'-]+){0,4},\s*[A-Z]{2},\s*United States$/.test(value));
  const locationMatch =
    html.match(/displayLocation(?:&quot;|"):(?:&quot;|")([^"&]+?United States)(?:&quot;|")/) ??
    (exactLocationText ? [exactLocationText, exactLocationText] : null) ??
    text.match(/([A-Za-z.'-]+(?: [A-Za-z.'-]+){0,4},\s*[A-Z]{2},\s*United States)/);
  const conditionMatch = text.match(/Used\s*[–-]\s*(Mint|Excellent|Very Good|Good|Fair)/i);
  const shippingMatch = text.match(/(\$[\d,.]+)\s+shipping/i);
  const localOnly = /local pickup/i.test(text);

  return {
    text,
    condition: conditionMatch ? `Used - ${conditionMatch[1]}` : undefined,
    location: locationMatch?.[1] ?? locationMatch?.[0] ?? '',
    shippingPrice: shippingMatch ? parseShipping(shippingMatch[0]) : undefined,
    shippingLabel: localOnly ? 'Local Pickup' : shippingMatch?.[0] ?? undefined,
    localOnly
  };
}

export class ReverbAdapter implements MarketplaceAdapter {
  readonly source = 'reverb' as const;

  async search(context: BrowserContext, preset: Preset, fetchedAt: string): Promise<Listing[]> {
    const seen = new Map<string, CandidateListing>();
    const batches = await runWithConcurrency(buildSearchUrls(preset), ADAPTER_SEARCH_PAGE_CONCURRENCY, async (url) => {
      const html = await loadHtml(context, url, {
        waitForSelector: '.rc-listing-card',
        delayMs: 3000
      });
      return parseReverbSearchHtml(html);
    });

    for (const batch of batches) {
      for (const candidate of batch) {
        seen.set(candidate.url, candidate);
      }
    }

    const shortlist = [...seen.values()].sort((left, right) => left.itemPrice - right.itemPrice).slice(0, 20);
    const finalized = await finalizeCandidates(shortlist, preset, this.source, fetchedAt, async (candidate) => {
      const html = await loadHtml(context, candidate.url, { delayMs: 1500 });
      return parseReverbDetailHtml(html);
    }, { detailConcurrency: ADAPTER_DETAIL_PAGE_CONCURRENCY });

    return finalized.slice(0, 12);
  }
}
