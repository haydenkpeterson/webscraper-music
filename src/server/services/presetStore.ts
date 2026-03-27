import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { defaultPresets, DEFAULT_LOCAL_PICKUP_RADIUS_MILES, PROVO_HOME_BASE } from '../../shared/presets.js';
import { compactWhitespace, normalizeText } from '../../shared/filters.js';
import type { CreatePresetRequest, Preset } from '../../shared/types.js';

function getPresetStorePath(): string {
  return process.env.PRESET_STORE_PATH ?? path.resolve(process.cwd(), 'data', 'presets.json');
}

function slugify(value: string): string {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function normalizeArray(values: string[]): string[] {
  return [...new Set(values.map((value) => compactWhitespace(value)).filter(Boolean))];
}

function normalizePreset(preset: Preset): Preset {
  return {
    ...preset,
    label: compactWhitespace(preset.label),
    description: compactWhitespace(preset.description),
    searchTerms: normalizeArray(preset.searchTerms),
    includeKeywords: normalizeArray(preset.includeKeywords),
    excludeKeywords: normalizeArray(preset.excludeKeywords),
    blueFinishKeywords: preset.blueFinishKeywords ? normalizeArray(preset.blueFinishKeywords) : undefined,
    localPickupRadiusMiles: preset.localPickupRadiusMiles ?? DEFAULT_LOCAL_PICKUP_RADIUS_MILES,
    homeBaseLabel: compactWhitespace(preset.homeBaseLabel ?? PROVO_HOME_BASE)
  };
}

async function readStore(): Promise<Preset[]> {
  const filePath = getPresetStorePath();

  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Preset[];
    return parsed.map(normalizePreset);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }

    await seedStore();
    return defaultPresets.map(normalizePreset);
  }
}

async function writeStore(presets: Preset[]): Promise<void> {
  const filePath = getPresetStorePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(presets.map(normalizePreset), null, 2)}\n`, 'utf8');
}

export async function seedStore(): Promise<void> {
  await writeStore(defaultPresets);
}

export async function listPresets(): Promise<Preset[]> {
  return readStore();
}

export async function getPreset(id: string): Promise<Preset | undefined> {
  const presets = await readStore();
  return presets.find((preset) => preset.id === id);
}

function validatePresetInput(input: CreatePresetRequest): Preset {
  const label = compactWhitespace(input.label);
  const description = compactWhitespace(input.description);
  const searchTerms = normalizeArray(input.searchTerms);
  const includeKeywords = normalizeArray(input.includeKeywords);
  const excludeKeywords = normalizeArray(input.excludeKeywords);
  const blueFinishKeywords = input.blueFinishKeywords ? normalizeArray(input.blueFinishKeywords) : undefined;

  if (!label) {
    throw new Error('Preset label is required.');
  }

  if (!description) {
    throw new Error('Preset description is required.');
  }

  if (!searchTerms.length) {
    throw new Error('At least one search term is required.');
  }

  if (!includeKeywords.length) {
    throw new Error('At least one include keyword is required.');
  }

  return normalizePreset({
    id: slugify(label) || `preset_${Date.now()}`,
    label,
    description,
    category: input.category,
    sources: ['ebay', 'reverb', 'guitarcenter'],
    searchTerms,
    includeKeywords,
    excludeKeywords,
    blueFinishKeywords,
    localPickupRadiusMiles: input.localPickupRadiusMiles ?? DEFAULT_LOCAL_PICKUP_RADIUS_MILES,
    homeBaseLabel: input.homeBaseLabel ?? PROVO_HOME_BASE
  });
}

export async function createPreset(input: CreatePresetRequest): Promise<Preset> {
  const presets = await readStore();
  const preset = validatePresetInput(input);
  if (presets.some((existing) => existing.id === preset.id)) {
    throw new Error('A preset with that label already exists.');
  }

  const nextPresets = [...presets, preset];
  await writeStore(nextPresets);
  return preset;
}

export async function deletePreset(id: string): Promise<boolean> {
  const presets = await readStore();
  const nextPresets = presets.filter((preset) => preset.id !== id);
  if (nextPresets.length === presets.length) {
    return false;
  }

  await writeStore(nextPresets);
  return true;
}
