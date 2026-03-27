import type {
  CompareHistoryEntry,
  CompareJobEvent,
  CompareJobStartResponse,
  CompareLinkResponse,
  CreatePresetRequest,
  Preset,
  SearchHistoryEntry,
  SearchJobEvent,
  SearchJobStartResponse,
  SearchResponse,
  SnapshotPayload
} from '../shared/types';

export async function fetchPresets(): Promise<Preset[]> {
  const response = await fetch('/api/presets');
  if (!response.ok) {
    throw new Error('Unable to load presets.');
  }

  const payload = (await response.json()) as { presets: Preset[] };
  return payload.presets;
}

export async function fetchSearchHistory(): Promise<Record<string, SearchHistoryEntry[]>> {
  const response = await fetch('/api/search-history');
  if (!response.ok) {
    throw new Error('Unable to load saved search history.');
  }

  const payload = (await response.json()) as { history: Record<string, SearchHistoryEntry[]> };
  return payload.history;
}

export async function fetchCompareHistory(): Promise<CompareHistoryEntry[]> {
  const response = await fetch('/api/compare-history');
  if (!response.ok) {
    throw new Error('Unable to load saved compare history.');
  }

  const payload = (await response.json()) as { entries: CompareHistoryEntry[] };
  return payload.entries;
}

export async function startSearchJob(presetId: string, forceRefresh = false): Promise<SearchJobStartResponse> {
  const response = await fetch('/api/search-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ presetId, forceRefresh })
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? 'Unable to start search job.');
  }

  return (await response.json()) as SearchJobStartResponse;
}

function subscribeToEvents<T extends SearchJobEvent | CompareJobEvent>(
  url: string,
  handlers: {
    onEvent: (event: T) => void;
    onError: (error: Error) => void;
  }
): () => void {
  const source = new EventSource(url);

  source.onmessage = (message) => {
    const event = JSON.parse(message.data) as T;
    handlers.onEvent(event);
    if (event.type === 'completed' || event.type === 'failed') {
      source.close();
    }
  };

  source.onerror = () => {
    source.close();
    handlers.onError(new Error('Search progress connection failed.'));
  };

  return () => {
    source.close();
  };
}

export function subscribeToSearchJob(
  jobId: string,
  handlers: {
    onEvent: (event: SearchJobEvent) => void;
    onError: (error: Error) => void;
  }
): () => void {
  return subscribeToEvents(`/api/search-jobs/${jobId}/events`, handlers);
}

export async function startCompareJob(url: string, forceRefresh = false): Promise<CompareJobStartResponse> {
  const response = await fetch('/api/compare-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, forceRefresh })
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? 'Unable to start compare job.');
  }

  return (await response.json()) as CompareJobStartResponse;
}

export function subscribeToCompareJob(
  jobId: string,
  handlers: {
    onEvent: (event: CompareJobEvent) => void;
    onError: (error: Error) => void;
  }
): () => void {
  return subscribeToEvents(`/api/compare-jobs/${jobId}/events`, handlers);
}

export async function createPreset(input: CreatePresetRequest): Promise<Preset> {
  const response = await fetch('/api/presets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? 'Unable to create preset.');
  }

  const payload = (await response.json()) as { preset: Preset };
  return payload.preset;
}

export async function deletePreset(presetId: string): Promise<void> {
  const response = await fetch(`/api/presets/${presetId}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? 'Unable to delete preset.');
  }
}

export async function compareFromLink(url: string, forceRefresh = false): Promise<CompareLinkResponse> {
  const response = await fetch('/api/compare-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, forceRefresh })
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? 'Unable to compare that link.');
  }

  return (await response.json()) as CompareLinkResponse;
}

export async function fetchSnapshotPayload(): Promise<SnapshotPayload> {
  const response = await fetch(`${import.meta.env.BASE_URL}snapshot-data.json`);
  if (!response.ok) {
    throw new Error('Unable to load snapshot data.');
  }

  return (await response.json()) as SnapshotPayload;
}
