import type { PaConfig } from '@pixelagents/protocol';

export interface PixelServer {
  listen(): Promise<number>;
  close(): Promise<void>;
}

/** Owner: W1. Ingest → reducers → classification → SSE + config API. */
export function createServer(_config: PaConfig): PixelServer {
  throw new Error('not implemented');
}
