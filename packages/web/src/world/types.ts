/** Input and output of the pure town generator (no Pixi, no DOM). Pixel units: 1 tile = TS px. */

export const TS = 8; // tile size in px
export const GY = 24; // top margin in px (HUD strip)
export const DEFAULT_COLS = 60;
/** `own` value of a shared-floor tile (corridor, lobby or break space); -1 is grass. */
export const COMMON = -2;

export interface DecorItem {
  id: string;
  w: number;
  h: number;
  place: 'wall' | 'floor';
}

export interface ZoneInput {
  id: string;
  label: string;
  agents: string[];
}

export interface GroupInput {
  id: string;
  /** 'office' | 'lab' | 'server' | any other string (treated as office) */
  kind: string;
  label: string;
  zones: ZoneInput[];
  /** lab capsules (ids) */
  pods?: string[];
}

export interface WorldInput {
  seed: string;
  season?: string;
  groups: GroupInput[];
  decor: DecorItem[];
  strategies?: string[];
  /** map width in tiles (fixed per config, default 60); height grows as needed */
  cols?: number;
}

export type FloorKind = 'parquet' | 'carpet' | 'server' | 'lab';
export type TileKey = number; // r * cols + c
export type Tile = [number, number]; // [col, row]

export interface PlacedDecor {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Slot {
  index: number;
  /** px, absolute map coordinates */
  dx: number;
  dy: number;
  /** agent (zone slot) or pod id (capsule); null = free */
  agent: string | null;
}

export interface ZoneLayout {
  id: string;
  label: string;
  slots: Slot[];
}

export interface BuilderPath {
  office: string;
  index: number;
  /** keyframes: position of the builder (tile coords, linear in between) */
  keys: { t: number; c: number; r: number }[];
}

export interface RevealItem {
  kind: 'office' | 'path' | 'tree' | 'bush' | 'outdoor';
  x: number;
  y: number;
  w: number;
  h: number;
  time: number;
}

/** A crew of two builders hammering along `order` (tiles) from `start` for `dur` seconds. */
export interface Crew {
  id: string;
  kind: 'build' | 'demolish';
  order: Tile[];
  start: number;
  dur: number;
}

export interface OfficeLayout {
  id: string;
  kind: string;
  label: string;
  floor: FloorKind;
  wall: string;
  strategy: string;
  /** hall in tiles / px */
  tx: number;
  ty: number;
  tw: number;
  th: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** y of the first desk row (px) and desk row pitch */
  deskY: number;
  deskRows: number;
  rowPitch: number;
  /** door: px offset from x, and tile */
  door: number;
  doorTile: Tile;
  signEnd: number;
  racks: number;
  zones: ZoneLayout[];
  /** lab capsules */
  capsules: Slot[];
  windows: number[];
  poster: number | null;
  wallDeco: PlacedDecor[];
  decor: PlacedDecor[];
  /** every owned tile (hall + wings), row-major */
  tiles: Tile[];
  /** tile inside the hall right under the door (where walkers enter) */
  entry: Tile;
  /** px: first x usable by desks (after the racks) */
  startX: number;
  /** rebuilt in this layout (builders animate it); false = untouched since the previous layout */
  changed: boolean;
  /** build order: tiles flooded from the door */
  order: Tile[];
  buildStart: number;
  buildDur: number;
  doneAt: number;
}

/** The reception: a wall band (2 rows) with the entrance door and a floor band (2 rows) seeding the corridors. */
export interface Lobby {
  tx: number; ty: number; tw: number; th: number;
  x: number; y: number; w: number; h: number;
  /** px offset of the entrance door from x, and its tile (outside, above the wall) */
  door: number;
  doorTile: Tile;
  /** first floor tile under the door (seed of the corridor network) */
  entry: Tile;
}

export interface WorldLayout {
  seed: string;
  season: string;
  cols: number;
  rows: number;
  /** owner office index per tile, -1 = grass, COMMON (-2) = shared floor */
  own: number[][];
  offices: OfficeLayout[];
  lobby: Lobby;
  /** structural shared tiles (lobby floor, door strips, routes): always walkable, never claimed */
  corridor: TileKey[];
  /** every shared tile (corridor + break pockets) */
  common: TileKey[];
  /** furniture of the break pockets (plants, sofas…) */
  commonDecor: PlacedDecor[];
  /** forecourt in front of the entrance (3×3) */
  plaza: Tile;
  plazaOk: boolean;
  /** outdoor path tiles (forecourt + way to the map edge) */
  path: TileKey[];
  trees: { c: number; r: number; kind: number; x: number; y: number }[];
  bushes: { c: number; r: number; x: number; y: number }[];
  outdoor: PlacedDecor[];
  build: {
    /** what appears (new/rebuilt offices, new paths, trees…) and when, relative to this layout */
    reveal: RevealItem[];
    /** what was standing in the previous layout and goes away (shown from the old art until `time`) */
    demolish: RevealItem[];
    crews: Crew[];
    builders: BuilderPath[];
    pathTimes: number[];
    treeTimes: number[];
    bushTimes: number[];
    buildEnd: number;
  };
  /** bumps on every layout whose geometry differs from the previous one */
  epoch: number;
  /** hints to regenerate with the same office/agent order */
  order: { offices: string[]; agents: Record<string, string[]> };
}

export interface Hints {
  offices?: string[];
  /** key `${officeId}/${zoneId}` (or `${officeId}/@pods`) → ids in previous slot order */
  agents?: Record<string, string[]>;
}
