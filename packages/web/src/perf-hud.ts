/** Frame statistics over a rolling window. Pure; `PerfHud` renders it as a DOM overlay. */
export class FrameStats {
  private cpu: Float64Array;
  private dt: Float64Array;
  private scratch: Float64Array;
  private n = 0;
  private i = 0;
  constructor(readonly window = 240) {
    this.cpu = new Float64Array(window);
    this.dt = new Float64Array(window);
    this.scratch = new Float64Array(window);
  }
  /** `cpuMs` = update+render submit time, `intervalMs` = time since the previous frame. */
  push(cpuMs: number, intervalMs: number): void {
    this.cpu[this.i] = cpuMs; this.dt[this.i] = intervalMs;
    this.i = (this.i + 1) % this.window;
    if (this.n < this.window) this.n++;
  }
  get count(): number { return this.n; }
  private mean(a: Float64Array): number { let s = 0; for (let k = 0; k < this.n; k++) s += a[k]!; return this.n ? s / this.n : 0; }
  private pct(a: Float64Array, p: number): number {
    if (!this.n) return 0;
    const s = this.scratch.subarray(0, this.n);
    s.set(a.subarray(0, this.n));
    s.sort();
    return s[Math.min(this.n - 1, Math.ceil(p * this.n) - 1)]!;
  }
  get cpuMean(): number { return this.mean(this.cpu); }
  get cpuP95(): number { return this.pct(this.cpu, 0.95); }
  get frameMean(): number { return this.mean(this.dt); }
  get frameP95(): number { return this.pct(this.dt, 0.95); }
  get fps(): number { const m = this.frameMean; return m ? 1000 / m : 0; }
  reset(): void { this.n = 0; this.i = 0; }
}

export interface HudSource { actors(): number; drawCalls(): number | undefined; backend: string; }

export class PerfHud {
  readonly stats = new FrameStats();
  private el: HTMLPreElement;
  private last = performance.now();
  private shown = 0;
  constructor(parent: HTMLElement, private src: HudSource) {
    this.el = document.createElement('pre');
    this.el.id = 'perf-hud';
    this.el.style.cssText = 'position:fixed;left:6px;top:6px;margin:0;padding:4px 6px;background:#000a;color:#8f8;font:11px/1.3 monospace;pointer-events:none;z-index:9';
    parent.appendChild(this.el);
  }
  /** Call once per frame with the engine's CPU time for that frame. */
  frame(cpuMs: number): void {
    const now = performance.now();
    this.stats.push(cpuMs, now - this.last);
    this.last = now;
    if (now - this.shown > 250) { this.shown = now; this.render(); }
  }
  render(): void {
    const s = this.stats, dc = this.src.drawCalls();
    this.el.textContent =
      `${s.fps.toFixed(0)} fps  [${this.src.backend}]\n` +
      `frame ${s.frameMean.toFixed(1)} ms avg  ${s.frameP95.toFixed(1)} p95\n` +
      `cpu   ${s.cpuMean.toFixed(2)} ms avg  ${s.cpuP95.toFixed(2)} p95\n` +
      `actors ${this.src.actors()}` + (dc === undefined ? '' : `  draws ${dc}`);
  }
  destroy(): void { this.el.remove(); }
}
