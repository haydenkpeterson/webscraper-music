export type MarketplaceSource = 'ebay' | 'reverb' | 'guitarcenter';
export type PresetCategory = 'guitar' | 'effects' | 'other';

export interface Preset {
  id: string;
  label: string;
  description: string;
  category: PresetCategory;
  sources: MarketplaceSource[];
  searchTerms: string[];
  includeKeywords: string[];
  excludeKeywords: string[];
  blueFinishKeywords?: string[];
  localPickupRadiusMiles?: number;
  homeBaseLabel?: string;
}

export interface Listing {
  id: string;
  source: MarketplaceSource;
  title: string;
  condition: string;
  itemPrice: number;
  shippingPrice: number | null;
  totalPrice: number | null;
  currency: string;
  location: string;
  url: string;
  imageUrl: string | null;
  fetchedAt: string;
  shippingLabel?: string | null;
  localOnly: boolean;
  distanceMiles: number | null;
}

export interface SourceStatus {
  source: MarketplaceSource;
  ok: boolean;
  count: number;
  durationMs: number;
  message?: string;
  cached?: boolean;
}

export interface SearchSummary {
  totalResults: number;
  bestOverall: Listing | null;
  bestBySource: Partial<Record<MarketplaceSource, Listing>>;
}

export interface SearchResponse {
  preset: Preset;
  results: Listing[];
  summary: SearchSummary;
  sourceStatuses: SourceStatus[];
  cached: boolean;
  fetchedAt: string;
}

export interface SearchRequest {
  presetId: string;
  forceRefresh?: boolean;
}

export interface SearchJobStartResponse {
  jobId: string;
  cached?: boolean;
  response?: SearchResponse;
}

export interface SearchHistoryEntry {
  id: string;
  presetId: string;
  savedAt: string;
  response: SearchResponse;
  fresh: boolean;
}

export interface SearchHistoryResponse {
  history: Record<string, SearchHistoryEntry[]>;
}

export interface SearchProgressStartedEvent {
  type: 'started';
  at: string;
  totalSources: number;
}

export interface SearchProgressSourceStartedEvent {
  type: 'source_started';
  at: string;
  source: MarketplaceSource;
  completedSources: number;
  totalSources: number;
}

export interface SearchProgressSourceCompletedEvent {
  type: 'source_completed';
  at: string;
  source: MarketplaceSource;
  completedSources: number;
  totalSources: number;
  status: SourceStatus;
}

export type SearchProgressEvent =
  | SearchProgressStartedEvent
  | SearchProgressSourceStartedEvent
  | SearchProgressSourceCompletedEvent;

export interface SearchJobQueuedEvent {
  type: 'queued';
  at: string;
  jobId: string;
  presetId: string;
  totalSources: number;
  forceRefresh: boolean;
}

export interface SearchJobStartedEvent extends SearchProgressStartedEvent {
  jobId: string;
  presetId: string;
}

export interface SearchJobSourceStartedEvent extends SearchProgressSourceStartedEvent {
  jobId: string;
  presetId: string;
}

export interface SearchJobSourceCompletedEvent extends SearchProgressSourceCompletedEvent {
  jobId: string;
  presetId: string;
}

export interface SearchJobCompletedEvent {
  type: 'completed';
  at: string;
  jobId: string;
  presetId: string;
  completedSources: number;
  totalSources: number;
  cached: boolean;
  response: SearchResponse;
}

export interface SearchJobFailedEvent {
  type: 'failed';
  at: string;
  jobId: string;
  presetId: string;
  completedSources: number;
  totalSources: number;
  error: string;
}

export type SearchJobEvent =
  | SearchJobQueuedEvent
  | SearchJobStartedEvent
  | SearchJobSourceStartedEvent
  | SearchJobSourceCompletedEvent
  | SearchJobCompletedEvent
  | SearchJobFailedEvent;

export interface CreatePresetRequest {
  label: string;
  description: string;
  category: PresetCategory;
  searchTerms: string[];
  includeKeywords: string[];
  excludeKeywords: string[];
  blueFinishKeywords?: string[];
  localPickupRadiusMiles?: number;
  homeBaseLabel?: string;
}

export interface ComparableSourceListing {
  source: MarketplaceSource | 'unknown';
  title: string;
  url: string;
  condition: string;
  itemPrice: number | null;
  shippingPrice: number | null;
  location: string;
  shippingLabel?: string | null;
  localOnly: boolean;
}

export interface CompareLinkRequest {
  url: string;
  forceRefresh?: boolean;
}

export interface CompareLinkResponse {
  sourceListing: ComparableSourceListing;
  derivedPreset: Preset;
  search: SearchResponse;
  cached: boolean;
}

export interface CompareJobStartResponse {
  jobId: string;
  cached?: boolean;
  response?: CompareLinkResponse;
}

export interface CompareProgressStartedEvent {
  type: 'started';
  at: string;
  totalUnits: number;
}

export interface CompareProgressStageCompletedEvent {
  type: 'stage_completed';
  at: string;
  stage: 'fetch_listing';
  completedUnits: number;
  totalUnits: number;
  derivedPreset: Preset;
}

export interface CompareProgressSourceStartedEvent {
  type: 'source_started';
  at: string;
  source: MarketplaceSource;
  completedUnits: number;
  totalUnits: number;
}

export interface CompareProgressSourceCompletedEvent {
  type: 'source_completed';
  at: string;
  source: MarketplaceSource;
  completedUnits: number;
  totalUnits: number;
  status: SourceStatus;
}

export type CompareProgressEvent =
  | CompareProgressStartedEvent
  | CompareProgressStageCompletedEvent
  | CompareProgressSourceStartedEvent
  | CompareProgressSourceCompletedEvent;

export interface CompareJobQueuedEvent {
  type: 'queued';
  at: string;
  jobId: string;
  url: string;
  totalUnits: number;
  forceRefresh: boolean;
}

export interface CompareJobStartedEvent extends CompareProgressStartedEvent {
  jobId: string;
  url: string;
}

export interface CompareJobStageCompletedEvent extends CompareProgressStageCompletedEvent {
  jobId: string;
  url: string;
}

export interface CompareJobSourceStartedEvent extends CompareProgressSourceStartedEvent {
  jobId: string;
  url: string;
}

export interface CompareJobSourceCompletedEvent extends CompareProgressSourceCompletedEvent {
  jobId: string;
  url: string;
}

export interface CompareJobCompletedEvent {
  type: 'completed';
  at: string;
  jobId: string;
  url: string;
  completedUnits: number;
  totalUnits: number;
  cached: boolean;
  response: CompareLinkResponse;
}

export interface CompareJobFailedEvent {
  type: 'failed';
  at: string;
  jobId: string;
  url: string;
  completedUnits: number;
  totalUnits: number;
  error: string;
}

export type CompareJobEvent =
  | CompareJobQueuedEvent
  | CompareJobStartedEvent
  | CompareJobStageCompletedEvent
  | CompareJobSourceStartedEvent
  | CompareJobSourceCompletedEvent
  | CompareJobCompletedEvent
  | CompareJobFailedEvent;

export interface CompareHistoryEntry {
  id: string;
  url: string;
  savedAt: string;
  response: CompareLinkResponse;
  fresh: boolean;
}

export interface CompareHistoryResponse {
  entries: CompareHistoryEntry[];
}

export interface SnapshotPayload {
  generatedAt: string;
  presets: Preset[];
  latestResults: Record<string, SearchResponse>;
  history: Record<string, SearchHistoryEntry[]>;
  compareHistory: CompareHistoryEntry[];
}
