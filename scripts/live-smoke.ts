import { createSearchService } from '../src/server/services/searchService.js';
import { listPresets } from '../src/server/services/presetStore.js';

async function main() {
  const searchService = createSearchService();
  const presets = await listPresets();
  for (const presetId of ['blue_fender_telecaster', 'line6_hx_stomp']) {
    const preset = presets.find((entry) => entry.id === presetId);
    if (!preset) {
      throw new Error(`Missing preset: ${presetId}`);
    }

    const response = await searchService.search(preset, { forceRefresh: true });
    console.log(`\n${preset.label}`);
    console.log(`Total results: ${response.summary.totalResults}`);
    for (const status of response.sourceStatuses) {
      console.log(`- ${status.source}: ${status.ok ? `${status.count} hits` : `failed (${status.message ?? 'unknown'})`}`);
    }

    if (!response.results.length && response.sourceStatuses.every((status) => !status.ok)) {
      throw new Error(`All sources failed for ${preset.label}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
