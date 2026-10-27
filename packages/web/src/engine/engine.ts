import type { EffectConfig, WorldConfig } from '@pixelagents/protocol';
import { Application, Container, Filter, Rectangle, RenderTexture, Sprite } from 'pixi.js';
import { type Entity, World, animatorSystem, spriteSyncSystem } from './ecs.js';
import { behaviorSystem } from './behaviors.js';
import { type LayerName, buildEffects } from './filters.js';
import { SpriteLibrary } from './library.js';
import type { SpriteSheet } from './px.js';

export const LAYERS: LayerName[] = ['world', 'actors', 'ui', 'screen'];

export interface EngineOptions {
  /** Mount point; the canvas is appended to it. */
  parent: HTMLElement;
  world?: Partial<Pick<WorldConfig, 'width' | 'height' | 'fps'>>;
  /** Integer upscale factor (in device pixels) or 'fit' = biggest integer that fits the window. */
  scale?: number | 'fit';
  /** 'webgl' (default; every built-in filter is GLSL) or 'webgpu' to try WebGPU first. */
  preference?: 'webgl' | 'webgpu';
  background?: number;
  /** Size the canvas to this element/window. Default window. */
  resizeTo?: HTMLElement | Window;
  /** Disable the pointer/keyboard camera controls. */
  noCameraControls?: boolean;
}

export interface Camera { x: number; y: number; zoom: number; }
export type FrameHook = (dtSec: number, frameMs: number) => void;

const MAX_ZOOM = 4;
/** Options of every cached layer: logical resolution, no antialias, nearest sampling. */
export const CACHE_OPTS = { resolution: 1, antialias: false, scaleMode: 'nearest' } as const;

/**
 * Pixel-perfect engine: the scene is drawn into a `width×height` RenderTexture (logical resolution)
 * and that texture is shown with nearest filtering at an integer scale.
 *
 * Layers: `world` and `actors` live inside the camera (pan/zoom); `ui` and `screen` are fixed.
 * Each layer is a Container with its own filter slot (`setLayerFilters` / `applyEffects`).
 */
export class Engine {
  readonly app = new Application();
  readonly ecs = new World();
  readonly lib = new SpriteLibrary();
  readonly layers = {} as Record<LayerName, Container>;
  readonly camera: Camera = { x: 0, y: 0, zoom: 1 };
  width = 480;
  height = 328;
  scale: number | 'fit' = 'fit';
  /** Device-pixel-integer scale actually used. */
  effectiveScale = 1;
  /** CPU ms spent in update+render submit of the last frame. */
  lastFrameMs = 0;
  onFrame: FrameHook[] = [];
  /** Backend name after init ('webgl' | 'webgpu'). */
  backend = 'webgl';

  private scene = new Container();
  private cam = new Container();
  private rt!: RenderTexture;
  private view!: Sprite;
  private background = 0x14111b;
  private opts!: EngineOptions;
  private disposers: (() => void)[] = [];
  private keys = new Set<string>();
  private started = false;

  async init(opts: EngineOptions): Promise<this> {
    this.opts = opts;
    this.width = opts.world?.width ?? 480;
    this.height = opts.world?.height ?? 328;
    this.scale = opts.scale ?? 'fit';
    this.background = opts.background ?? 0x14111b;
    await this.app.init({
      resizeTo: opts.resizeTo ?? window,
      background: this.background,
      antialias: false,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      roundPixels: true,
      preference: opts.preference ?? 'webgl',
      // Rendering is driven by the engine's own ticker callback, not Pixi's default.
    });
    this.backend = this.app.renderer.name;
    opts.parent.appendChild(this.app.canvas);
    this.app.canvas.style.display = 'block';
    this.app.canvas.style.imageRendering = 'pixelated';

    this.rt = RenderTexture.create({ width: this.width, height: this.height, resolution: 1, scaleMode: 'nearest' });
    for (const name of LAYERS) {
      const c = new Container();
      c.label = name;
      this.layers[name] = c;
    }
    this.layers.actors.sortableChildren = true;
    this.cam.addChild(this.layers.world, this.layers.actors);
    this.scene.addChild(this.cam, this.layers.ui, this.layers.screen);

    this.view = new Sprite(this.rt);
    this.app.stage.addChild(this.view);

    this.ecs.addSystem(behaviorSystem(this.width, this.height)).addSystem(animatorSystem).addSystem(spriteSyncSystem);
    this.ecs.onDestroy = (e) => this.releaseNode(e);

    this.setFps(opts.world?.fps ?? 60);
    this.layout();
    this.app.renderer.on('resize', () => this.layout());
    if (!opts.noCameraControls) this.bindCameraControls();
    return this;
  }

