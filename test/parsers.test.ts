import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEbaySearchHtml } from '../src/server/adapters/ebay';
import { parseGuitarCenterDetailHtml, parseGuitarCenterSearchHtml } from '../src/server/adapters/guitarCenter';
import { parseReverbDetailHtml, parseReverbSearchHtml } from '../src/server/adapters/reverb';

const fixtures = (...parts: string[]) => readFileSync(path.join(process.cwd(), 'test', 'fixtures', ...parts), 'utf8');

describe('marketplace parsers', () => {
  it('parses ebay search cards', () => {
    const results = parseEbaySearchHtml(fixtures('ebay-search.html'));
    expect(results).toHaveLength(2);
    expect(results[0].title).toContain('Tidepool Blue');
    expect(results[0].shippingPrice).toBe(61.67);
    expect(results[0].localOnly).toBe(false);
  });

  it('parses reverb search cards and detail metadata', () => {
    const results = parseReverbSearchHtml(fixtures('reverb-search.html'));
    expect(results).toHaveLength(2);
    expect(results[0].url).toContain('reverb.com/item/94637581');
    expect(results[0].shippingPrice).toBe(0);
    expect(results[0].localOnly).toBe(false);

    const detail = parseReverbDetailHtml(fixtures('reverb-detail.html'));
    expect(detail.location).toBe('Livonia, MI, United States');
    expect(detail.shippingPrice).toBe(75);
    expect(detail.localOnly).toBe(false);
  });

  it('parses guitar center search json-ld and detail metadata', () => {
    const results = parseGuitarCenterSearchHtml(fixtures('guitarcenter-search.html'));
    expect(results).toHaveLength(1);
    expect(results[0].itemPrice).toBe(1249.99);

    const detail = parseGuitarCenterDetailHtml(fixtures('guitarcenter-detail.html'));
    expect(detail.condition).toBe('Used - Fair');
    expect(detail.location).toBe('Guitar Center Phoenix');
  });
});
