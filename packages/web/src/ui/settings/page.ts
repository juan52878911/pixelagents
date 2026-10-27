/**
 * Stand-alone settings page (`settings.html`): connects a Store to /events, mounts the panel full-page.
 * `?demo` feeds synthetic agents instead (no server needed for the store; saving still needs one).
 */
import { Store, startDemo } from '../../store.js';
import { mountSettings } from '../settings.js';
import type { SceneApi } from '../types.js';

const store = new Store();
const q = new URLSearchParams(location.search);
if (q.has('demo')) startDemo(store); else store.connect('/events');

const scene: SceneApi = { onSelect() {}, focus() {}, highlight() {}, screenPos: () => null };
const root = document.getElementById('app')!;
const settings = mountSettings({ store, scene, root });
const section = q.get('section');
settings.open((section as Parameters<typeof settings.open>[0]) ?? undefined);