  setFps(fps: number): void { this.app.ticker.maxFPS = fps > 0 ? fps : 0; }

  /** Starts the loop. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.app.ticker.add((t) => this.tick(t.deltaMS / 1000));
  }

  private tick(dt: number): void {
    const t0 = performance.now();
    dt = Math.min(dt, 0.1);
    this.cameraKeys(dt);
    this.ecs.update(dt);
    this.app.renderer.render({ container: this.scene, target: this.rt, clear: true, clearColor: this.background });
    this.lastFrameMs = performance.now() - t0;
    for (let i = 0; i < this.onFrame.length; i++) this.onFrame[i]!(dt, this.lastFrameMs);
  }

  /** Recomputes the integer scale and centers the view. */
  layout(): void {
    const dpr = this.app.renderer.resolution;
    const sw = this.app.screen.width * dpr, sh = this.app.screen.height * dpr;
    const fit = Math.max(1, Math.floor(Math.min(sw / this.width, sh / this.height)));
    const s = this.scale === 'fit' ? fit : Math.max(1, Math.floor(this.scale));
    this.effectiveScale = s;
    const css = s / dpr;
    this.view.scale.set(css);
    this.view.x = Math.round(((sw - this.width * s) / 2)) / dpr;
    this.view.y = Math.round(((sh - this.height * s) / 2)) / dpr;
  }

  setScale(scale: number | 'fit'): void { this.scale = scale; this.layout(); }

  /** Browser pixel → logical pixel. */
  toLogical(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.app.canvas.getBoundingClientRect();
    const css = this.effectiveScale / this.app.renderer.resolution;
    return { x: (clientX - r.left - this.view.x) / css, y: (clientY - r.top - this.view.y) / css };
  }

  // ---- filters ----

  /**
   * `screen` filters post-process the whole frame: they go on the scene container (the `screen` layer
   * itself is empty), clipped to the logical render target.
   */
  setLayerFilters(layer: LayerName, filters: Filter[]): void {
    const c = layer === 'screen' ? this.scene : this.layers[layer];
    if (layer === 'screen') c.filterArea = filters.length ? new Rectangle(0, 0, this.width, this.height) : undefined;
    const old = c.filters as Filter[] | undefined;
    c.filters = filters.length ? filters : null;
    if (old) for (const f of Array.isArray(old) ? old : [old]) if (!filters.includes(f)) f.destroy();
  }

  /** Applies `config.effects` (replaces the filters of every layer). */
  applyEffects(effects: EffectConfig[], onUnknown?: (name: string) => void): void {
    const built = buildEffects(effects, onUnknown);
    for (const l of LAYERS) this.setLayerFilters(l, built[l]);
  }

  /**
   * Bakes a mostly-static layer into a texture (re-bake with `cacheLayer(name, true)` after changes).
   * The cache texture must be sampled `nearest`: Pixi's default for `cacheAsTexture` is linear, which
   * blurs the whole layer as soon as the camera zooms (the sprites drawn directly stay crisp).
   */
  cacheLayer(layer: LayerName, on = true): void {
    const c = this.layers[layer];
    if (on) { c.cacheAsTexture(CACHE_OPTS); c.updateCacheTexture(); }
    else c.cacheAsTexture(false);
  }

