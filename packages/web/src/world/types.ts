/** Input and output of the pure town generator (no Pixi, no DOM). Pixel units: 1 tile = TS px. */

export const TS = 8; // tile size in px
export const GY = 24; // top margin in px (HUD strip)
export const DEFAULT_COLS = 60;

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
  kind: 'office' | 'path' | 'tree' | 'bush';
  x: number;
  y: number;
  w: number;
  h: number;
  time: number;
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
  /** build order: tiles flooded from the door */
  order: Tile[];
  buildStart: number;
  buildDur: number;
  doneAt: number;
}

export interface WorldLayout {
  seed: string;
  season: string;
  cols: number;
  rows: number;
  /** owner office index per tile, -1 = grass */
  own: number[][];
  offices: OfficeLayout[];
  plaza: Tile;
  plazaOk: boolean;
  path: TileKey[];
  trees: { c: number; r: number; kind: number; x: number; y: number }[];
  bushes: { c: number; r: number; x: number; y: number }[];
  outdoor: PlacedDecor[];
  build: {
    reveal: RevealItem[];
    builders: BuilderPath[];
    pathTimes: number[];
    treeTimes: number[];
    bushTimes: number[];
    buildEnd: number;
  };
  /** hints to regenerate with the same office/agent order */
  order: { offices: string[]; agents: Record<string, string[]> };
}

export interface Hints {
  offices?: string[];
  /** key `${officeId}/${zoneId}` (or `${officeId}/@pods`) → ids in previous slot order */
  agents?: Record<string, string[]>;
}
