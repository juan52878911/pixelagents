/** Pixel-style CSS of the settings panel, injected once. High contrast (AA) and visible focus everywhere. */
export const CSS = `
.pa-settings{--bg:#15111c;--panel:#1c1726;--ink:#f2eadf;--mut:#b9b0c9;--line:#8f84a8;--acc:#ffd166;--bad:#ff8a80;--ok:#7be0a4;
  position:fixed;inset:0 0 0 auto;width:min(980px,100vw);background:var(--bg);color:var(--ink);z-index:1000;display:none;flex-direction:column;
  font:14px/1.45 ui-monospace,Menlo,Consolas,monospace;border-left:4px solid var(--acc);box-shadow:-8px 0 0 rgba(0,0,0,.4)}
.pa-settings.pa-open{display:flex}
.pa-settings *{box-sizing:border-box}
.pa-settings :focus-visible{outline:3px solid var(--acc);outline-offset:2px}
.pa-settings header{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:2px solid var(--line);background:var(--panel)}
.pa-settings h2{margin:0;font-size:16px;text-transform:uppercase;letter-spacing:.1em;flex:1}
.pa-settings h3{margin:12px 0 4px;font-size:14px;color:var(--acc)} .pa-settings h4{margin:8px 0 2px;font-size:12px;color:var(--mut);text-transform:uppercase}
.pa-body{display:flex;flex:1;min-height:0}
.pa-nav{display:flex;flex-direction:column;gap:2px;padding:8px;border-right:2px solid var(--line);background:var(--panel);min-width:150px}
.pa-nav button{all:unset;cursor:pointer;padding:8px 10px;border:2px solid transparent;color:var(--ink)}
.pa-nav button[aria-current="page"]{border-color:var(--acc);color:var(--acc);background:#2a2236}
.pa-nav button:hover{background:#2a2236}
.pa-main{flex:1;overflow:auto;padding:12px 16px 40px}
.pa-foot{display:flex;gap:8px;align-items:center;padding:10px 16px;border-top:2px solid var(--line);background:var(--panel);flex-wrap:wrap}
.pa-foot .pa-grow{flex:1;min-width:120px}
.pa-btn{font:inherit;cursor:pointer;color:var(--ink);background:#2a2236;border:2px solid var(--line);padding:5px 10px;box-shadow:2px 2px 0 #000}
.pa-btn:hover:not(:disabled){background:#3a3050} .pa-btn:disabled{opacity:.45;cursor:default}
.pa-btn.pa-primary{background:var(--acc);color:#1c1726;border-color:var(--acc);font-weight:700}
.pa-btn.pa-primary:hover:not(:disabled){background:#ffe29a}
.pa-btn.pa-small{padding:2px 7px;font-size:12px} .pa-btn[aria-pressed="true"],.pa-btn.pa-on{border-color:var(--acc);color:var(--acc)}
.pa-settings input[type=text],.pa-settings input[type=number],.pa-settings select,.pa-settings textarea{font:inherit;color:var(--ink);background:#0d0a12;border:2px solid var(--line);padding:4px 6px;min-width:0;max-width:100%}
.pa-settings textarea{width:100%} .pa-big{min-height:420px}
.pa-settings label{color:var(--ink)} .pa-settings small,.pa-help{color:var(--mut);font-size:12px;display:block}
.pa-field{display:flex;flex-direction:column;gap:2px;margin:6px 0;min-width:0} .pa-check{flex-direction:row;align-items:center;flex-wrap:wrap;gap:6px}
.pa-settings fieldset{border:2px solid var(--line);margin:8px 0;padding:6px 10px;min-width:0} .pa-settings legend{padding:0 6px;color:var(--acc)}
.pa-card{background:#1f1a29}
.pa-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap} .pa-row>.pa-field{flex:1;margin:0}
.pa-maprow>.pa-key,.pa-key{width:11em;flex:none} .pa-pair .pa-key{width:12em} .pa-pair input:not(.pa-key){flex:1;min-width:8em}
.pa-stack{display:flex;flex-direction:column;gap:8px} .pa-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.pa-split{display:grid;grid-template-columns:minmax(0,3fr) minmax(220px,2fr);gap:16px;align-items:start}
.pa-preview{position:sticky;top:0;border:2px solid var(--acc);padding:8px 12px;background:#1f1a29}
.pa-pgroup{border-top:1px dashed var(--line);padding:4px 0} .pa-count{float:right;color:var(--acc)} .pa-tag{margin-left:8px;color:var(--mut);font-size:12px}
.pa-chips{display:flex;flex-wrap:wrap;gap:3px;margin-top:3px} .pa-chip{background:#2a2236;border:1px solid var(--line);padding:0 5px;font-size:11px}
.pa-err{color:var(--bad);font-size:12px;min-height:0} .pa-err:empty{display:none}
.pa-settings [aria-invalid="true"]{border-color:var(--bad)}
.pa-errlist{color:var(--bad);margin:4px 0;padding-left:18px}
.pa-details>summary{cursor:pointer;color:var(--acc);font-weight:700;padding:4px 0}
.pa-picker{display:flex;flex-wrap:wrap;gap:4px} .pa-pick{font:inherit;font-size:11px;color:var(--ink);background:#0d0a12;border:2px solid var(--line);padding:3px;display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;max-width:92px}
.pa-pick.pa-on,.pa-pick[aria-checked="true"]{border-color:var(--acc);color:var(--acc)} .pa-pick span{overflow:hidden;text-overflow:ellipsis;max-width:84px;white-space:nowrap}
.pa-thumb{image-rendering:pixelated;width:32px;height:32px;background:#2a2236} .pa-none{width:32px;height:32px;display:grid;place-items:center}
.pa-colors{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:4px} .pa-color{display:flex;gap:6px;align-items:center}
.pa-ckey{width:1.4em;color:var(--acc);text-align:center} .pa-color label{flex:1;font-size:12px} .pa-hex{width:6.5em}
.pa-assets{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px} .pa-asset{border:2px solid var(--line);padding:6px;background:#1f1a29;display:flex;flex-direction:column;gap:4px}
.pa-thumbs{display:flex;flex-wrap:wrap;gap:3px} .pa-png{image-rendering:pixelated;max-width:100%;max-height:96px;object-fit:contain;background:#2a2236}
.pa-editor:not(:empty){border:2px solid var(--acc);padding:8px 12px}
.pa-edit-main{display:flex;gap:16px;flex-wrap:wrap} .pa-grid{image-rendering:pixelated;border:2px solid var(--line);touch-action:none;max-width:100%}
.pa-prev{image-rendering:pixelated;background:#2a2236;border:2px solid var(--line)} .pa-pal{display:flex;flex-wrap:wrap;gap:6px}
.pa-swatch-wrap{display:inline-flex;align-items:center;gap:2px} .pa-swatch{width:30px;height:30px;border:2px solid var(--line);color:#fff;text-shadow:0 0 2px #000,0 0 2px #000;cursor:pointer;font:inherit}
.pa-swatch.pa-on{border-color:var(--acc);outline:2px solid var(--acc)} .pa-mini-color{width:22px;height:22px;padding:0;border:0;background:none}
.pa-frames{display:flex;gap:4px;flex-wrap:wrap}
.pa-toast{margin-left:8px;padding:2px 8px;border:2px solid var(--line)} .pa-toast.ok{color:var(--ok);border-color:var(--ok)} .pa-toast.error{color:var(--bad);border-color:var(--bad)}
.pa-banner{padding:8px 16px;background:#4a2a10;color:#ffe2b8;border-bottom:2px solid var(--acc);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pa-banner[hidden]{display:none}
.pa-dirty{color:var(--acc)}
@media (max-width:720px){.pa-body{flex-direction:column}.pa-nav{flex-direction:row;overflow:auto;border-right:0;border-bottom:2px solid var(--line)}.pa-split,.pa-cols{grid-template-columns:1fr}}
`;

export function injectStyles(doc: Document = document): void {
  if (doc.getElementById('pa-settings-css')) return;
  const s = doc.createElement('style');
  s.id = 'pa-settings-css';
  s.textContent = CSS;
  doc.head.append(s);
}
