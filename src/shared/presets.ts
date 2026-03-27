import type { Preset } from './types.js';

export const PROVO_HOME_BASE = 'Provo, UT';
export const DEFAULT_LOCAL_PICKUP_RADIUS_MILES = 50;

export const commonTelecasterExcludes = [
  'squier',
  'squire',
  'partscaster',
  'body only',
  'replacement body',
  'loaded body',
  'neck',
  'pickup',
  'pickups',
  'bridge',
  'control plate',
  'knob',
  'knobs',
  'switch tip',
  'pickguard',
  'case',
  'gig bag',
  'ukulele',
  'acoustic-electric',
  'acoustic electric',
  'acoustasonic',
  'strap',
  'sticker',
  'project',
  'repair',
  'for parts',
  'parts only'
];

export const commonHxStompExcludes = [
  'xl',
  'stomp xl',
  'helix floor',
  'helix lt',
  'helix rack',
  'hx effects',
  'power supply',
  'footswitch',
  'switch',
  'knob',
  'knobs',
  'screen protector',
  'travel case',
  'bag',
  'repair',
  'for parts',
  'parts only'
];

export const commonBlueFinishKeywords = [
  'blue',
  'lake placid',
  'sonic blue',
  'ice blue',
  'blue sparkle',
  'midnight blue',
  'cobalt',
  'pelham blue',
  'daphne blue',
  'miami blue',
  'tidepool'
];

export const defaultPresets: Preset[] = [
  {
    id: 'blue_fender_telecaster',
    label: 'Blue Fender Telecaster',
    description: 'Find used blue Fender Telecasters while excluding Squier and accessory listings.',
    category: 'guitar',
    sources: ['ebay', 'reverb', 'guitarcenter'],
    searchTerms: [
      'fender telecaster blue',
      'fender telecaster',
      'lake placid blue telecaster',
      'pelham blue telecaster',
      'daphne blue telecaster'
    ],
    includeKeywords: ['fender', 'telecaster'],
    excludeKeywords: commonTelecasterExcludes,
    blueFinishKeywords: commonBlueFinishKeywords,
    localPickupRadiusMiles: DEFAULT_LOCAL_PICKUP_RADIUS_MILES,
    homeBaseLabel: PROVO_HOME_BASE
  },
  {
    id: 'line6_hx_stomp',
    label: 'Line 6 HX Stomp',
    description: 'Find used HX Stomp pedals while excluding XL units and accessories.',
    category: 'effects',
    sources: ['ebay', 'reverb', 'guitarcenter'],
    searchTerms: ['line 6 hx stomp', 'used line 6 hx stomp'],
    includeKeywords: ['line 6', 'hx stomp'],
    excludeKeywords: commonHxStompExcludes,
    localPickupRadiusMiles: DEFAULT_LOCAL_PICKUP_RADIUS_MILES,
    homeBaseLabel: PROVO_HOME_BASE
  }
];

export const defaultPresetMap = new Map(defaultPresets.map((preset) => [preset.id, preset]));
