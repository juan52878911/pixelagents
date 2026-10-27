import type { Store } from '../store.js';

/**
 * Contract between the scene (W7, packages/web/src/scene) and the DOM UI (W8 inspector/HUD, W9 settings).
 * The scene implements it; UI modules only use this interface and the Store.
 */
export interface SceneApi {
  /** Called with the entity id when the user clicks an actor (null when clicking empty space). */
  onSelect(cb: (entityId: string | null) => void): void;
  /** Pan the camera to an entity and mark it selected. */
  focus(entityId: string): void;
  /** Dim everything except these entity ids (search/filters); null clears. */
  highlight(entityIds: string[] | null): void;
  /** Screen position (CSS px, relative to the canvas) of an actor, for anchored popups. */
  screenPos(entityId: string): { x: number; y: number } | null;
}

export interface UiContext {
  store: Store;
  scene: SceneApi;
  /** Root element for overlays (positioned over the canvas). */
  root: HTMLElement;
}
