import { describe, expect, it } from 'vitest';
import { detailMatchesBlue, isUsedConditionText, matchesPresetTitle, needsBlueVerification, parseMoney, parseShipping, sortListings } from '../src/shared/filters';
import { defaultPresetMap } from '../src/shared/presets';

describe('shared filters', () => {
  it('parses item and shipping prices', () => {
    expect(parseMoney('$1,249.99')).toBe(1249.99);
    expect(parseShipping('Free Shipping')).toBe(0);
    expect(parseShipping('+$62 back in Rewards')).toBe(62);
  });

  it('matches telecaster titles and rejects squier listings', () => {
    const preset = defaultPresetMap.get('blue_fender_telecaster');
    expect(preset).toBeDefined();
    expect(matchesPresetTitle('Fender Telecaster Pelham Blue', preset!)).toBe(true);
    expect(
      matchesPresetTitle('Used 2021 Fender Player Telecaster Lake Placid Blue Solid Body Electric Guitar', preset!)
    ).toBe(true);
    expect(matchesPresetTitle('Used Fender Squier Telecaster Lake Placid Blue', preset!)).toBe(false);
  });

  it('requires detail verification when blue is not obvious in the title', () => {
    const preset = defaultPresetMap.get('blue_fender_telecaster');
    expect(preset).toBeDefined();
    expect(needsBlueVerification('Fender American Professional II Telecaster', preset!)).toBe(true);
    expect(detailMatchesBlue('Color: Miami Blue', preset!)).toBe(true);
  });

  it('rejects non-used conditions and sorts unknown shipping after known totals', () => {
    expect(isUsedConditionText('Brand New')).toBe(false);

    const sorted = sortListings([
      {
        id: 'a',
        source: 'ebay',
        title: 'Known total',
        condition: 'Used',
        itemPrice: 500,
        shippingPrice: 25,
        totalPrice: 525,
        currency: 'USD',
        location: '',
        url: 'https://example.com/a',
        imageUrl: null,
        fetchedAt: '2026-03-25T00:00:00.000Z',
        shippingLabel: '$25 shipping',
        localOnly: false,
        distanceMiles: null
      },
      {
        id: 'b',
        source: 'reverb',
        title: 'Unknown shipping',
        condition: 'Used',
        itemPrice: 450,
        shippingPrice: null,
        totalPrice: null,
        currency: 'USD',
        location: '',
        url: 'https://example.com/b',
        imageUrl: null,
        fetchedAt: '2026-03-25T00:00:00.000Z',
        shippingLabel: null,
        localOnly: false,
        distanceMiles: null
      }
    ]);

    expect(sorted[0].id).toBe('a');
  });
});
