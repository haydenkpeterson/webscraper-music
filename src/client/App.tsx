import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  createPreset,
  deletePreset,
  fetchCompareHistory,
  fetchPresets,
  fetchSearchHistory,
  fetchSnapshotPayload,
  startCompareJob,
  startSearchJob,
  subscribeToCompareJob,
  subscribeToSearchJob
} from './api';
import type {
  CompareHistoryEntry,
  CompareJobEvent,
  CompareLinkResponse,
  CreatePresetRequest,
  Listing,
  MarketplaceSource,
  Preset,
  SearchHistoryEntry,
  SearchJobEvent,
  SearchResponse
} from '../shared/types';

type PresetJobState = {
  jobId: string;
  presetId: string;
  totalSources: number;
  completedSources: number;
  activeSources: MarketplaceSource[];
  status: 'queued' | 'running';
  startedAt: number;
};

type CompareJobState = {
  jobId: string;
  url: string;
  totalUnits: number;
  completedUnits: number;
  activeSources: MarketplaceSource[];
  status: 'queued' | 'running';
  phase: 'fetch_listing' | 'search';
  startedAt: number;
  derivedPreset: Preset | null;
};

const snapshotMode = import.meta.env.VITE_SNAPSHOT_MODE === 'true';
const presetRequestUrl = import.meta.env.VITE_PRESET_REQUEST_URL as string | undefined;

