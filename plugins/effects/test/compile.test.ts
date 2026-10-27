import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chrome = ['/Applications/Google Chrome.app', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'].some(existsSync);

// Real WebGL: builds the plugin, mounts the real Engine in Chrome and applies every filter on each
// layer it targets. A GLSL compile error is a console error and fails the run. Needs a browser with
// WebGL, so it is opt-in (PA_BROWSER_TESTS=1): the CI `e2e` job runs it on Playwright's Chromium
// (SwiftShader); locally it uses the system Chrome.
const enabled = process.env.PA_BROWSER_TESTS === '1' && (chrome || !!process.env.CI);
describe.skipIf(!enabled)('shaders compile in Chrome', () => {
  it('every filter compiles and renders on its layers', () => {
    const r = spawnSync(process.execPath, [resolve(root, 'scripts/preview-check.mjs')], {
      encoding: 'utf8', timeout: 120_000, env: { ...process.env, COMPILE_ONLY: '1', PREVIEW_PORT: process.env.PREVIEW_PORT ?? '5381' },
    });
    const out = (r.stdout ?? '') + (r.stderr ?? '');
    expect(r.status, out.slice(-1500)).toBe(0);
    for (const n of ['crt', 'daynight', 'glow', 'scanlines', 'palette', 'outline']) expect(out).toContain(`compiled ${n}`);
  }, 130_000);
});
