/**
 * Sprite files (`*.px.json`): pixel art as text, the format of the prototype.
 * Each frame is a list of rows of equal length `w`; '.' is transparent and every other character
 * is a key of `palette` ("#rrggbb" or "rgba(r,g,b,a)"). Several sprites may live in one file.
 *
 * Characters are built from parts so skins can recolor them:
 *   char.<view>.<part>  view: front | side | back; part: head | body | legs
 * and palette keys with fixed meaning (see CHARACTER_KEYS) that skins override.
 */
export interface PxFile {
  /** Format version. */
  px: 1;
  sprites: PxSprite[];
  overlays?: OverlaySprite[];
}

export interface PxSprite {
  /** Dotted name, unique across all loaded files; later files override earlier ones. */
  name: string;
  w: number;
  h: number;
  palette: Record<string, string>;
  frames: string[][];
  /** Frames per second; 0 or absent = static. */
  fps?: number;
  /** Pivot in pixels from the top-left (feet of a character). Default [0, 0]. */
  anchor?: [number, number];
  /** Named frame ranges, inclusive: { walk: [1, 3] }. */
  tags?: Record<string, [number, number]>;
  /** Free metadata for the engine and plugins (place: "wall" | "floor", kind: "deco" | "emoji"…). */
  meta?: Record<string, unknown>;
}

/** Palette keys of the base character, overridable by skins. */
export const CHARACTER_KEYS = {
  H: 'hair',
  S: 'skin',
  s: 'skin shadow',
  E: 'eyes/outline',
  m: 'mouth',
  B: 'shirt',
  b: 'shirt shadow',
  P: 'trousers',
  K: 'shoes',
  /** Accessory colors used by overlays. */
  A: 'accessory dark',
  a: 'accessory light',
  C: 'cap',
  c: 'cap shadow',
  T: 'tie',
  W: 'white detail',
} as const;

/**
 * Accessory overlays: pixels drawn over the character per view, so a skin can add a tie, a cap,
 * headphones… without new character art. Coordinates are relative to the 10×14 character box.
 */
export interface OverlaySprite {
  name: string;
  /** view → list of [x, y, paletteKey]. */
  views: Partial<Record<'front' | 'side' | 'back', [number, number, string][]>>;
}
