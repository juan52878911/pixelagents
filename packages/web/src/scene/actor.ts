import type { Entity } from '@pixelagents/protocol';
import type { OfficeLayout } from '../world/types.js';
import type { Look, View } from './chars.js';
import type { Placement } from './input.js';
import type { PodState } from './props.js';

export type SeatState = 'work' | 'think' | 'wait' | 'sleep' | 'idle' | 'talk';

export interface Walker {
  x: number; y: number; view: View; flip?: boolean; legs: number; hand?: number; alpha?: number; item?: boolean;
}

/** Everything the scene knows about one actor; behaviors write the render fields every frame. */
export interface ActorData {
  id: string;
  ent: Entity;
  look: Look;
  seed: number;
  group: string;
  zone: string | null;
  place: Placement;
  /** Behavior the entity's status maps to right now (the current one may still be finishing). */
  want: string;
  /** Desk position (slot) and its office, when placed. */
  slot: { dx: number; dy: number } | null;
  office: OfficeLayout | null;
  /** Seconds in the current behavior. */
  bt: number;
  // ---- render state ----
  seat: SeatState | null;
  walker: Walker | null;
  /** Desk build progress 0..1. */
  desk: number;
  door: boolean;
  ding: number;
  say: string | null;
  wave: boolean;
  showItem: boolean;
  /** Greeting phase time (arrive), so neighbours wave back. */
  greet: number;
  /** Finished its exit: not drawn, frees its desk. */
  gone: boolean;
  /** Pod (lab) state. */
  pod: { st: PodState; beam?: number; mat?: number } | null;
  /** Mini (subagent) alpha and poof progress. */
  mini: { alpha: number; poof: number | null } | null;
  /** talk: the agent visited and the talk phase. */
  talk: { with: string; phase: 'walk' | 'talk'; x: number; dir: number; lt: number } | null;
  /** Visited by a talker (draws the "talk" seat). */
  talkedBy: { lt: number } | null;
}

export function newActorData(id: string, ent: Entity, look: Look, seed: number): ActorData {
  return {
    id, ent, look, seed, group: '', zone: null, place: 'desk', want: 'idle', slot: null, office: null, bt: 0,
    seat: null, walker: null, desk: 0, door: false, ding: 0, say: null, wave: false, showItem: false, greet: -1,
    gone: false, pod: null, mini: null, talk: null, talkedBy: null,
  };
}
