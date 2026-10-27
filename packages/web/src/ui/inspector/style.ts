/** Palette taken from the prototype (POP_C) and status colours shared by chips, dots and the panel. */
export const STATUS_COLOR: Record<string, string> = {
  working: '#4cc38a', thinking: '#79c0ff', waiting: '#f5c542', idle: '#8f96a3', sleeping: '#5b5470',
  starting: '#5ad1e6', ended: '#3b3346', failed: '#e5533d', frozen: '#9be8f5',
};
export const STATUS_LABEL: Record<string, string> = {
  working: 'trabajando', thinking: 'pensando', waiting: 'esperando', idle: 'inactivo', sleeping: 'durmiendo',
  starting: 'arrancando', ended: 'terminado', failed: 'fallido', frozen: 'congelado',
};
export const HUD_STATES = ['working', 'thinking', 'waiting', 'sleeping'] as const;
export const CATEGORY_LABEL: Record<string, string> = {
  read: 'lectura', edit: 'edición', run: 'ejecución', web: 'web', think: 'razonamiento', talk: 'conversación', wait: 'espera', other: 'otro',
};

export const CSS = `
.pa-ui{position:absolute;inset:0;pointer-events:none;font:11px/1.4 'Silkscreen','Courier New',monospace;color:#e9f2f7;
  --bg:#100e16;--bg2:#1a1423;--line:#3b3346;--mut:#a9b0bd;--gold:#f5c542}
.pa-ui *{box-sizing:border-box}
.pa-ui>*{pointer-events:auto}
.pa-ui button,.pa-ui input,.pa-ui select{font:inherit;color:inherit}
.pa-ui button{background:var(--bg2);border:2px solid var(--line);padding:3px 8px;cursor:pointer;text-transform:uppercase}
.pa-ui button:hover{border-color:#8f96a3}
.pa-ui button[aria-pressed=true]{background:#2e8a5e;border-color:#8ee6b4}
.pa-ui :focus-visible{outline:2px solid #ffd23f;outline-offset:1px}
.pa-ui input,.pa-ui select{background:var(--bg);border:2px solid var(--line);padding:3px 6px;min-width:0}
.pa-hud{position:absolute;top:0;left:0;right:0;display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;padding:6px 10px;
  background:rgba(16,14,22,.92);border-bottom:2px solid var(--line)}
.pa-count{display:inline-flex;gap:5px;align-items:center}
.pa-dot{width:8px;height:8px;display:inline-block;border:1px solid #1a1423}
.pa-sp{flex:1}
.pa-live{color:#8ee6b4}.pa-live.off{color:#ff9d8a}
.pa-chips{display:flex;gap:6px;flex-wrap:wrap}
.pa-chip{background:#4a3a08!important;border-color:var(--gold)!important;color:#fff1a8;animation:pa-blink 1s steps(2) infinite}
@keyframes pa-blink{50%{background:#7a5c0c}}
@media (prefers-reduced-motion:reduce){.pa-chip{animation:none}}
.pa-feed{position:absolute;left:8px;top:92px;bottom:8px;width:290px;display:flex;flex-direction:column;background:rgba(16,14,22,.92);border:2px solid var(--line)}
.pa-feed.closed{bottom:auto}
.pa-feed.closed .pa-feed-body{display:none}
.pa-feed-head{display:flex;gap:6px;align-items:center;padding:4px 6px;justify-content:space-between}
.pa-feed-body{display:flex;flex-direction:column;min-height:0;flex:1}
.pa-feed-body input{margin:0 6px 6px}
.pa-feed ol{list-style:none;margin:0;padding:0;overflow:auto;flex:1}
.pa-feed li button{display:block;width:100%;text-align:left;border:0;border-top:1px solid var(--line);text-transform:none;background:transparent;padding:3px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pa-feed li button:hover{background:var(--bg2)}
.pa-feed time{color:var(--mut);margin-right:6px}
.pa-search{position:absolute;top:44px;left:8px;right:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.pa-search input{width:400px;max-width:100%}
.pa-panel{position:absolute;top:92px;right:8px;width:320px;max-height:calc(100% - 100px);overflow:auto;background:rgba(16,14,22,.95);border:2px solid var(--line);padding:10px}
.pa-panel[hidden]{display:none}
.pa-panel h2{margin:0 0 2px;font-size:14px;display:flex;gap:6px;align-items:center;justify-content:space-between}
.pa-panel h3{margin:10px 0 3px;font-size:11px;color:var(--gold)}
.pa-panel dl{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:0}
.pa-panel dt{color:var(--mut)}.pa-panel dd{margin:0;word-break:break-all}
.pa-status{display:inline-block;padding:1px 6px;color:#100e16;font-weight:bold}
.pa-act{border:2px solid var(--line);background:var(--bg2);padding:6px;margin-top:6px}
.pa-act .tool{font-size:13px}
.pa-act .detail{display:block;margin-top:2px;word-break:break-all;text-transform:none;font-family:'Courier New',monospace;font-size:12px}
.pa-panel ul{list-style:none;margin:0;padding:0}
.pa-panel li{display:flex;gap:6px;text-transform:none}
.pa-panel li time{color:var(--mut);white-space:nowrap}
.pa-bar{height:6px;background:var(--line);margin-top:2px}.pa-bar>i{display:block;height:100%;background:#4cc38a}
.pa-toggles{display:flex;gap:6px}
.pa-link{border:0!important;background:none!important;padding:0!important;text-decoration:underline;text-transform:none!important;color:#79c0ff}
`;
