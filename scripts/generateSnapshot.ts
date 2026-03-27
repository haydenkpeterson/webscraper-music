import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { listCompareHistory, listSearchHistory } from '../src/server/services/historyStore.js';
import { listPresets } from '../src/server/services/presetStore.js';
import { createSearchService } from '../src/server/services/searchService.js';
import type { SearchHistoryEntry, SnapshotPayload } from '../src/shared/types.js';

function buildLatestResults(history: Record<string, SearchHistoryEntry[]>) {
  return Object.fromEntries(
    Object.entries(history)
      .filter(([, entries]) => Boolean(entries[0]))
      .map(([presetId, entries]) => [presetId, entries[0]!.response])
  );
}

async function refreshAllPresets(): Promise<void> {
  const searchService = createSearchService();
  const presets = await listPresets();

  for (const preset of presets) {
    console.log(`Refreshing ${preset.label}...`);
    await searchService.search(preset, { forceRefresh: true });
  }
}

async function writeSnapshotPayload(payload: SnapshotPayload): Promise<void> {
  const outputPath = path.resolve(process.cwd(), 'public', 'snapshot-data.json');
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  const shouldRefreshPresets = process.argv.includes('--refresh-presets');
  if (shouldRefreshPresets) {
    await refreshAllPresets();
  }

  const presets = await listPresets();
  const history = await listSearchHistory();
  const compareHistory = await listCompareHistory();
  const payload: SnapshotPayload = {
    generatedAt: new Date().toISOString(),
    presets,
    latestResults: buildLatestResults(history),
    history,
    compareHistory
  };

  await writeSnapshotPayload(payload);
  console.log(`Wrote snapshot payload with ${presets.length} presets.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
