import type { Listing, Preset } from './types.js';

const usedExclusionKeywords = [
  'open box',
  'open-box',
  'brand new',
  'new',
  'b-stock',
  'for parts',
  'parts only'
];

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[|/\\]+/g, ' ')
    .trim();
}

export function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function containsKeyword(haystack: string, keyword: string): boolean {
  return normalizeText(haystack).includes(normalizeText(keyword));
}

export function includesAllKeywords(haystack: string, keywords: string[]): boolean {
  const normalized = normalizeText(haystack);
  return keywords.every((keyword) => normalized.includes(normalizeText(keyword)));
}

export function includesAnyKeyword(haystack: string, keywords: string[]): boolean {
  const normalized = normalizeText(haystack);
  return keywords.some((keyword) => normalized.includes(normalizeText(keyword)));
}

export function parseMoney(value: string): number | null {
  const normalized = value.replace(/,/g, '');
  const match = normalized.match(/(\d+(?:\.\d{1,2})?)/);
  if (!match) {
    return null;
  }

  return Number.parseFloat(match[1]);
}

export function parseShipping(value: string): number | null {
  const normalized = normalizeText(value);
  if (!normalized || normalized.includes('not specified') || normalized.includes('contact')) {
    return null;
  }

  if (normalized.includes('free')) {
    return 0;
  }

  return parseMoney(value);
}

export function isUsedConditionText(condition: string): boolean {
  const normalized = normalizeText(condition);
  if (!normalized) {
    return true;
  }

  if (normalized.includes('used') || normalized.includes('pre-owned') || normalized.includes('preowned')) {
    return true;
  }

  return !usedExclusionKeywords.some((keyword) => normalized.includes(keyword));
}

export function needsBlueVerification(title: string, preset: Preset): boolean {
  if (!preset.blueFinishKeywords?.length) {
    return false;
  }

  return !includesAnyKeyword(title, preset.blueFinishKeywords);
}

export function detailMatchesBlue(detailText: string, preset: Preset): boolean {
  return preset.blueFinishKeywords ? includesAnyKeyword(detailText, preset.blueFinishKeywords) : true;
}

export function matchesPresetTitle(title: string, preset: Preset): boolean {
  const normalizedTitle = normalizeText(title);
  if (!includesAllKeywords(normalizedTitle, preset.includeKeywords)) {
    return false;
  }

  return !preset.excludeKeywords.some((keyword) => normalizedTitle.includes(normalizeText(keyword)));
}

export function createListingId(source: string, url: string): string {
  return `${source}:${url}`;
}

export function sortListings(listings: Listing[]): Listing[] {
  return [...listings].sort((left, right) => {
    const leftKnown = left.totalPrice !== null;
    const rightKnown = right.totalPrice !== null;
    if (leftKnown !== rightKnown) {
      return leftKnown ? -1 : 1;
    }

    const leftPrice = leftKnown ? left.totalPrice ?? Number.POSITIVE_INFINITY : left.itemPrice;
    const rightPrice = rightKnown ? right.totalPrice ?? Number.POSITIVE_INFINITY : right.itemPrice;
    if (leftPrice !== rightPrice) {
      return leftPrice - rightPrice;
    }

    return left.title.localeCompare(right.title);
  });
}

export function computeTotalPrice(itemPrice: number, shippingPrice: number | null): number | null {
  if (shippingPrice === null) {
    return null;
  }

  return Number((itemPrice + shippingPrice).toFixed(2));
}
