import * as cheerio from 'cheerio';
import type { BrowserContext } from 'playwright';
import { compactWhitespace, parseMoney } from '../../shared/filters.js';
import type { Listing, Preset } from '../../shared/types.js';
import { ADAPTER_DETAIL_PAGE_CONCURRENCY, ADAPTER_SEARCH_PAGE_CONCURRENCY } from '../config.js';
import {
  finalizeCandidates,
  loadHtml,
  parseBodyText,
  runWithConcurrency,
  type CandidateListing,
  type DetailData,
  type MarketplaceAdapter
} from './common.js';

const GUITAR_CENTER_BASE_URL = 'https://www.guitarcenter.com';

function buildSearchUrls(preset: Preset): string[] {
  return preset.searchTerms.map((query) => {
    const url = new URL('/search', GUITAR_CENTER_BASE_URL);
    url.searchParams.set('Ntt', query);
    return url.toString();
  });
}

function readJsonLdCandidates(html: string): CandidateListing[] {
  const $ = cheerio.load(html);
  const candidates: CandidateListing[] = [];

  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).contents().text();
    if (!raw.includes('"CollectionPage"') || !raw.includes('"itemListElement"')) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as {
        mainEntity?: {
          itemListElement?: Array<{
            item?: {
              name?: string;
              url?: string;
              image?: string;
              offers?: { price?: string; priceCurrency?: string };
            };
          }>;
        };
      };

      for (const entry of parsed.mainEntity?.itemListElement ?? []) {
        const item = entry.item;
        const itemPrice = parseMoney(item?.offers?.price ?? '');
        if (!item?.name || !item?.url || itemPrice === null) {
          continue;
        }

        candidates.push({
          title: compactWhitespace(item.name),
          url: item.url,
          condition: 'Used',
          itemPrice,
          shippingPrice: null,
          currency: item.offers?.priceCurrency ?? 'USD',
          location: '',
          imageUrl: item.image ?? null,
          shippingLabel: null,
          localOnly: false
        });
      }
    } catch {
      return;
    }
  });

  return candidates;
}

export function parseGuitarCenterSearchHtml(html: string): CandidateListing[] {
  return readJsonLdCandidates(html);
}

export function parseGuitarCenterDetailHtml(html: string): DetailData {
  const $ = cheerio.load(html);
  const text = parseBodyText(html);
  const conditionMatch = text.match(/Condition:\s*(Excellent|Very Good|Good|Fair|Mint)/i);
  const elementLocation = $('body *')
    .toArray()
    .map((element) => compactWhitespace($(element).text()))
    .find((value) => /^Item Location:\s*Guitar Center [A-Za-z ]+$/.test(value));
  const selectorLocation = compactWhitespace($('a[href*="stores.guitarcenter.com"]').first().text());
  const locationMatch = text.match(/Item Location:\s*([A-Za-z ]+?)(?=\s*(?:\(\d{3}\)|Message Us|Add to Cart|$))/i);

  return {
    text,
    condition: conditionMatch ? `Used - ${conditionMatch[1]}` : undefined,
    location:
      selectorLocation ||
      elementLocation?.replace(/^Item Location:\s*/i, '') ||
      locationMatch?.[1]?.trim() ||
      '',
    localOnly: /local pickup/i.test(text),
    shippingLabel: /local pickup/i.test(text) ? 'Local pickup' : undefined
  };
}

export class GuitarCenterAdapter implements MarketplaceAdapter {
  readonly source = 'guitarcenter' as const;

  async search(context: BrowserContext, preset: Preset, fetchedAt: string): Promise<Listing[]> {
    const seen = new Map<string, CandidateListing>();
    const batches = await runWithConcurrency(buildSearchUrls(preset), ADAPTER_SEARCH_PAGE_CONCURRENCY, async (url) => {
      const html = await loadHtml(context, url, { delayMs: 2500 });
      return parseGuitarCenterSearchHtml(html);
    });

    for (const batch of batches) {
      for (const candidate of batch) {
        seen.set(candidate.url, candidate);
      }
    }

    const shortlist = [...seen.values()].sort((left, right) => left.itemPrice - right.itemPrice).slice(0, 20);
    const finalized = await finalizeCandidates(shortlist, preset, this.source, fetchedAt, async (candidate) => {
      const html = await loadHtml(context, candidate.url, { delayMs: 1500 });
      return parseGuitarCenterDetailHtml(html);
    }, { detailConcurrency: ADAPTER_DETAIL_PAGE_CONCURRENCY });

    return finalized.slice(0, 12);
  }
}
