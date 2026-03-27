import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultPresets } from '../src/shared/presets';
import { createPreset, deletePreset, listPresets } from '../src/server/services/presetStore';

describe('preset store', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'webscraper-music-'));
    process.env.PRESET_STORE_PATH = path.join(tempDir, 'presets.json');
  });

  afterEach(async () => {
    delete process.env.PRESET_STORE_PATH;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('seeds defaults and persists create/delete operations', async () => {
    const seeded = await listPresets();
    expect(seeded).toHaveLength(defaultPresets.length);

    const created = await createPreset({
      label: 'Boss DD-8',
      description: 'Delay pedal',
      category: 'effects',
      searchTerms: ['boss dd-8 delay'],
      includeKeywords: ['boss', 'dd-8'],
      excludeKeywords: ['power supply']
    });

    const afterCreate = await listPresets();
    expect(afterCreate.some((preset) => preset.id === created.id)).toBe(true);

    const deleted = await deletePreset(created.id);
    expect(deleted).toBe(true);

    const afterDelete = await listPresets();
    expect(afterDelete.some((preset) => preset.id === created.id)).toBe(false);
  });
});
