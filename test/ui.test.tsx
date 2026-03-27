import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/client/App';
import type { CompareJobEvent, SearchJobEvent } from '../src/shared/types';

const fetchMock = vi.fn<typeof fetch>();

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly url: string;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  emit(event: SearchJobEvent | CompareJobEvent) {
    this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>);
  }

  fail() {
    this.onerror?.();
  }

  close() {
    this.closed = true;
  }
}

function createSearchResponse() {
  return {
    preset: {
      id: 'blue_fender_telecaster',
      label: 'Blue Fender Telecaster',
      description: 'Blue Telecaster preset',
      category: 'guitar' as const,
      sources: ['ebay', 'reverb', 'guitarcenter'] as const,
      searchTerms: ['fender telecaster blue'],
      includeKeywords: ['fender', 'telecaster'],
      excludeKeywords: ['squier'],
      blueFinishKeywords: ['blue']
    },
    results: [
      {
        id: 'ebay:https://example.com/item',
        source: 'ebay' as const,
        title: 'Fender Telecaster Pelham Blue',
        condition: 'Used',
        itemPrice: 799,
        shippingPrice: 49,
        totalPrice: 848,
        currency: 'USD',
        location: 'United States',
        url: 'https://example.com/item',
        imageUrl: null,
        fetchedAt: '2026-03-26T00:00:00.000Z',
        shippingLabel: '$49 shipping',
        localOnly: false,
        distanceMiles: null
      }
    ],
    summary: {
      totalResults: 1,
      bestOverall: {
        id: 'ebay:https://example.com/item',
        source: 'ebay' as const,
        title: 'Fender Telecaster Pelham Blue',
        condition: 'Used',
        itemPrice: 799,
        shippingPrice: 49,
        totalPrice: 848,
        currency: 'USD',
        location: 'United States',
        url: 'https://example.com/item',
        imageUrl: null,
        fetchedAt: '2026-03-26T00:00:00.000Z',
        shippingLabel: '$49 shipping',
        localOnly: false,
        distanceMiles: null
      },
      bestBySource: {
        ebay: {
          id: 'ebay:https://example.com/item',
          source: 'ebay' as const,
          title: 'Fender Telecaster Pelham Blue',
          condition: 'Used',
          itemPrice: 799,
          shippingPrice: 49,
          totalPrice: 848,
          currency: 'USD',
          location: 'United States',
          url: 'https://example.com/item',
          imageUrl: null,
          fetchedAt: '2026-03-26T00:00:00.000Z',
          shippingLabel: '$49 shipping',
          localOnly: false,
          distanceMiles: null
        }
      }
    },
    sourceStatuses: [
      { source: 'ebay' as const, ok: true, count: 1, durationMs: 100 },
      { source: 'reverb' as const, ok: false, count: 0, durationMs: 110, message: 'Blocked' },
      { source: 'guitarcenter' as const, ok: true, count: 0, durationMs: 120 }
    ],
    cached: false,
    fetchedAt: '2026-03-26T00:00:00.000Z'
  };
}

