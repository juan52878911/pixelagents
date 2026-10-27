import fs from 'node:fs';
import path from 'node:path';
import { expandHome } from './util.js';

export interface AssetInfo {
  name: string;
  size: number;
  kind: 'sprites' | 'png';
  /** 'upload' = the data dir; 'dir' = a folder from config.assets. */
  source: 'upload' | 'dir';
}

export const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(px\.json|png)$/;

/** Asset folders (config.assets + dataDir/assets), listing and change watching. */
export class Assets {
  private watchers: fs.FSWatcher[] = [];
  private timer: NodeJS.Timeout | null = null;
  private dirsNow: string[] = [];

  constructor(readonly uploadDir: string, private onChange: () => void) {}

  /** Later folders override earlier ones; uploads win over everything. */
  setDirs(configured: string[]): void {
    this.dirsNow = [...configured.map((d) => path.resolve(expandHome(d))), this.uploadDir];
    this.unwatch();
    fs.mkdirSync(this.uploadDir, { recursive: true });
    for (const d of this.dirsNow) {
      try {
        this.watchers.push(fs.watch(d, () => this.bump()));
      } catch {
        /* folder missing: listed as empty */
      }
    }
  }

  private bump(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onChange();
    }, 100);
    this.timer.unref?.();
  }

  private unwatch(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
  }

  close(): void {
    this.unwatch();
    if (this.timer) clearTimeout(this.timer);
  }

  private scan(): Map<string, AssetInfo & { file: string }> {
    const out = new Map<string, AssetInfo & { file: string }>();
    for (const d of this.dirsNow) {
      let names: string[] = [];
      try {
        names = fs.readdirSync(d);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!ASSET_NAME.test(name)) continue;
        try {
          const file = path.join(d, name);
          const st = fs.statSync(file);
          if (!st.isFile()) continue;
          out.set(name, { name, size: st.size, kind: name.endsWith('.png') ? 'png' : 'sprites', source: d === this.uploadDir ? 'upload' : 'dir', file });
        } catch {
          /* vanished */
        }
      }
    }
    return out;
  }

  list(): AssetInfo[] {
    return [...this.scan().values()].map(({ file: _f, ...info }) => info).sort((a, b) => a.name.localeCompare(b.name));
  }

  resolve(name: string): string | null {
    return this.scan().get(name)?.file ?? null;
  }

  async save(name: string, body: Buffer): Promise<void> {
    const dest = path.join(this.uploadDir, name);
    const tmp = `${dest}.tmp-${process.pid}`;
    await fs.promises.mkdir(this.uploadDir, { recursive: true });
    await fs.promises.writeFile(tmp, body);
    await fs.promises.rename(tmp, dest);
  }
}

export function validateAsset(name: string, body: Buffer): string | null {
  if (name.endsWith('.png')) {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return body.length > 8 && body.subarray(0, 8).equals(sig) ? null : 'not a PNG file';
  }
  try {
    const j = JSON.parse(body.toString('utf8')) as { px?: unknown; sprites?: unknown };
    if (j.px !== 1 || !Array.isArray(j.sprites)) return 'not a .px.json file (expected { px: 1, sprites: [] })';
  } catch {
    return 'invalid JSON';
  }
  return null;
}
