/**
 * Client plugin with an actor behavior. Reference it from config:
 *   "behaviors": { "default": { "working": "pace" } }
 * An actor is an ECS entity: `transform` (x, y, flip), `animator` (tag, playing), `behavior.data` (free scratch space).
 */
import type { BehaviorDef } from '../../packages/web/src/engine/behaviors.js';

/** Paces left and right 24 px around where it started, at 16 px/s. */
export const pace: BehaviorDef = {
  enter(a) {
    if (a.animator) { a.animator.tag = 'walk'; a.animator.playing = true; }
    a.behavior!.data.home = a.transform.x;
    a.behavior!.data.dir = 1;
  },
  update(a, dt) {
    const d = a.behavior!.data;
    const home = d.home as number;
    let x = a.transform.x + (d.dir as number) * 16 * dt;
    if (x > home + 24) { x = home + 24; d.dir = -1; }
    if (x < home - 24) { x = home - 24; d.dir = 1; }
    a.transform.x = x;
    a.transform.flip = (d.dir as number) < 0;
  },
  exit(a) {
    if (a.animator) a.animator.playing = false;
  },
};

export default { name: 'pace-demo', behaviors: { pace } };
