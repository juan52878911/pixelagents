import { definePlugin, type InputFactory } from '@pixelagents/protocol';

/**
 * A custom input type. Config: `{ "id": "t", "type": "ticker", "adapter": "queue", "everySec": 2, "line": "queue=a depth=3" }`.
 * `push(raw)` hands one raw record to the adapter named in the config; stop when `signal` aborts
 * (config reload, shutdown). A promise returned from `start` is optional.
 */
export const tickerInput: InputFactory = {
  type: 'ticker',
  start(cfg, push, signal) {
    const every = Math.max(0.05, Number(cfg.everySec) || 5) * 1000;
    const line = typeof cfg.line === 'string' ? cfg.line : 'queue=demo depth=1';
    let n = 0;
    const timer = setInterval(() => push(`${line} n=${++n}`), every);
    signal.addEventListener('abort', () => clearInterval(timer), { once: true });
  },
};

export default definePlugin({ name: 'ticker', inputs: [tickerInput] });