describe('App', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    MockEventSource.instances = [];
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
  });

  it('renders minimal preset cards and shows progress updates from search jobs', async () => {
    const searchResponse = createSearchResponse();

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            presets: [searchResponse.preset]
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ history: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ entries: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'job-1' }), { status: 202 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            history: {
              blue_fender_telecaster: [
                {
                  id: 'search-history-1',
                  presetId: 'blue_fender_telecaster',
                  savedAt: '2026-03-26T00:00:03.000Z',
                  fresh: true,
                  response: searchResponse
                }
              ]
            }
          }),
          { status: 200 }
        )
      );

    render(<App />);

    expect(await screen.findByText('Blue Fender Telecaster')).toBeInTheDocument();
    expect(screen.queryByText('Blue Telecaster preset')).not.toBeInTheDocument();
    expect(screen.queryByText(/blue finish keywords/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/local pickup:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/search checks/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3]?.[0]).toBe('/api/search-jobs');
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presetId: 'blue_fender_telecaster', forceRefresh: false })
    });
    expect(MockEventSource.instances[0]?.url).toBe('/api/search-jobs/job-1/events');

    const jobStream = MockEventSource.instances[0];
    jobStream.emit({
      type: 'started',
      at: '2026-03-26T00:00:00.000Z',
      jobId: 'job-1',
      presetId: 'blue_fender_telecaster',
      totalSources: 3
    });
    jobStream.emit({
      type: 'source_started',
      at: '2026-03-26T00:00:01.000Z',
      jobId: 'job-1',
      presetId: 'blue_fender_telecaster',
      source: 'reverb',
      completedSources: 0,
      totalSources: 3
    });

    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText(/checking reverb/i)).toBeInTheDocument();

    jobStream.emit({
      type: 'source_completed',
      at: '2026-03-26T00:00:02.000Z',
      jobId: 'job-1',
      presetId: 'blue_fender_telecaster',
      source: 'reverb',
      completedSources: 1,
      totalSources: 3,
      status: { source: 'reverb', ok: false, count: 0, durationMs: 110, message: 'Blocked' }
    });

    await waitFor(() => expect(screen.getByText(/1 of 3 sources complete/i)).toBeInTheDocument());

    jobStream.emit({
      type: 'completed',
      at: '2026-03-26T00:00:03.000Z',
      jobId: 'job-1',
      presetId: 'blue_fender_telecaster',
      completedSources: 3,
      totalSources: 3,
      cached: false,
      response: searchResponse
    });

    await waitFor(() => expect(screen.getByText('Fender Telecaster Pelham Blue')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Open listing' })).toHaveAttribute('href', 'https://example.com/item');
    expect(jobStream.closed).toBe(true);
  }, 10000);

  it('saves a derived preset from a pasted listing URL', async () => {
    const compareResponse = {
      sourceListing: {
        source: 'reverb' as const,
        title: 'Sequential Take 5 44-Key 5-Voice Compact Polyphonic Synthesizer 2021 - Present - Black',
        url: 'https://reverb.com/item/test-sequential-take-5',
        condition: 'Used - Excellent',
        itemPrice: 1100,
        shippingPrice: 300,
        location: 'Springfield, MN, United States',
        shippingLabel: '$300 Shipping',
        localOnly: false
      },
      derivedPreset: {
        id: 'compare_sequential_take_5',
        label: 'Sequential Take 5 44-Key 5-Voice Compact Polyphonic Synthesizer - Black',
        description: 'Derived from pasted listing URL.',
        category: 'other' as const,
        sources: ['ebay', 'reverb', 'guitarcenter'] as const,
        searchTerms: ['sequential take 5', 'sequential take 5 synthesizer'],
        includeKeywords: ['sequential', 'take 5'],
        excludeKeywords: ['stand', 'module', 'desktop'],
        localPickupRadiusMiles: 50,
        homeBaseLabel: 'Provo, UT'
      },
      search: {
        preset: {
          id: 'compare_sequential_take_5',
          label: 'Sequential Take 5 44-Key 5-Voice Compact Polyphonic Synthesizer - Black',
          description: 'Derived from pasted listing URL.',
          category: 'other' as const,
          sources: ['ebay', 'reverb', 'guitarcenter'] as const,
          searchTerms: ['sequential take 5', 'sequential take 5 synthesizer'],
          includeKeywords: ['sequential', 'take 5'],
          excludeKeywords: ['stand', 'module', 'desktop'],
          localPickupRadiusMiles: 50,
          homeBaseLabel: 'Provo, UT'
        },
        results: [],
        summary: {
          totalResults: 0,
          bestOverall: null,
          bestBySource: {}
        },
        sourceStatuses: [],
        cached: false,
        fetchedAt: '2026-03-26T00:00:00.000Z'
      },
      cached: false
    };

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ presets: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ history: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ entries: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'compare-job-1' }), { status: 202 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entries: [
              {
                id: 'compare-history-1',
                url: 'https://reverb.com/item/test-sequential-take-5',
                savedAt: '2026-03-26T00:00:01.000Z',
                fresh: true,
                response: compareResponse
              }
            ]
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            preset: {
              id: 'sequential_take_5_44_key_5_voice_compact_polyphonic_synthesizer',
              label: 'Sequential Take 5 44-Key 5-Voice Compact Polyphonic Synthesizer - Black',
              description: 'Derived from pasted listing URL.',
              category: 'other',
              sources: ['ebay', 'reverb', 'guitarcenter'],
              searchTerms: ['sequential take 5', 'sequential take 5 synthesizer'],
              includeKeywords: ['sequential', 'take 5'],
              excludeKeywords: ['stand', 'module', 'desktop'],
              localPickupRadiusMiles: 50,
              homeBaseLabel: 'Provo, UT'
            }
          }),
          { status: 201 }
        )
      );

    render(<App />);

    await userEvent.type(
      await screen.findByLabelText('Listing URL'),
      'https://reverb.com/item/test-sequential-take-5'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Find comparables' }));

    const compareStream = MockEventSource.instances[0];
    expect(compareStream?.url).toBe('/api/compare-jobs/compare-job-1/events');
    compareStream.emit({
      type: 'started',
      at: '2026-03-26T00:00:00.000Z',
      jobId: 'compare-job-1',
      url: 'https://reverb.com/item/test-sequential-take-5',
      totalUnits: 1
    });
    compareStream.emit({
      type: 'stage_completed',
      at: '2026-03-26T00:00:01.000Z',
      jobId: 'compare-job-1',
      url: 'https://reverb.com/item/test-sequential-take-5',
      stage: 'fetch_listing',
      completedUnits: 1,
      totalUnits: 4,
      derivedPreset: compareResponse.derivedPreset
    });
    compareStream.emit({
      type: 'completed',
      at: '2026-03-26T00:00:02.000Z',
      jobId: 'compare-job-1',
      url: 'https://reverb.com/item/test-sequential-take-5',
      completedUnits: 4,
      totalUnits: 4,
      cached: false,
      response: compareResponse
    });

    expect(await screen.findByRole('button', { name: 'Save as preset' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save as preset' }));

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls[3]?.[0]).toBe('/api/compare-jobs');
    expect(fetchMock.mock.calls[5]?.[0]).toBe('/api/presets');
    expect(fetchMock.mock.calls[5]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: 'Sequential Take 5 44-Key 5-Voice Compact Polyphonic Synthesizer - Black',
        description: 'Derived from pasted listing URL.',
        category: 'other',
        searchTerms: ['sequential take 5', 'sequential take 5 synthesizer'],
        includeKeywords: ['sequential', 'take 5'],
        excludeKeywords: ['stand', 'module', 'desktop'],
        blueFinishKeywords: undefined,
        localPickupRadiusMiles: 50,
        homeBaseLabel: 'Provo, UT'
      })
    });
  });
});
