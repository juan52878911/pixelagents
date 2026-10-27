/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test';

// Server: the packaged bundle with a `file` input over fixtures/claude-code.v1.jsonl (fromStart),
// plus an `http` input used to add one live session for the waiting test. See test/e2e/serve.mjs.
//
// Scene contract (packages/web, SceneApi / window.__pixelagents):
//   window.__pixelagents.scene.actors(): { id: string; kind: string }[]   one per agent actor on screen
//   window.__pixelagents.scene.groups(): { id: string }[]                 one per office
//   window.__pixelagents.scene.focus(id)                                  selects an actor (opens the inspector)
//   [data-testid=inspector-tool] / [data-testid=inspector-detail]         inspector fields
//   [data-testid=waiting-chip]                                            notice for an agent that waits
const SCENE_PENDING =
  'the web app on this branch is still the engine demo: window.__pixelagents (scene, inspector, waiting chip) is not wired yet. Enable after integration.';

interface Scene {
  actors(): { id: string; kind: string }[];
  groups(): { id: string }[];
  focus(id: string): void;
}
declare global {
  interface Window {
    __pixelagents?: { scene: Scene };
  }
}

const sceneReady = (page: Page) => page.waitForFunction(() => !!window.__pixelagents?.scene && window.__pixelagents.scene.actors().length > 0);

test('serves the web app, /healthz and the fixture state from the bundle', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible();
  expect(errors).toEqual([]);

  expect(await (await request.get('/healthz')).json()).toEqual({ ok: true });
  await expect
    .poll(async () => {
      const s = (await (await request.get('/api/state')).json()) as { entities: { kind: string; id: string }[]; groups: unknown[] };
      return [s.entities.filter((e) => e.kind === 'agent' && !e.id.includes('e2e-')).length, s.groups.length];
    })
    .toEqual([4, 3]);
});

test.describe('scene and inspector', () => {
  test.fixme(true, SCENE_PENDING);

  test('shows 4 agents in 3 offices', async ({ page }) => {
    await page.goto('/');
    await sceneReady(page);
    const actors = await page.evaluate(() => window.__pixelagents!.scene.actors());
    const groups = await page.evaluate(() => window.__pixelagents!.scene.groups());
    expect(actors.filter((a) => a.kind === 'agent' && !a.id.includes('e2e-'))).toHaveLength(4);
    expect(groups).toHaveLength(3);
  });

  test('selecting an agent shows its tool and detail in the inspector', async ({ page }) => {
    await page.goto('/');
    await sceneReady(page);
    await page.evaluate(() => window.__pixelagents!.scene.focus('agent:s-laptop-2'));
    await expect(page.getByTestId('inspector-tool')).not.toBeEmpty();
    await expect(page.getByTestId('inspector-detail')).not.toBeEmpty();
  });

  test('an agent waiting for permission raises a chip', async ({ page, request }) => {
    const base = { v: 1, session: 'e2e-wait', agent: 'dev', account: 'work', host: 'laptop', cwd: '/home/dev/code/api', repo: 'api', branch: 'main' };
    const now = () => new Date().toISOString();
    const res = await request.post('/v1/events', {
      data: [
        { ...base, ts: now(), kind: 'session.start' },
        { ...base, ts: now(), kind: 'turn.start' },
        { ...base, ts: now(), kind: 'waiting.permission', detail: 'Bash' },
      ],
    });
    expect(res.ok()).toBeTruthy();
    await page.goto('/');
    await sceneReady(page);
    await expect(page.getByTestId('waiting-chip').first()).toBeVisible();
  });
});
