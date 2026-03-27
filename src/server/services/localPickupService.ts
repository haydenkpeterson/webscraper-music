import { compactWhitespace } from '../../shared/filters.js';
import type { Listing, Preset } from '../../shared/types.js';

const PROVO_COORDINATES = {
  lat: 40.2338,
  lon: -111.6585
};

const geocodeCache = new Map<string, { lat: number; lon: number } | null>();

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function haversineMiles(left: { lat: number; lon: number }, right: { lat: number; lon: number }): number {
  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(right.lat - left.lat);
  const dLon = toRadians(right.lon - left.lon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(left.lat)) * Math.cos(toRadians(right.lat)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
}

function normalizeLocationQuery(location: string): string {
  const compact = compactWhitespace(location);
  if (/^guitar center /i.test(compact)) {
    return `${compact.replace(/^guitar center /i, '')}, United States`;
  }

  if (/united states/i.test(compact)) {
    return compact;
  }

  return `${compact}, United States`;
}

export async function geocodeLocation(location: string): Promise<{ lat: number; lon: number } | null> {
  const query = normalizeLocationQuery(location);
  if (!query) {
    return null;
  }

  if (geocodeCache.has(query)) {
    return geocodeCache.get(query) ?? null;
  }

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('q', query);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'webscraper-music/1.0 (local comparable price tool)'
    }
  });

  if (!response.ok) {
    geocodeCache.set(query, null);
    return null;
  }

  const payload = (await response.json()) as Array<{ lat: string; lon: string }>;
  const first = payload[0];
  if (!first) {
    geocodeCache.set(query, null);
    return null;
  }

  const result = {
    lat: Number.parseFloat(first.lat),
    lon: Number.parseFloat(first.lon)
  };
  geocodeCache.set(query, result);
  return result;
}

export async function applyLocalPickupRadius(
  listings: Listing[],
  preset: Preset,
  resolveCoordinates: (location: string) => Promise<{ lat: number; lon: number } | null> = geocodeLocation
): Promise<Listing[]> {
  const radiusMiles = preset.localPickupRadiusMiles ?? 50;
  const filtered: Listing[] = [];

  for (const listing of listings) {
    if (!listing.localOnly) {
      filtered.push(listing);
      continue;
    }

    if (!listing.location) {
      continue;
    }

    const coordinates = await resolveCoordinates(listing.location);
    if (!coordinates) {
      continue;
    }

    const distanceMiles = Number(haversineMiles(PROVO_COORDINATES, coordinates).toFixed(1));
    if (distanceMiles > radiusMiles) {
      continue;
    }

    filtered.push({
      ...listing,
      distanceMiles
    });
  }

  return filtered;
}
