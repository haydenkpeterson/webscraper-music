import { compactWhitespace } from '../../shared/filters.js';
import type { CreatePresetRequest, PresetCategory } from '../../shared/types.js';

const noResponsePattern = /^_no response_$/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeField(value: string): string {
  const normalized = compactWhitespace(value.replace(/\r/g, ''));
  return noResponsePattern.test(normalized) ? '' : normalized;
}

function normalizeMultilineField(value: string): string {
  const normalized = value
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();

  return noResponsePattern.test(compactWhitespace(normalized)) ? '' : normalized;
}

function extractSection(body: string, heading: string): string {
  const pattern = new RegExp(`###\\s+${escapeRegExp(heading)}\\s*\\n([\\s\\S]*?)(?=\\n###\\s+|$)`, 'i');
  return normalizeMultilineField(body.match(pattern)?.[1] ?? '');
}

function parseListField(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((entry) => compactWhitespace(entry))
    .filter(Boolean);
}

function parseCategory(value: string): PresetCategory {
  const normalized = value.toLowerCase();
  if (normalized === 'effects' || normalized === 'other') {
    return normalized;
  }

  return 'guitar';
}

export function parsePresetRequestIssueBody(body: string): CreatePresetRequest {
  const localPickupRadiusText = extractSection(body, 'Local pickup radius miles');
  const localPickupRadiusMiles = localPickupRadiusText ? Number.parseFloat(localPickupRadiusText) : undefined;
  if (localPickupRadiusText && !Number.isFinite(localPickupRadiusMiles)) {
    throw new Error('Local pickup radius miles must be a number.');
  }

  const blueFinishKeywords = parseListField(extractSection(body, 'Blue finish keywords'));
  const homeBaseLabel = extractSection(body, 'Home base label');

  return {
    label: extractSection(body, 'Label'),
    description: extractSection(body, 'Description'),
    category: parseCategory(extractSection(body, 'Category')),
    searchTerms: parseListField(extractSection(body, 'Search terms')),
    includeKeywords: parseListField(extractSection(body, 'Include keywords')),
    excludeKeywords: parseListField(extractSection(body, 'Exclude keywords')),
    blueFinishKeywords: blueFinishKeywords.length ? blueFinishKeywords : undefined,
    localPickupRadiusMiles,
    homeBaseLabel: homeBaseLabel || undefined
  };
}
