import { describe, expect, it } from 'vitest';
import { buildDerivedPreset } from '../src/server/services/compareService';

describe('compare preset derivation', () => {
  it('derives a usable synth preset from a Sequential Take 5 listing title', () => {
    const preset = buildDerivedPreset(
      'Sequential Take 5 44-Key 5-Voice Compact Polyphonic Synthesizer 2021 - Present - Black'
    );

    expect(preset.category).toBe('other');
    expect(preset.includeKeywords).toEqual(['sequential', 'take 5']);
    expect(preset.searchTerms).toContain('sequential take 5');
    expect(preset.searchTerms).toContain('sequential take 5 synthesizer');
    expect(preset.excludeKeywords).toContain('stand');
    expect(preset.excludeKeywords).toContain('module');
    expect(preset.excludeKeywords).toContain('desktop');
    expect(preset.localPickupRadiusMiles).toBe(50);
    expect(preset.homeBaseLabel).toBe('Provo, UT');
  });
});
