import type { PxSprite } from '@pixelagents/protocol';
import { clone, h, uid } from './dom.js';
import { addFrame, drawSprite, fill, newSprite, removeFrame, removePaletteKey, resize, setPaletteColor, setPixel, toPxFile, validateSprite } from './pxmodel.js';
import type { SectionView, SettingsState } from './state.js';

/** Sprites: asset list with thumbnails, upload, and a small pixel editor that writes `.px.json` files. */
export function spritesSection(st: SettingsState): SectionView {
  const timers: ReturnType<typeof setInterval>[] = [];
  const status = h('p', { class: 'pa-help', role: 'status', 'aria-live': 'polite' });
  const say = (m: string): void => { status.textContent = m; };

  // ---- upload ----
  const fileInput = h('input', { id: uid('f'), type: 'file', accept: '.json,.png,application/json,image/png' });
  const upload = h('button', { type: 'button', class: 'pa-btn pa-primary', onclick: async () => {
    const f = fileInput.files?.[0];
    if (!f) { say('Choose a .px.json or .png file first.'); return; }
    const name = f.name;
    if (!/\.(px\.json|png)$/.test(name)) { say('The file name must end in .px.json or .png.'); return; }
    const r = await st.api.putAsset(name, f, name.endsWith('.png') ? 'image/png' : 'application/json');
    say(r.ok ? `Uploaded ${name}.` : `Upload failed: ${r.error}`);
    if (r.ok) { await st.refreshAssets(); st.rerender(); }
  } }, 'Upload');

  // ---- list ----
  const list = h('div', { class: 'pa-assets' });
  const editor = h('section', { class: 'pa-editor', 'aria-label': 'Pixel editor' });

  function renderList(): void {
    list.replaceChildren();
    for (const a of st.assets) {
      const card = h('div', { class: 'pa-asset', 'data-asset': a.name });
      card.append(h('strong', null, a.name), h('small', null, `${a.kind === 'png' ? 'PNG' : 'sprites'} · ${a.size} B · ${a.source}`));
      if (a.kind === 'png') card.append(h('img', { src: st.api.assetUrl(a.name), alt: a.name, class: 'pa-png' }));
      else {
        const ths = h('div', { class: 'pa-thumbs' });
        const mine = [...st.catalog.sprites.values()].filter((s) => s.file === a.name);
        for (const { sprite } of mine.slice(0, 24)) {
          ths.append(h('button', { type: 'button', class: 'pa-pick', title: `Edit ${sprite.name}`, 'aria-label': `Edit sprite ${sprite.name}`, onclick: () => openEditor(clone(sprite), a.name) }, st.catalog.thumb(sprite.name, 32)));
        }
        if (mine.length > 24) ths.append(h('span', { class: 'pa-help' }, `+${mine.length - 24} more`));
        const ov = [...st.catalog.overlays.values()].filter((o) => o.file === a.name);
        for (const { overlay } of ov) ths.append(h('span', { class: 'pa-pick pa-static', title: overlay.name }, st.catalog.thumb(overlay.name, 32)));
        card.append(ths);
      }
      list.append(card);
    }
    if (!st.assets.length) list.append(h('p', { class: 'pa-help' }, 'No asset files yet. Upload one, add a folder under Advanced → assets, or draw a sprite below.'));
  }

  // ---- editor ----
  function openEditor(initial: PxSprite, fromFile?: string): void {
    for (const t of timers.splice(0)) clearInterval(t);
    let s = initial;
    let frame = 0, tool: 'pen' | 'erase' | 'fill' = 'pen', key = Object.keys(s.palette)[0] ?? 'K';
    let cx = 0, cy = 0, down = false;
    const cell = Math.max(4, Math.min(24, Math.floor(384 / Math.max(s.w, s.h))));
    const grid = h('canvas', { width: s.w * cell, height: s.h * cell, class: 'pa-grid', tabindex: 0, role: 'application', 'aria-label': 'Sprite canvas: arrow keys move, space paints' });
    const prev = h('canvas', { width: s.w * 4, height: s.h * 4, class: 'pa-prev', 'aria-label': 'Animated preview' });
    const palBox = h('div', { class: 'pa-pal', role: 'radiogroup', 'aria-label': 'Palette' });
    const frames = h('div', { class: 'pa-frames', role: 'group', 'aria-label': 'Frames' });
    const msg = h('p', { class: 'pa-err', role: 'status', 'aria-live': 'polite' });
    const nameInput = h('input', { id: uid('f'), type: 'text', value: s.name, spellcheck: 'false' });
    const fileName = h('input', { id: uid('f'), type: 'text', value: `${s.name}.px.json`, spellcheck: 'false' });
    const fps = h('input', { id: uid('f'), type: 'number', min: 0, max: 60, value: String(s.fps ?? 0) });

    const paint = (): void => {
      const ctx = grid.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, grid.width, grid.height);
      for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { ctx.fillStyle = (x + y) % 2 ? '#2a2236' : '#241d2f'; ctx.fillRect(x * cell, y * cell, cell, cell); }
      drawSprite(ctx, s, frame, cell);
      ctx.strokeStyle = 'rgba(255,255,255,.12)';
      for (let x = 0; x <= s.w; x++) { ctx.beginPath(); ctx.moveTo(x * cell + .5, 0); ctx.lineTo(x * cell + .5, s.h * cell); ctx.stroke(); }
      for (let y = 0; y <= s.h; y++) { ctx.beginPath(); ctx.moveTo(0, y * cell + .5); ctx.lineTo(s.w * cell, y * cell + .5); ctx.stroke(); }
      ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; ctx.strokeRect(cx * cell + 1, cy * cell + 1, cell - 2, cell - 2); ctx.lineWidth = 1;
    };
    let pf = 0;
    const tick = (): void => {
      const ctx = prev.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, prev.width, prev.height);
      drawSprite(ctx, s, pf % s.frames.length, 4);
      pf++;
    };
    const renderChrome = (): void => {
      palBox.replaceChildren(...Object.entries(s.palette).map(([k, c]) => {
        const on = k === key;
        return h('span', { class: 'pa-swatch-wrap' },
          h('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: 'pa-swatch' + (on ? ' pa-on' : ''), style: `background:${c}`, title: `${k} ${c}`, 'aria-label': `Color ${k} ${c}`, onclick: () => { key = k; tool = tool === 'erase' ? 'pen' : tool; renderChrome(); } }, k),
          h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(c) ? c : '#808080', 'aria-label': `Change color ${k}`, class: 'pa-mini-color', onchange: (e: Event) => { s = setPaletteColor(s, k, (e.target as HTMLInputElement).value); renderChrome(); paint(); } }),
          h('button', { type: 'button', class: 'pa-btn pa-small', 'aria-label': `Remove color ${k}`, onclick: () => { s = removePaletteKey(s, k); if (key === k) key = Object.keys(s.palette)[0] ?? '.'; renderChrome(); paint(); } }, '✕'));
      }));
      frames.replaceChildren(...s.frames.map((_, i) => h('button', { type: 'button', class: 'pa-btn pa-small' + (i === frame ? ' pa-on' : ''), 'aria-pressed': String(i === frame), onclick: () => { frame = i; renderChrome(); paint(); } }, String(i + 1))),
        h('button', { type: 'button', class: 'pa-btn pa-small', onclick: () => { s = addFrame(s); frame = s.frames.length - 1; renderChrome(); paint(); } }, '+ blank'),
        h('button', { type: 'button', class: 'pa-btn pa-small', onclick: () => { s = addFrame(s, frame); frame = s.frames.length - 1; renderChrome(); paint(); } }, '+ copy'),
        h('button', { type: 'button', class: 'pa-btn pa-small', onclick: () => { s = removeFrame(s, frame); frame = Math.min(frame, s.frames.length - 1); renderChrome(); paint(); } }, 'delete frame'));
    };
    const apply = (x: number, y: number): void => {
      const k = tool === 'erase' ? '.' : key;
      s = tool === 'fill' ? fill(s, frame, x, y, k) : setPixel(s, frame, x, y, k);
      paint();
    };
    const at = (e: PointerEvent): [number, number] => {
      const r = grid.getBoundingClientRect();
      return [Math.floor(((e.clientX - r.left) / r.width) * s.w), Math.floor(((e.clientY - r.top) / r.height) * s.h)];
    };
    grid.addEventListener('pointerdown', (e) => { down = true; grid.focus(); [cx, cy] = at(e); apply(cx, cy); grid.setPointerCapture?.(e.pointerId); });
    grid.addEventListener('pointermove', (e) => { const [x, y] = at(e); cx = Math.max(0, Math.min(s.w - 1, x)); cy = Math.max(0, Math.min(s.h - 1, y)); if (down && tool !== 'fill') apply(cx, cy); else paint(); });
    grid.addEventListener('pointerup', () => { down = false; });
    grid.addEventListener('keydown', (e) => {
      const d: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (d[e.key]) { e.preventDefault(); cx = Math.max(0, Math.min(s.w - 1, cx + d[e.key]![0])); cy = Math.max(0, Math.min(s.h - 1, cy + d[e.key]![1])); paint(); }
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); apply(cx, cy); }
    });

    const toolBtn = (t: typeof tool, label: string): HTMLElement => h('button', { type: 'button', class: 'pa-btn', 'aria-pressed': String(tool === t), onclick: (ev: Event) => { tool = t; for (const b of (ev.currentTarget as HTMLElement).parentElement!.children) b.setAttribute('aria-pressed', String(b === ev.currentTarget)); } }, label);
    const keyIn = h('input', { id: uid('f'), type: 'text', maxlength: 1, class: 'pa-hex', 'aria-label': 'New palette key (one character)', placeholder: 'key' });
    const colIn = h('input', { id: uid('f'), type: 'color', value: '#e4572e', 'aria-label': 'New palette color' });
    const wIn = h('input', { id: uid('f'), type: 'number', min: 1, max: 64, value: String(s.w) });
    const hIn = h('input', { id: uid('f'), type: 'number', min: 1, max: 64, value: String(s.h) });

    nameInput.addEventListener('change', () => { s = { ...s, name: nameInput.value.trim() }; fileName.value = `${s.name}.px.json`; });
    fps.addEventListener('change', () => { const n = Math.max(0, Math.min(60, Number(fps.value) || 0)); s = { ...s, fps: n }; resetTimer(); });
    function resetTimer(): void { for (const t of timers.splice(0)) clearInterval(t); timers.push(setInterval(tick, Math.max(60, 1000 / Math.max(1, s.fps || 4)))); }

    const save = h('button', { type: 'button', class: 'pa-btn pa-primary', onclick: async () => {
      msg.textContent = '';
      const errs = validateSprite(s);
      if (errs.length) { msg.textContent = errs[0]!; return; }
      const fn = fileName.value.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.px\.json$/.test(fn)) { msg.textContent = 'File name must end in .px.json'; return; }
      const body = JSON.stringify(toPxFile(s), null, 1);
      const r = await st.api.putAsset(fn, body, 'application/json');
      if (!r.ok) { msg.textContent = r.error; return; }
      say(`Saved ${s.name} to ${fn}.`);
      await st.refreshAssets(); renderList();
    } }, 'Save sprite');

    editor.replaceChildren(
      h('h3', null, fromFile ? `Editing ${initial.name}` : 'New sprite'),
      h('div', { class: 'pa-row' },
        h('label', { for: nameInput.id }, 'Sprite name'), nameInput,
        h('label', { for: fileName.id }, 'File'), fileName,
        h('label', { for: fps.id }, 'FPS'), fps),
      h('div', { class: 'pa-row' },
        h('label', { for: wIn.id }, 'Width'), wIn, h('label', { for: hIn.id }, 'Height'), hIn,
        h('button', { type: 'button', class: 'pa-btn', onclick: () => { s = resize(s, Math.max(1, Number(wIn.value) || s.w), Math.max(1, Number(hIn.value) || s.h)); openEditor(s, fromFile); } }, 'Resize')),
      h('div', { class: 'pa-edit-main' },
        h('div', null, grid, h('div', { class: 'pa-row', role: 'group', 'aria-label': 'Tool' }, toolBtn('pen', 'Pen'), toolBtn('erase', 'Eraser'), toolBtn('fill', 'Fill'))),
        h('div', null, h('h4', null, 'Preview'), prev, h('h4', null, 'Palette'), palBox,
          h('div', { class: 'pa-row' }, keyIn, colIn, h('button', { type: 'button', class: 'pa-btn', onclick: () => {
            const k = keyIn.value; const n = setPaletteColor(s, k, colIn.value);
            if (n !== s) { s = n; key = k; keyIn.value = ''; renderChrome(); paint(); } else msg.textContent = 'Key must be one character other than "."';
          } }, 'Add color')),
          h('h4', null, 'Frames'), frames)),
      h('div', { class: 'pa-row' }, save, h('button', { type: 'button', class: 'pa-btn', onclick: () => { for (const t of timers.splice(0)) clearInterval(t); editor.replaceChildren(); } }, 'Close editor')),
      msg);
    renderChrome(); paint(); resetTimer(); tick();
  }

  const newName = h('input', { id: uid('f'), type: 'text', value: 'my.sprite', spellcheck: 'false' });
  const el = h('div', { class: 'pa-stack' },
    h('p', { class: 'pa-help' }, 'Sprite files the server can load. Uploads are saved on the server and picked up without a restart.'),
    h('div', { class: 'pa-row' }, h('label', { for: fileInput.id }, 'Upload .px.json or .png'), fileInput, upload),
    status, list,
    h('h3', null, 'Pixel editor'),
    h('div', { class: 'pa-row' }, h('label', { for: newName.id }, 'New sprite'), newName,
      h('button', { type: 'button', class: 'pa-btn pa-primary', onclick: () => openEditor(newSprite(newName.value.trim() || 'my.sprite', 16, 16)) }, 'Create 16×16')),
    editor);
  renderList();
  return { el, dispose: () => { for (const t of timers) clearInterval(t); } };
}
