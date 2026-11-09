// Glasswake — game data. Everything balance-related lives here so it can be tuned
// without touching systems code.

export const CELL = 2;            // world units per grid cell
export const MAP_N = 96;          // grid is MAP_N x MAP_N cells
export const WORLD = MAP_N * CELL;
export const SUPPLY_MAX = 120;
export const START_RES = 500;

export const FACTIONS = {
  accord: {
    id: 'accord',
    name: 'Halcyon Accord',
    color: 0x3fd8c6, glow: 0x9ff9ee, dark: 0x16454a, css: '#3fd8c6',
    blurb: 'Survey mandate from the northern shelf. Cold optics, patient doctrine.',
  },
  combine: {
    id: 'combine',
    name: 'Ochre Combine',
    color: 0xf09a3a, glow: 0xffd391, dark: 0x5a3510, css: '#f09a3a',
    blurb: 'Salvage guilds of the furnace basins. Loud engines, short contracts.',
  },
};

// Damage multipliers: weapon type -> target armour
export const DMG = {
  shard: { light: 1.3, medium: 0.8, heavy: 0.45, structure: 0.35 },
  beam:  { light: 0.85, medium: 1.25, heavy: 0.95, structure: 0.7 },
  blast: { light: 0.55, medium: 0.9, heavy: 1.35, structure: 1.6 },
};

export const UNITS = {
  skimmer: {
    name: 'Skimmer', role: 'Harvester', cost: 50, supply: 1, time: 8,
    hp: 150, armor: 'light', speed: 5.4, sight: 7, radius: 0.95, hover: true,
    carry: 60, harvestRate: 12, key: 'K',
    desc: 'Hover sled that siphons resonance glass from vents and hauls it to a Core or Siphon.',
  },
  needle: {
    name: 'Needle', role: 'Raider', cost: 60, supply: 1, time: 7,
    hp: 95, armor: 'light', speed: 7.8, sight: 9.5, radius: 0.75, hover: true, key: 'N',
    weapon: { type: 'shard', dmg: 7, range: 6, cd: 0.42, proj: 'bolt', speed: 45, muzzleY: 0.9 },
    desc: 'Fast glass-dart skiff. Shreds Skimmers and light units, useless against armour.',
  },
  warden: {
    name: 'Warden', role: 'Line walker', cost: 110, supply: 2, time: 11,
    hp: 250, armor: 'medium', speed: 4.3, sight: 8.5, radius: 1.05, turret: true, key: 'W',
    weapon: { type: 'beam', dmg: 21, range: 7.5, cd: 1.1, proj: 'beam', muzzleY: 2.1 },
    desc: 'Bipedal walker with a focusing lens. The backbone of any assault.',
  },
  mender: {
    name: 'Mender', role: 'Support', cost: 90, supply: 1, time: 9,
    hp: 110, armor: 'light', speed: 5.2, sight: 8, radius: 0.85, hover: true, key: 'M',
    heal: { rate: 11, range: 5.5 },
    desc: 'Floating resonance tuner. Re-fuses damaged hulls of nearby allies.',
  },
  bastion: {
    name: 'Bastion', role: 'Siege', cost: 230, supply: 4, time: 18,
    hp: 580, armor: 'heavy', speed: 2.7, sight: 9.5, radius: 1.45, turret: true, key: 'B',
    requires: ['uplink'],
    weapon: { type: 'blast', dmg: 58, range: 13, minRange: 3, cd: 3.2, proj: 'shell', speed: 20, splash: 2.6, muzzleY: 1.9 },
    desc: 'Slow hex-hull mortar. Lobs resonance charges that crack armour and structures.',
  },
};

export const BUILDINGS = {
  core: {
    name: 'Core', cost: 400, time: 45, hp: 2000, size: 3, sight: 10, supply: 12,
    field: 10, dropoff: true, produces: ['skimmer'], key: 'C',
    desc: 'Command lattice. Weaves new structures, trains Skimmers and accepts resonance.',
  },
  pylon: {
    name: 'Lattice Pylon', cost: 60, time: 10, hp: 320, size: 1, sight: 7, field: 7, key: 'P',
    desc: 'Extends the lattice field. Structures can only be woven inside the field.',
  },
  resonator: {
    name: 'Resonator', cost: 100, time: 16, hp: 520, size: 2, sight: 6, supply: 10, key: 'R',
    desc: 'Tuning array. Raises the supply ceiling by 10.',
  },
  siphon: {
    name: 'Siphon', cost: 150, time: 22, hp: 760, size: 2, sight: 7, dropoff: true, freeUnit: 'skimmer', key: 'I',
    desc: 'Forward drop-off for resonance. Arrives with one free Skimmer.',
  },
  foundry: {
    name: 'Foundry', cost: 200, time: 28, hp: 1150, size: 3, sight: 7,
    produces: ['needle', 'warden', 'mender', 'bastion'], key: 'F',
    desc: 'Glass-kiln assembly hall. Builds combat units.',
  },
  spire: {
    name: 'Prism Spire', cost: 125, time: 20, hp: 520, size: 1, sight: 10, turret: true,
    requires: ['foundry'], key: 'T',
    weapon: { type: 'beam', dmg: 26, range: 9.5, cd: 1.0, proj: 'beam', muzzleY: 4.4 },
    desc: 'Defensive prism. Fires a focused beam at anything hostile in range.',
  },
  uplink: {
    name: 'Uplink', cost: 200, time: 30, hp: 720, size: 2, sight: 8, requires: ['foundry'], key: 'U',
    desc: 'Orbital relay. Unlocks the Bastion at the Foundry.',
  },
};

for (const [id, d] of Object.entries(UNITS)) { d.id = id; d.kind = 'unit'; }
for (const [id, d] of Object.entries(BUILDINGS)) { d.id = id; d.kind = 'building'; d.armor = 'structure'; }

export const BUILD_ORDER = ['core', 'pylon', 'resonator', 'siphon', 'foundry', 'spire', 'uplink'];

export const DIFFICULTY = {
  easy:   { name: 'Easy',   harvest: 0.7,  waveBase: 16, waveGrow: 6,  think: 1.6, firstWave: 330 },
  normal: { name: 'Normal', harvest: 1.0,  waveBase: 20, waveGrow: 8,  think: 1.0, firstWave: 260 },
  hard:   { name: 'Hard',   harvest: 1.3,  waveBase: 18, waveGrow: 10, think: 0.6, firstWave: 200 },
};

// Resource colour (neutral, distinct from both factions)
export const RES_COLOR = 0xff4fa0;
export const RES_GLOW = 0xffa8d2;
