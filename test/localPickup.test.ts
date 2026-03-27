import { describe, expect, it } from 'vitest';
import { defaultPresetMap } from '../src/shared/presets';
import { applyLocalPickupRadius } from '../src/server/services/localPickupService';

describe('local pickup radius', () => {
  it('drops local-only listings outside the Provo radius', async () => {
    const preset = defaultPresetMap.get('blue_fender_telecaster');
    expect(preset).toBeDefined();

    const listings = [
      {
        id: 'nearby',
        source: 'reverb' as const,
        title: 'Nearby local pickup listing',
        condition: 'Used',
        itemPrice: 500,
        shippingPrice: null,
        totalPrice: null,
        currency: 'USD',
        location: 'Provo, UT, United States',
        url: 'https://example.com/nearby',
        imageUrl: null,
        fetchedAt: '2026-03-25T00:00:00.000Z',
        shippingLabel: 'Local Pickup',
        localOnly: true,
        distanceMiles: null
      },
      {
        id: 'far',
        source: 'reverb' as const,
        title: 'Far local pickup listing',
        condition: 'Used',
        itemPrice: 500,
        shippingPrice: null,
        totalPrice: null,
        currency: 'USD',
        location: 'Livonia, MI, United States',
        url: 'https://example.com/far',
        imageUrl: null,
        fetchedAt: '2026-03-25T00:00:00.000Z',
        shippingLabel: 'Local Pickup',
        localOnly: true,
        distanceMiles: null
      },
      {
        id: 'shipped',
        source: 'ebay' as const,
        title: 'Shipped listing',
        condition: 'Used',
        itemPrice: 700,
        shippingPrice: 45,
        totalPrice: 745,
        currency: 'USD',
        location: '',
        url: 'https://example.com/shipped',
        imageUrl: null,
        fetchedAt: '2026-03-25T00:00:00.000Z',
        shippingLabel: '$45 shipping',
        localOnly: false,
        distanceMiles: null
      }
    ];

    const filtered = await applyLocalPickupRadius(
      listings,
      preset!,
      async (location) =>
        location.startsWith('Provo')
          ? { lat: 40.2338, lon: -111.6585 }
          : location.startsWith('Livonia')
            ? { lat: 42.36837, lon: -83.3527097 }
            : null
    );

    expect(filtered.map((listing) => listing.id)).toEqual(['nearby', 'shipped']);
    expect(filtered[0].distanceMiles).toBe(0);
  });
});
