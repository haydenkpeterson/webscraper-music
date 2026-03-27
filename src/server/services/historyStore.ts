import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type {
  CompareHistoryEntry,
  CompareLinkResponse,
  SearchHistoryEntry,
  SearchResponse
} from '../../shared/types.js';
import { HISTORY_RETENTION_LIMIT, RESULT_FRESH_TTL_MS } from '../config.js';

type SearchHistoryFile = {
  version: 1;
  history: Record<string, SearchHistoryEntry[]>;
};

type CompareHistoryFile = {
  version: 1;
  entries: CompareHistoryEntry[];
};

const EMPTY_SEARCH_HISTORY: SearchHistoryFile = {
  version: 1,
  history: {}
};

const EMPTY_COMPARE_HISTORY: CompareHistoryFile = {
  version: 1,
  entries: []
};

let searchWriteQueue: Promise<void> = Promise.resolve();
let compareWriteQueue: Promise<void> = Promise.resolve();

function getSearchHistoryPath(): string {
  return process.env.SEARCH_HISTORY_PATH ?? path.resolve(process.cwd(), 'data', 'search-history.json');
}

function getCompareHistoryPath(): string {
  return process.env.COMPARE_HISTORY_PATH ?? path.resolve(process.cwd(), 'data', 'compare-history.json');
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sortByTimestampDescending<T>(entries: T[], getTimestamp: (entry: T) => string): T[] {
  return [...entries].sort((left, right) => Date.parse(getTimestamp(right)) - Date.parse(getTimestamp(left)));
}

function isFresh(fetchedAt: string, ttlMs = RESULT_FRESH_TTL_MS): boolean {
  return Date.now() - Date.parse(fetchedAt) < ttlMs;
}

function toFreshSearchEntry(entry: SearchHistoryEntry): SearchHistoryEntry {
  return {
    ...entry,
    fresh: isFresh(entry.response.fetchedAt)
  };
}

function toFreshCompareEntry(entry: CompareHistoryEntry): CompareHistoryEntry {
  return {
    ...entry,
    fresh: isFresh(entry.response.search.fetchedAt)
  };
}

async function readSearchHistoryFile(): Promise<SearchHistoryFile> {
  await searchWriteQueue;
  const file = await readJsonFile<SearchHistoryFile>(getSearchHistoryPath(), EMPTY_SEARCH_HISTORY);
  return {
    version: 1,
      history: Object.fromEntries(
      Object.entries(file.history ?? {}).map(([presetId, entries]) => [
        presetId,
        sortByTimestampDescending(entries ?? [], (entry) => entry.response.fetchedAt).map(toFreshSearchEntry)
      ])
    )
  };
}

async function readCompareHistoryFile(): Promise<CompareHistoryFile> {
  await compareWriteQueue;
  const file = await readJsonFile<CompareHistoryFile>(getCompareHistoryPath(), EMPTY_COMPARE_HISTORY);
  return {
    version: 1,
    entries: sortByTimestampDescending(file.entries ?? [], (entry) => entry.response.search.fetchedAt).map(
      toFreshCompareEntry
    )
  };
}

async function updateSearchHistory<T>(mutate: (file: SearchHistoryFile) => T | Promise<T>): Promise<T> {
  let result!: T;
  searchWriteQueue = searchWriteQueue
    .catch(() => undefined)
    .then(async () => {
      const file = await readJsonFile<SearchHistoryFile>(getSearchHistoryPath(), EMPTY_SEARCH_HISTORY);
      file.version = 1;
      file.history ??= {};
      result = await mutate(file);
      await writeJsonFile(getSearchHistoryPath(), file);
    });
  await searchWriteQueue;
  return result;
}

async function updateCompareHistory<T>(mutate: (file: CompareHistoryFile) => T | Promise<T>): Promise<T> {
  let result!: T;
  compareWriteQueue = compareWriteQueue
    .catch(() => undefined)
    .then(async () => {
      const file = await readJsonFile<CompareHistoryFile>(getCompareHistoryPath(), EMPTY_COMPARE_HISTORY);
      file.version = 1;
      file.entries ??= [];
      result = await mutate(file);
      await writeJsonFile(getCompareHistoryPath(), file);
    });
  await compareWriteQueue;
  return result;
}

function trimSearchEntries(entries: SearchHistoryEntry[]): SearchHistoryEntry[] {
  return sortByTimestampDescending(entries, (entry) => entry.response.fetchedAt).slice(0, HISTORY_RETENTION_LIMIT);
}

function trimCompareEntries(entries: CompareHistoryEntry[]): CompareHistoryEntry[] {
  return sortByTimestampDescending(entries, (entry) => entry.response.search.fetchedAt).slice(0, HISTORY_RETENTION_LIMIT);
}

export async function listSearchHistory(): Promise<Record<string, SearchHistoryEntry[]>> {
  return (await readSearchHistoryFile()).history;
}

export async function listSearchHistoryForPreset(presetId: string): Promise<SearchHistoryEntry[]> {
  const history = await listSearchHistory();
  return history[presetId] ?? [];
}

export async function getLatestSavedSearchResponse(presetId: string): Promise<SearchResponse | undefined> {
  const [latest] = await listSearchHistoryForPreset(presetId);
  if (!latest?.fresh) {
    return undefined;
  }
  return latest.response;
}

export async function saveSearchHistory(presetId: string, response: SearchResponse): Promise<SearchHistoryEntry> {
  return updateSearchHistory((file) => {
    const entry: SearchHistoryEntry = {
      id: randomUUID(),
      presetId,
      savedAt: new Date().toISOString(),
      response: {
        ...response,
        cached: false,
        sourceStatuses: response.sourceStatuses.map((status) => ({ ...status, cached: false }))
      },
      fresh: true
    };

    file.history[presetId] = trimSearchEntries([entry, ...(file.history[presetId] ?? [])]);
    return toFreshSearchEntry(entry);
  });
}

export async function listCompareHistory(url?: string): Promise<CompareHistoryEntry[]> {
  const entries = (await readCompareHistoryFile()).entries;
  if (!url) {
    return entries;
  }
  return entries.filter((entry) => entry.url === url);
}

export async function getLatestSavedCompareResponse(url: string): Promise<CompareLinkResponse | undefined> {
  const [latest] = await listCompareHistory(url);
  if (!latest?.fresh) {
    return undefined;
  }
  return latest.response;
}

export async function saveCompareHistory(url: string, response: CompareLinkResponse): Promise<CompareHistoryEntry> {
  return updateCompareHistory((file) => {
    const entry: CompareHistoryEntry = {
      id: randomUUID(),
      url,
      savedAt: new Date().toISOString(),
      response: {
        ...response,
        cached: false,
        search: {
          ...response.search,
          cached: false,
          sourceStatuses: response.search.sourceStatuses.map((status) => ({ ...status, cached: false }))
        }
      },
      fresh: true
    };

    const retainedForUrl = trimCompareEntries([entry, ...file.entries.filter((existing) => existing.url === url)]);
    file.entries = sortByTimestampDescending(
      [
      ...retainedForUrl,
      ...file.entries.filter((existing) => existing.url !== url)
      ],
      (entry) => entry.response.search.fetchedAt
    );
    return toFreshCompareEntry(entry);
  });
}
