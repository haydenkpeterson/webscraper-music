import { describe, expect, it } from 'vitest';
import { parsePresetRequestIssueBody } from '../src/server/services/presetRequest';

describe('preset request parser', () => {
  it('parses issue-form markdown into a preset request payload', () => {
    const payload = parsePresetRequestIssueBody(`
### Label
Blue Fender Jazzmaster

### Description
Find used blue Fender Jazzmasters.

### Category
guitar

### Search terms
fender jazzmaster blue
lake placid blue jazzmaster

### Include keywords
fender
jazzmaster

### Exclude keywords
squier
partscaster

### Blue finish keywords
blue
lake placid blue

### Local pickup radius miles
60

### Home base label
Salt Lake City, UT
`);

    expect(payload.label).toBe('Blue Fender Jazzmaster');
    expect(payload.category).toBe('guitar');
    expect(payload.searchTerms).toEqual(['fender jazzmaster blue', 'lake placid blue jazzmaster']);
    expect(payload.includeKeywords).toEqual(['fender', 'jazzmaster']);
    expect(payload.excludeKeywords).toEqual(['squier', 'partscaster']);
    expect(payload.blueFinishKeywords).toEqual(['blue', 'lake placid blue']);
    expect(payload.localPickupRadiusMiles).toBe(60);
    expect(payload.homeBaseLabel).toBe('Salt Lake City, UT');
  });
});