  // ---- actors ----

  /** Creates an entity with a sprite node in `layer`. */
  spawn(key: string, sheet: SpriteSheet, x: number, y: number, layer: LayerName = 'actors'): Entity {
    const e = this.ecs.create(key);
    const node = new Sprite(sheet.frames[0]);
    this.layers[layer].addChild(node);
    e.transform.x = x; e.transform.y = y;
    e.sprite = { sheet, node, frame: 0, layer };
    e.animator = { time: 0, tag: undefined, playing: true, speed: 1 };
    return e;
  }

  /** Re-points an entity at another sheet (skin change or hot reload). */
  setSheet(e: Entity, sheet: SpriteSheet): void {
    if (e.sprite) { e.sprite.sheet = sheet; e.sprite.frame = 0; }
  }

  despawn(e: Entity): void { this.ecs.destroy(e); }

  private releaseNode(e: Entity): void {
    const n = e.sprite?.node as Sprite | null | undefined;
    if (n) { n.parent?.removeChild(n); n.destroy(); }
  }

  // ---- camera ----

  setCamera(x: number, y: number, zoom = this.camera.zoom): void {
    const z = Math.max(1, Math.min(MAX_ZOOM, Math.round(zoom)));
    this.camera.zoom = z;
    this.camera.x = x; this.camera.y = y;
    this.cam.scale.set(z);
    this.cam.x = -Math.round(x * z);
    this.cam.y = -Math.round(y * z);
  }

  /** Zoom in integer steps keeping the logical point (lx, ly) under the cursor. */
  zoomAt(delta: number, lx = this.width / 2, ly = this.height / 2): void {
    const c = this.camera;
    const nz = Math.max(1, Math.min(MAX_ZOOM, c.zoom + delta));
    if (nz === c.zoom) return;
    const wx = c.x + lx / c.zoom, wy = c.y + ly / c.zoom;
    this.setCamera(wx - lx / nz, wy - ly / nz, nz);
  }

  private cameraKeys(dt: number): void {
    if (!this.keys.size) return;
    const k = this.keys, speed = 160 * dt / this.camera.zoom;
    let dx = 0, dy = 0;
    if (k.has('ArrowLeft') || k.has('a')) dx -= speed;
    if (k.has('ArrowRight') || k.has('d')) dx += speed;
    if (k.has('ArrowUp') || k.has('w')) dy -= speed;
    if (k.has('ArrowDown') || k.has('s')) dy += speed;
    if (dx || dy) this.setCamera(this.camera.x + dx, this.camera.y + dy);
  }

  private bindCameraControls(): void {
    const cv = this.app.canvas;
    let drag: { x: number; y: number; cx: number; cy: number } | null = null;
    const down = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY, cx: this.camera.x, cy: this.camera.y }; cv.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const css = this.effectiveScale / this.app.renderer.resolution * this.camera.zoom;
      this.setCamera(drag.cx - (e.clientX - drag.x) / css, drag.cy - (e.clientY - drag.y) / css);
    };
    const up = () => { drag = null; };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = this.toLogical(e.clientX, e.clientY);
      this.zoomAt(e.deltaY < 0 ? 1 : -1, p.x, p.y);
    };
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (e.key === '+' || e.key === '=') this.zoomAt(1);
      else if (e.key === '-') this.zoomAt(-1);
      else if (e.key === '0') this.setCamera(0, 0, 1);
      else this.keys.add(e.key);
    };
    const ku = (e: KeyboardEvent) => { this.keys.delete(e.key); };
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    this.disposers.push(() => {
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      cv.removeEventListener('pointercancel', up);
      cv.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    });
  }

  /** Draw-call count of the last render if the renderer exposes it. */
  get drawCalls(): number | undefined {
    const r = this.app.renderer as unknown as { renderPipes?: { batch?: { _drawCallsThisFrame?: number } } };
    return r.renderPipes?.batch?._drawCallsThisFrame;
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.app.destroy(true, { children: true });
  }
}