function formatCurrency(value: number | null): string {
  if (value === null) {
    return 'Unknown';
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(value);
}

function formatSourceLabel(source: string): string {
  switch (source) {
    case 'guitarcenter':
      return 'Guitar Center';
    case 'ebay':
      return 'eBay';
    case 'reverb':
      return 'Reverb';
    default:
      return 'Source';
  }
}

function formatElapsedTime(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function parseCommaList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formatLocation(listing: Listing): string {
  if (!listing.location) {
    return 'Unknown';
  }

  if (listing.localOnly && listing.distanceMiles !== null) {
    return `${listing.location} | ${listing.distanceMiles} mi`;
  }

  return listing.location;
}

function buildActiveSourceLabel(activeSources: MarketplaceSource[]): string {
  if (!activeSources.length) {
    return 'Preparing sources';
  }

  if (activeSources.length === 1) {
    return `Checking ${formatSourceLabel(activeSources[0])}`;
  }

  return `Checking ${formatSourceLabel(activeSources[0])} + ${activeSources.length - 1} more`;
}

function buildLatestResults(history: Record<string, SearchHistoryEntry[]>): Record<string, SearchResponse> {
  return Object.fromEntries(
    Object.entries(history)
      .filter(([, entries]) => Boolean(entries[0]))
      .map(([presetId, entries]) => [presetId, entries[0]!.response])
  );
}

function SearchProgressBar({ state, elapsedMs }: { state: PresetJobState; elapsedMs: number }) {
  const percentComplete = state.totalSources ? (state.completedSources / state.totalSources) * 100 : 0;
  const headline = state.status === 'queued' ? 'Queued for scrape slot' : buildActiveSourceLabel(state.activeSources);
  const detail =
    state.status === 'queued'
      ? `Waiting to start | ${formatElapsedTime(elapsedMs)}`
      : `${state.completedSources} of ${state.totalSources} sources complete | ${formatElapsedTime(elapsedMs)}`;

  return (
    <section aria-label="Search progress" className="search-progress">
      <div className="search-progress-copy">
        <strong>{headline}</strong>
        <span>{detail}</span>
      </div>
      <div aria-valuemax={state.totalSources} aria-valuemin={0} aria-valuenow={state.completedSources} className="progress-bar" role="progressbar">
        <div className="progress-bar-fill" style={{ width: `${percentComplete}%` }} />
        <div className="progress-bar-sheen" />
      </div>
    </section>
  );
}

function CompareProgressBar({ state, elapsedMs }: { state: CompareJobState; elapsedMs: number }) {
  const percentComplete = state.totalUnits ? (state.completedUnits / state.totalUnits) * 100 : 0;
  const headline =
    state.status === 'queued'
      ? 'Queued for scrape slot'
      : state.phase === 'fetch_listing'
        ? 'Fetching source listing'
        : state.activeSources.length
          ? buildActiveSourceLabel(state.activeSources)
          : state.derivedPreset
            ? `Searching ${state.derivedPreset.label}`
            : 'Preparing comparable search';
  const detail =
    state.status === 'queued'
      ? `Waiting to start | ${formatElapsedTime(elapsedMs)}`
      : `${state.completedUnits} of ${state.totalUnits} steps complete | ${formatElapsedTime(elapsedMs)}`;

  return (
    <section aria-label="Compare progress" className="search-progress">
      <div className="search-progress-copy">
        <strong>{headline}</strong>
        <span>{detail}</span>
      </div>
      <div aria-valuemax={state.totalUnits} aria-valuemin={0} aria-valuenow={state.completedUnits} className="progress-bar" role="progressbar">
        <div className="progress-bar-fill" style={{ width: `${percentComplete}%` }} />
        <div className="progress-bar-sheen" />
      </div>
    </section>
  );
}

function ResultsPanel({
  response,
  heading,
  sourceListing
}: {
  response: SearchResponse;
  heading?: string;
  sourceListing?: CompareLinkResponse['sourceListing'];
}) {
  const bestOverall = response.summary.bestOverall;

  return (
    <section className="results-panel">
      {heading ? (
        <div className="results-header">
          <p className="preset-tag">Comparable prices</p>
          <h2>{heading}</h2>
        </div>
      ) : null}

      {sourceListing ? (
        <div className="compare-source">
          <span className="source-badge">{formatSourceLabel(sourceListing.source)}</span>
          <strong>{sourceListing.title}</strong>
          <p>
            {sourceListing.condition}
            {sourceListing.itemPrice !== null ? ` | ${formatCurrency(sourceListing.itemPrice)}` : ''}
            {sourceListing.localOnly ? ' | Local pickup only' : ''}
          </p>
        </div>
      ) : null}

      <div className="summary-strip">
        <div>
          <span className="summary-label">Results</span>
          <strong>{response.summary.totalResults}</strong>
        </div>
        <div>
          <span className="summary-label">Best overall</span>
          <strong>{bestOverall ? formatCurrency(bestOverall.totalPrice ?? bestOverall.itemPrice) : 'None'}</strong>
        </div>
        <div>
          <span className="summary-label">Mode</span>
          <strong>{response.cached ? 'Saved result' : 'Live scrape'}</strong>
        </div>
        <div>
          <span className="summary-label">Fetched</span>
          <strong>{new Date(response.fetchedAt).toLocaleTimeString()}</strong>
        </div>
      </div>

      <div className="status-grid">
        {response.sourceStatuses.map((status) => (
          <div className={`status-pill ${status.ok ? 'status-ok' : 'status-error'}`} key={status.source}>
            <span>{formatSourceLabel(status.source)}</span>
            <strong>{status.ok ? `${status.count} hits` : status.message ?? 'Failed'}</strong>
          </div>
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Title</th>
              <th>Condition</th>
              <th>Item</th>
              <th>Shipping</th>
              <th>Total</th>
              <th>Location</th>
              <th>Link</th>
            </tr>
          </thead>
          <tbody>
            {response.results.map((listing) => {
              const isBestOverall = response.summary.bestOverall?.id === listing.id;
              const isBestBySource = response.summary.bestBySource[listing.source]?.id === listing.id;
              return (
                <tr key={listing.id}>
                  <td>
                    <span className="source-badge">{formatSourceLabel(listing.source)}</span>
                  </td>
                  <td>
                    <div className="title-cell">
                      <span>{listing.title}</span>
                      <div className="badge-row">
                        {isBestOverall ? <span className="deal-badge overall">Best overall</span> : null}
                        {isBestBySource ? <span className="deal-badge source">Best in source</span> : null}
                        {listing.localOnly ? <span className="deal-badge neutral">Local only</span> : null}
                      </div>
                    </div>
                  </td>
                  <td>{listing.condition}</td>
                  <td>{formatCurrency(listing.itemPrice)}</td>
                  <td>{listing.localOnly ? listing.shippingLabel ?? 'Local pickup' : formatCurrency(listing.shippingPrice)}</td>
                  <td>{listing.localOnly ? 'Pickup only' : formatCurrency(listing.totalPrice)}</td>
                  <td>{formatLocation(listing)}</td>
                  <td>
                    <a href={listing.url} rel="noreferrer" target="_blank">
                      Open listing
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SearchHistorySection({
  entries,
  onLoad
}: {
  entries: SearchHistoryEntry[];
  onLoad: (entry: SearchHistoryEntry) => void;
}) {
  if (!entries.length) {
    return null;
  }

  return (
    <section className="history-section" aria-label="Recent searches">
      <div className="history-header">
        <strong>Recent runs</strong>
        <span>{entries.length} saved</span>
      </div>
      <div className="history-chip-row">
        {entries.slice(0, 4).map((entry) => (
          <button className="button button-secondary button-small" key={entry.id} onClick={() => onLoad(entry)} type="button">
            {formatTimestamp(entry.response.fetchedAt)}
            {entry.fresh ? ' | Fresh' : ' | Saved'}
          </button>
        ))}
      </div>
    </section>
  );
}

function CompareHistorySection({
  entries,
  onLoad
}: {
  entries: CompareHistoryEntry[];
  onLoad: (entry: CompareHistoryEntry) => void;
}) {
  if (!entries.length) {
    return (
      <section className="history-section" aria-label="Saved compares">
        <div className="history-header">
          <strong>Saved compares</strong>
          <span>No saved compares yet</span>
        </div>
      </section>
    );
  }

  return (
    <section className="history-section" aria-label="Saved compares">
      <div className="history-header">
        <strong>Saved compares</strong>
        <span>{entries.length} saved</span>
      </div>
      <div className="compare-history-list">
        {entries.slice(0, 6).map((entry) => (
          <button className="compare-history-card" key={entry.id} onClick={() => onLoad(entry)} type="button">
            <span className="source-badge">{formatSourceLabel(entry.response.sourceListing.source)}</span>
            <strong>{entry.response.derivedPreset.label}</strong>
            <span>{formatTimestamp(entry.response.search.fetchedAt)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

const emptyPresetForm = {
  label: '',
  description: '',
  category: 'guitar' as Preset['category'],
  searchTerms: '',
  includeKeywords: '',
  excludeKeywords: ''
};

export function App() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [results, setResults] = useState<Record<string, SearchResponse>>({});
  const [searchHistory, setSearchHistory] = useState<Record<string, SearchHistoryEntry[]>>({});
  const [activeSearchJobs, setActiveSearchJobs] = useState<Record<string, PresetJobState>>({});
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [compareUrl, setCompareUrl] = useState('');
  const [activeCompare, setActiveCompare] = useState<CompareJobState | null>(null);
  const [compareResult, setCompareResult] = useState<CompareLinkResponse | null>(null);
  const [compareHistory, setCompareHistory] = useState<CompareHistoryEntry[]>([]);
  const [savingComparedPreset, setSavingComparedPreset] = useState(false);
  const [presetForm, setPresetForm] = useState(emptyPresetForm);
  const [snapshotGeneratedAt, setSnapshotGeneratedAt] = useState<string | null>(null);
  const searchSubscriptionsRef = useRef<Record<string, () => void>>({});
  const compareSubscriptionRef = useRef<(() => void) | null>(null);

  function closeSearchSubscription(presetId: string) {
    searchSubscriptionsRef.current[presetId]?.();
    delete searchSubscriptionsRef.current[presetId];
  }

  function closeAllSearchSubscriptions() {
    for (const presetId of Object.keys(searchSubscriptionsRef.current)) {
      closeSearchSubscription(presetId);
    }
  }

  function closeCompareSubscription() {
    compareSubscriptionRef.current?.();
    compareSubscriptionRef.current = null;
  }

  async function refreshSearchHistoryState() {
    const nextHistory = await fetchSearchHistory();
    setSearchHistory(nextHistory);
    setResults((current) => ({
      ...current,
      ...buildLatestResults(nextHistory)
    }));
  }

  async function refreshCompareHistoryState() {
    const nextHistory = await fetchCompareHistory();
    setCompareHistory(nextHistory);
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        if (snapshotMode) {
          const payload = await fetchSnapshotPayload();
          if (cancelled) {
            return;
          }

          setPresets(payload.presets);
          setSearchHistory(payload.history);
          setResults(payload.latestResults);
          setCompareHistory(payload.compareHistory);
          setCompareResult(payload.compareHistory[0]?.response ?? null);
          setSnapshotGeneratedAt(payload.generatedAt);
          return;
        }

        const [nextPresets, nextSearchHistory, nextCompareHistory] = await Promise.all([
          fetchPresets(),
          fetchSearchHistory(),
          fetchCompareHistory()
        ]);
        if (cancelled) {
          return;
        }

        setPresets(nextPresets);
        setSearchHistory(nextSearchHistory);
        setResults(buildLatestResults(nextSearchHistory));
        setCompareHistory(nextCompareHistory);
        setCompareResult(nextCompareHistory[0]?.response ?? null);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load app data.');
        }
      }
    })();

    return () => {
      cancelled = true;
      closeAllSearchSubscriptions();
      closeCompareSubscription();
    };
  }, []);

  useEffect(() => {
    if (!Object.keys(activeSearchJobs).length && !activeCompare) {
      return undefined;
    }

    setNow(Date.now());
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 250);

    return () => {
      window.clearInterval(interval);
    };
  }, [activeCompare?.jobId, Object.keys(activeSearchJobs).length]);

  async function handleSearch(preset: Preset, forceRefresh: boolean) {
    if (snapshotMode || activeSearchJobs[preset.id]) {
      return;
    }

    setError(null);
    setActiveSearchJobs((current) => ({
      ...current,
      [preset.id]: {
        jobId: '',
        presetId: preset.id,
        totalSources: preset.sources.length,
        completedSources: 0,
        activeSources: [],
        status: 'queued',
        startedAt: Date.now()
      }
    }));

    try {
      const startedJob = await startSearchJob(preset.id, forceRefresh);

      if (startedJob.response) {
        setResults((current) => ({ ...current, [preset.id]: startedJob.response! }));
        setActiveSearchJobs((current) => {
          const next = { ...current };
          delete next[preset.id];
          return next;
        });
        return;
      }

      setActiveSearchJobs((current) => ({
        ...current,
        [preset.id]: {
          ...(current[preset.id] ?? {
            presetId: preset.id,
            totalSources: preset.sources.length,
            completedSources: 0,
            activeSources: [],
            status: 'queued',
            startedAt: Date.now()
          }),
          jobId: startedJob.jobId
        }
      }));

      searchSubscriptionsRef.current[preset.id] = subscribeToSearchJob(startedJob.jobId, {
        onEvent(event: SearchJobEvent) {
          if (event.presetId !== preset.id) {
            return;
          }

          if (event.type === 'queued') {
            setActiveSearchJobs((current) => ({
              ...current,
              [preset.id]: {
                ...(current[preset.id] ?? {
                  jobId: event.jobId,
                  presetId: preset.id,
                  completedSources: 0,
                  activeSources: [],
                  startedAt: Date.now()
                }),
                jobId: event.jobId,
                totalSources: event.totalSources,
                status: 'queued'
              }
            }));
            return;
          }

          if (event.type === 'started') {
            setActiveSearchJobs((current) => ({
              ...current,
              [preset.id]: {
                ...(current[preset.id] ?? {
                  presetId: preset.id,
                  completedSources: 0,
                  activeSources: []
                }),
                jobId: event.jobId,
                presetId: preset.id,
                totalSources: event.totalSources,
                completedSources: current[preset.id]?.completedSources ?? 0,
                activeSources: current[preset.id]?.activeSources ?? [],
                status: 'running',
                startedAt: Date.parse(event.at)
              }
            }));
            return;
          }

          if (event.type === 'source_started') {
            setActiveSearchJobs((current) => {
              const existing = current[preset.id];
              if (!existing) {
                return current;
              }

              return {
                ...current,
                [preset.id]: {
                  ...existing,
                  status: 'running',
                  activeSources: existing.activeSources.includes(event.source)
                    ? existing.activeSources
                    : [...existing.activeSources, event.source]
                }
              };
            });
            return;
          }

          if (event.type === 'source_completed') {
            setActiveSearchJobs((current) => {
              const existing = current[preset.id];
              if (!existing) {
                return current;
              }

              return {
                ...current,
                [preset.id]: {
                  ...existing,
                  completedSources: event.completedSources,
                  activeSources: existing.activeSources.filter((source) => source !== event.source)
                }
              };
            });
            return;
          }

          if (event.type === 'completed') {
            setResults((current) => ({ ...current, [preset.id]: event.response }));
            setActiveSearchJobs((current) => {
              const next = { ...current };
              delete next[preset.id];
              return next;
            });
            closeSearchSubscription(preset.id);
            void refreshSearchHistoryState().catch(() => undefined);
            return;
          }

          if (event.type === 'failed') {
            setError(event.error);
            setActiveSearchJobs((current) => {
              const next = { ...current };
              delete next[preset.id];
              return next;
            });
            closeSearchSubscription(preset.id);
          }
        },
        onError(searchError) {
          setError(searchError.message);
          setActiveSearchJobs((current) => {
            const next = { ...current };
            delete next[preset.id];
            return next;
          });
          closeSearchSubscription(preset.id);
        }
      });
    } catch (searchError) {
      const message = searchError instanceof Error ? searchError.message : 'Search failed.';
      setError(message);
      setActiveSearchJobs((current) => {
        const next = { ...current };
        delete next[preset.id];
        return next;
      });
    }
  }

  async function handleCompare(forceRefresh: boolean) {
    if (snapshotMode) {
      return;
    }

    if (!compareUrl.trim()) {
      setError('Paste a listing URL first.');
      return;
    }

    closeCompareSubscription();
    setError(null);
    setActiveCompare({
      jobId: '',
      url: compareUrl.trim(),
      totalUnits: 1,
      completedUnits: 0,
      activeSources: [],
      status: 'queued',
      phase: 'fetch_listing',
      startedAt: Date.now(),
      derivedPreset: null
    });

    try {
      const startedJob = await startCompareJob(compareUrl.trim(), forceRefresh);

      if (startedJob.response) {
        setCompareResult(startedJob.response);
        setActiveCompare(null);
        return;
      }

      setActiveCompare((current) =>
        current
          ? {
              ...current,
              jobId: startedJob.jobId
            }
          : current
      );

      compareSubscriptionRef.current = subscribeToCompareJob(startedJob.jobId, {
        onEvent(event: CompareJobEvent) {
          if (event.type === 'queued') {
            setActiveCompare((current) =>
              current
                ? {
                    ...current,
                    jobId: event.jobId,
                    totalUnits: event.totalUnits,
                    status: 'queued'
                  }
                : current
            );
            return;
          }

          if (event.type === 'started') {
            setActiveCompare((current) =>
              current
                ? {
                    ...current,
                    jobId: event.jobId,
                    totalUnits: event.totalUnits,
                    status: 'running',
                    startedAt: Date.parse(event.at)
                  }
                : current
            );
            return;
          }

          if (event.type === 'stage_completed') {
            setActiveCompare((current) =>
              current
                ? {
                    ...current,
                    completedUnits: event.completedUnits,
                    totalUnits: event.totalUnits,
                    phase: 'search',
                    derivedPreset: event.derivedPreset
                  }
                : current
            );
            return;
          }

          if (event.type === 'source_started') {
            setActiveCompare((current) =>
              current
                ? {
                    ...current,
                    phase: 'search',
                    totalUnits: event.totalUnits,
                    activeSources: current.activeSources.includes(event.source)
                      ? current.activeSources
                      : [...current.activeSources, event.source]
                  }
                : current
            );
            return;
          }

          if (event.type === 'source_completed') {
            setActiveCompare((current) =>
              current
                ? {
                    ...current,
                    completedUnits: event.completedUnits,
                    totalUnits: event.totalUnits,
                    activeSources: current.activeSources.filter((source) => source !== event.source)
                  }
                : current
            );
            return;
          }

          if (event.type === 'completed') {
            setCompareResult(event.response);
            setActiveCompare(null);
            closeCompareSubscription();
            void refreshCompareHistoryState().catch(() => undefined);
            return;
          }

          if (event.type === 'failed') {
            setError(event.error);
            setActiveCompare(null);
            closeCompareSubscription();
          }
        },
        onError(compareError) {
          setError(compareError.message);
          setActiveCompare(null);
          closeCompareSubscription();
        }
      });
    } catch (compareError) {
      const message = compareError instanceof Error ? compareError.message : 'Compare failed.';
      setError(message);
      setActiveCompare(null);
    }
  }

  async function handleCreatePreset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const payload: CreatePresetRequest = {
      label: presetForm.label,
      description: presetForm.description,
      category: presetForm.category,
      searchTerms: parseCommaList(presetForm.searchTerms),
      includeKeywords: parseCommaList(presetForm.includeKeywords),
      excludeKeywords: parseCommaList(presetForm.excludeKeywords)
    };

    try {
      const created = await createPreset(payload);
      setPresets((current) => [...current, created]);
      setPresetForm(emptyPresetForm);
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : 'Unable to create preset.';
      setError(message);
    }
  }

  async function handleSaveComparedPreset() {
    if (!compareResult) {
      return;
    }

    setSavingComparedPreset(true);
    setError(null);

    try {
      const derivedPreset = compareResult.derivedPreset;
      const created = await createPreset({
        label: derivedPreset.label,
        description: derivedPreset.description,
        category: derivedPreset.category,
        searchTerms: derivedPreset.searchTerms,
        includeKeywords: derivedPreset.includeKeywords,
        excludeKeywords: derivedPreset.excludeKeywords,
        blueFinishKeywords: derivedPreset.blueFinishKeywords,
        localPickupRadiusMiles: derivedPreset.localPickupRadiusMiles,
        homeBaseLabel: derivedPreset.homeBaseLabel
      });

      setPresets((current) => [...current, created]);
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : 'Unable to save derived preset.';
      setError(message);
    } finally {
      setSavingComparedPreset(false);
    }
  }

  async function handleDeletePreset(presetId: string) {
    if (snapshotMode || !window.confirm('Delete this preset?')) {
      return;
    }

    setError(null);
    try {
      await deletePreset(presetId);
      setPresets((current) => current.filter((preset) => preset.id !== presetId));
      setResults((current) => {
        const next = { ...current };
        delete next[presetId];
        return next;
      });
      setSearchHistory((current) => {
        const next = { ...current };
        delete next[presetId];
        return next;
      });
      closeSearchSubscription(presetId);
      setActiveSearchJobs((current) => {
        const next = { ...current };
        delete next[presetId];
        return next;
      });
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : 'Unable to delete preset.';
      setError(message);
    }
  }

  const activeCompareElapsed = activeCompare ? now - activeCompare.startedAt : 0;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark">UGF</span>
          <div>
            <p className="eyebrow">{snapshotMode ? 'Used Price Snapshot' : 'Used Price Scraper'}</p>
            <h1>
              {snapshotMode
                ? 'Browse saved preset snapshots and compare history'
                : 'Search presets or compare from a pasted listing URL'}
            </h1>
            {snapshotGeneratedAt ? <p className="snapshot-copy">Snapshot updated {formatTimestamp(snapshotGeneratedAt)}</p> : null}
          </div>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="tool-grid">
        <section className="tool-panel">
          <p className="preset-tag">{snapshotMode ? 'Saved compares' : 'Compare from link'}</p>

          {!snapshotMode ? (
            <>
              <label className="field-label" htmlFor="compare-url">
                Listing URL
              </label>
              <input
                id="compare-url"
                className="text-input"
                onChange={(event) => setCompareUrl(event.target.value)}
                placeholder="Paste an eBay, Reverb, Guitar Center, or other listing URL"
                type="url"
                value={compareUrl}
              />
              <div className="tool-actions">
                <button className="button button-primary" disabled={Boolean(activeCompare)} onClick={() => void handleCompare(false)} type="button">
                  {activeCompare ? 'Comparing...' : 'Find comparables'}
                </button>
                <button
                  className="button button-secondary"
                  disabled={Boolean(activeCompare)}
                  onClick={() => void handleCompare(true)}
                  type="button"
                >
                  Refresh compare
                </button>
              </div>
              {activeCompare ? <CompareProgressBar elapsedMs={activeCompareElapsed} state={activeCompare} /> : null}
            </>
          ) : (
            <p className="snapshot-copy">Live compare is disabled in snapshot mode. Saved compare results stay browsable here.</p>
          )}

          <CompareHistorySection
            entries={compareHistory}
            onLoad={(entry) => {
              setCompareUrl(entry.url);
              setCompareResult(entry.response);
            }}
          />
        </section>

        {!snapshotMode ? (
          <form className="tool-panel" onSubmit={handleCreatePreset}>
            <p className="preset-tag">Add preset</p>
            <div className="form-grid">
              <label>
                <span className="field-label">Label</span>
                <input
                  className="text-input"
                  onChange={(event) => setPresetForm((current) => ({ ...current, label: event.target.value }))}
                  value={presetForm.label}
                />
              </label>
              <label>
                <span className="field-label">Category</span>
                <select
                  className="text-input"
                  onChange={(event) =>
                    setPresetForm((current) => ({
                      ...current,
                      category: event.target.value as Preset['category']
                    }))
                  }
                  value={presetForm.category}
                >
                  <option value="guitar">Guitar</option>
                  <option value="effects">Effects</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="form-span-2">
                <span className="field-label">Description</span>
                <input
                  className="text-input"
                  onChange={(event) => setPresetForm((current) => ({ ...current, description: event.target.value }))}
                  value={presetForm.description}
                />
              </label>
              <label className="form-span-2">
                <span className="field-label">Search terms</span>
                <input
                  className="text-input"
                  onChange={(event) => setPresetForm((current) => ({ ...current, searchTerms: event.target.value }))}
                  placeholder="comma separated"
                  value={presetForm.searchTerms}
                />
              </label>
              <label>
                <span className="field-label">Include keywords</span>
                <input
                  className="text-input"
                  onChange={(event) => setPresetForm((current) => ({ ...current, includeKeywords: event.target.value }))}
                  placeholder="comma separated"
                  value={presetForm.includeKeywords}
                />
              </label>
              <label>
                <span className="field-label">Exclude keywords</span>
                <input
                  className="text-input"
                  onChange={(event) => setPresetForm((current) => ({ ...current, excludeKeywords: event.target.value }))}
                  placeholder="comma separated"
                  value={presetForm.excludeKeywords}
                />
              </label>
            </div>
            <div className="tool-actions">
              <button className="button button-primary" type="submit">
                Save preset
              </button>
            </div>
          </form>
        ) : (
          <section className="tool-panel">
            <p className="preset-tag">Add preset</p>
            <p className="snapshot-copy">
              GitHub Pages cannot save presets directly. Submit a preset request issue and the repo automation will add it to the next snapshot
              deploy.
            </p>
            {presetRequestUrl ? (
              <div className="tool-actions">
                <a className="button button-primary button-link" href={presetRequestUrl} rel="noreferrer" target="_blank">
                  Request preset
                </a>
              </div>
            ) : null}
          </section>
        )}
      </section>

      {compareResult ? (
        <section className="compare-section">
          {!snapshotMode ? (
            <div className="tool-actions compare-actions">
              <button
                className="button button-secondary"
                disabled={savingComparedPreset}
                onClick={() => void handleSaveComparedPreset()}
                type="button"
              >
                {savingComparedPreset ? 'Saving preset...' : 'Save as preset'}
              </button>
            </div>
          ) : null}
          <ResultsPanel
            heading={compareResult.derivedPreset.label}
            response={compareResult.search}
            sourceListing={compareResult.sourceListing}
          />
        </section>
      ) : null}

      <section className="preset-grid">
        {presets.map((preset) => {
          const response = results[preset.id];
          const activeJob = activeSearchJobs[preset.id];
          const historyEntries = searchHistory[preset.id] ?? [];

          return (
            <article className="preset-card" key={preset.id}>
              <div className="preset-header">
                <h2>{preset.label}</h2>
                {!snapshotMode ? (
                  <div className="preset-actions">
                    <button
                      className="button button-primary"
                      disabled={Boolean(activeJob)}
                      onClick={() => void handleSearch(preset, false)}
                    >
                      {activeJob ? (activeJob.status === 'queued' ? 'Queued...' : 'Searching...') : 'Search'}
                    </button>
                    <button
                      className="button button-secondary"
                      disabled={Boolean(activeJob)}
                      onClick={() => void handleSearch(preset, true)}
                    >
                      Refresh now
                    </button>
                    <button
                      className="button button-danger"
                      disabled={Boolean(activeJob)}
                      onClick={() => void handleDeletePreset(preset.id)}
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>

              {activeJob ? <SearchProgressBar elapsedMs={now - activeJob.startedAt} state={activeJob} /> : null}

              <SearchHistorySection
                entries={historyEntries}
                onLoad={(entry) => {
                  setResults((current) => ({ ...current, [preset.id]: entry.response }));
                }}
              />

              {response ? <ResultsPanel response={response} /> : null}
            </article>
          );
        })}
      </section>
    </div>
  );
}
