// ---------- the world: procedural offices, regenerated every day ----------
const TS = 8, GY = 24, GC = 60, GR = 38;
const DOW = ['DOM','LUN','MAR','MIE','JUE','VIE','SAB'];
const MON = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
const SPEC = [
  { name:'LAPTOP', kind:'MAC', load:79, spend:56.10, wall:'#e8d9bf', floor:'parquet',
    zones:[ { repo:'PIXELAGENTS', agents:[{acc:'personal', st:'work', seed:1}, {acc:'personal', st:'think', seed:2}] },
            { repo:'CHRONO', agents:[{acc:'work', st:'work', seed:3}, {acc:'personal', st:'wait', seed:4}] },
            { repo:'NOD', agents:[{acc:'work', st:'sleep', seed:5}] } ],
    visitor:{ acc:'work', seed:21, newZone:'BLOG', offset:0 }, convos:[[1,2],[3,0],[0,3]] },
  { name:'WORKSTATION', kind:'PC', load:34, spend:12.40, wall:'#b9c4d6', floor:'carpet',
    zones:[ { repo:'DELEGA', agents:[{acc:'work', st:'work', seed:6, minis:2}, {acc:'work', st:'work', seed:7}] },
            { repo:'SPEC', agents:[{acc:'personal', st:'think', seed:8}] } ],
    visitor:{ acc:'personal', seed:22, zoneRepo:'SPEC', offset:9 }, convos:[[2,1]] },
  { name:'VM-1', kind:'VM', load:12, spend:3.20, wall:'#3a404c', floor:'server', racks:2,
    zones:[ { repo:'SHOP', agents:[{acc:'plus', st:'work', seed:9, poof:2}, {acc:'work', st:'wait', seed:10}] } ], convos:[] },
  { name:'KINDLING', kind:'MICROVM', load:58, spend:8.70, wall:'#24323d', floor:'lab',
    pods:[ {name:'SHOP', acc:'work', st:'run', seed:11}, {name:'DBDEMO', acc:'personal', st:'fire', seed:12},
           {name:'HELLO', acc:'work', st:'frozen', seed:13}, {name:'SANDBOX', acc:'plus', st:'dead', seed:14},
           {name:'HUB', acc:'personal', st:'run', seed:15, cycle:true}, {name:'SPEC', acc:'work', st:'frozen', seed:16} ] }
];
const RUGS = ['#6e3a4c','#2f5d62','#4f4380','#6d5f2b','#3d5a3a','#5a3d5c'];
const STRAT_NAME = { alas:'ALAS', escalera:'ESCALERA', mancha:'MANCHA', mordida:'MORDIDA', cueva:'CUEVA' };
const SEASONS = {
  verano:  { g:'#3f7a3a', d:'#356b31', l:'#4a8a43', fl:['#f2c14e','#ffffff','#e57a9a','#9b5de5'], c:'#3f8a3a', cd:'#2e6a2c', ch:'#5aa84a' },
  otono:   { g:'#6b7a34', d:'#5a6a2c', l:'#7a8a3c', fl:['#e8833a','#c4302b','#f2c14e'],           c:'#d9822b', cd:'#a85a1c', ch:'#f2b04e' },
  invierno:{ g:'#d6e2ea', d:'#c4d2dc', l:'#f2f7fa', fl:['#9fdcff','#ffffff'],                     c:'#2f6a4a', cd:'#24523a', ch:'#ffffff' }
};
function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function makeRng(seed) {
  let a = seed | 0;
  const f = () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  return { f, i:(lo, hi) => lo + Math.floor(f() * (hi - lo + 1)), pick:(arr) => arr[Math.floor(f() * arr.length)] };
}
function shuffle(arr, rg) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rg.f() * (i + 1)); const x = arr[i]; arr[i] = arr[j]; arr[j] = x; } return arr; }
function dayInfo(offset) {
  const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + (offset | 0));
  const m = d.getMonth();
  return { key:d.getFullYear() + '-' + (m + 1) + '-' + d.getDate(), label:DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[m],
           season: m >= 8 && m <= 10 ? 'otono' : (m === 11 || m <= 1) ? 'invierno' : 'verano' };
}
function plain(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(); }

// one office: its contents decide the size of its main hall
function makeOffice(spec, idx, rg) {
  const o = { idx, name:spec.name, kind:spec.kind, load:spec.load, spend:spec.spend, wall:spec.wall, floor:spec.floor, racks:spec.racks || 0, th:13 };
  o.signEnd = 5 + txtW(o.name + ' · ' + o.kind) + 6;
  o.door = o.signEnd + 6 + rg.i(0, 12);
  if (spec.pods) {
    o.pods = spec.pods.map(p => Object.assign({}, p, { hair:p.acc === 'plus' ? p.seed % 2 : p.seed % 3 }));
    o.tw = 34;
    return o;
  }
  o.agents = []; o.zones = []; o.convos = spec.convos;
  o.visitor = spec.visitor ? Object.assign({}, spec.visitor) : null;
  if (o.visitor) o.visitor.hair = o.visitor.acc === 'plus' ? o.visitor.seed % 2 : o.visitor.seed % 3;
  const ids = []; let id = 0;
  spec.zones.forEach(z => { ids.push(z.agents.map(() => id++)); z.agents.forEach(a => o.agents.push(Object.assign({}, a, { hair:a.acc === 'plus' ? a.seed % 2 : a.seed % 3 }))); });
  // repos swap places every day; agent ids stay put so conversations keep their pairs
  let cur = 12 + (o.racks ? o.racks * 16 + 4 : 0);
  for (const zi of shuffle(spec.zones.map((z, i) => i), rg)) {
    const z = spec.zones[zi], zid = ids[zi];
    zid.forEach((aid, k) => { o.agents[aid].rel = cur + 5 + k * 30; });
    let n = zid.length;
    if (o.visitor && o.visitor.zoneRepo === z.repo) { o.visitor.rel = cur + 5 + n * 30; n++; }
    o.zones.push({ repo:z.repo, ids:zid });
    cur += (n - 1) * 30 + 34 + 6;
  }
  if (o.visitor && o.visitor.newZone) { o.visitor.rel = cur + 5; cur += 40; }
  if (o.visitor) o.visitor.zone = o.visitor.zoneRepo ? o.zones.findIndex(z => z.repo === o.visitor.zoneRepo) : null;
  o.tw = Math.ceil((cur + 30) / TS);
  return o;
}
function placeRow(row, ty, rg) {
  const spare = Math.max(0, GC - row[0].tw - row[1].tw - 1), left = rg.i(0, spare), gap = 1 + rg.i(0, spare - left);
  row[0].tx = left; row[1].tx = left + row[0].tw + gap;
  row.forEach(o => { o.ty = Math.min(GR - 1 - o.th, ty + rg.i(0, 2)); });
}

// growth strategies: how each office sprouts past its rectangular hall
function addRect(o, oi, cx, x, y, w, h, anchor, strict) {
  for (let tries = 0; tries < 8; tries++) {
    let ok = w >= 2 && h >= 2;
    for (let r = y; ok && r < y + h; r++) for (let c = x; ok && c < x + w; c++) if (!(cx.own[r] && cx.own[r][c] === oi) && !cx.free(c, r, oi)) ok = false;
    if (ok) { for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) cx.own[r][c] = oi; return true; }
    if (strict) return false;
    if (h > 2) h--; else if (w > 3) { w--; if (anchor === 'left') x++; } else return false;
  }
  return false;
}
const GROW = {
  alas(o, oi, cx) {
    const rg = cx.rg;
    for (let k = 0, n = rg.i(1, 3); k < n; k++) {
      const side = rg.pick(['bottom', 'bottom', 'left', 'right']);
      if (side === 'bottom') { const ww = rg.i(4, Math.min(12, o.tw - 2)); addRect(o, oi, cx, o.tx + rg.i(0, o.tw - ww), o.ty + o.th, ww, rg.i(2, 5), 'down'); }
      else { const ww = rg.i(3, 7); addRect(o, oi, cx, side === 'left' ? o.tx - ww : o.tx + o.tw, o.ty + rg.i(3, o.th - 3), ww, rg.i(3, 7), side); }
    }
  },
  escalera(o, oi, cx) {
    const rg = cx.rg, dir = rg.f() < 0.5 ? 1 : -1;
    let w = rg.i(7, Math.min(13, o.tw - 2)), x = dir > 0 ? o.tx + rg.i(0, 3) : o.tx + o.tw - w - rg.i(0, 3), y = o.ty + o.th;
    for (let s = 0, n = rg.i(2, 4); s < n && w >= 4; s++) {
      if (!addRect(o, oi, cx, x, y, w, 2, 'down', true)) break;
      const sh = rg.i(2, Math.max(2, w - 3));
      y += 2; x += dir * sh; w -= rg.i(0, 2);
    }
  },
  mancha(o, oi, cx, count) {
    const rg = cx.rg, own = cx.own;
    for (let k = 0, n = count || rg.i(18, 40); k < n; k++) {
      const cand = [];
      for (let r = o.ty + 3; r < GR; r++) for (let c = 0; c < GC; c++) if (own[r][c] === oi)
        for (const d of [[1,0],[-1,0],[0,1],[0,-1]]) if (cx.free(c + d[0], r + d[1], oi)) cand.push([c + d[0], r + d[1]]);
      if (!cand.length) break;
      const q = rg.pick(cand); own[q[1]][q[0]] = oi;
    }
    // fill pockets so the blob reads as one room
    for (let r = o.ty; r < GR; r++) for (let c = 0; c < GC; c++) if (cx.free(c, r, oi)) {
      let n = 0; for (const d of [[1,0],[-1,0],[0,1],[0,-1]]) if (own[r + d[1]] && own[r + d[1]][c + d[0]] === oi) n++;
      if (n >= 3) own[r][c] = oi;
    }
  },
  mordida(o, oi, cx) {
    const rg = cx.rg, r = o.ty + o.th - 1;
    for (let c = 0, n = rg.i(1, 3); c < n; c++) cx.own[r][o.tx + c] = -1;
    for (let c = 0, n = rg.i(1, 2); c < n; c++) cx.own[r][o.tx + o.tw - 1 - c] = -1;
    GROW.mancha(o, oi, cx, rg.i(8, 18));
  },
  cueva(o, oi, cx) {
    const rg = cx.rg, x0 = o.tx + rg.i(1, 6), x1 = o.tx + o.tw - rg.i(1, 6), y0 = o.ty + o.th, y1 = Math.min(GR - 1, y0 + rg.i(4, 7));
    let alive = {};
    const key = (c, r) => c + ',' + r;
    for (let r = y0; r <= y1; r++) for (let c = x0; c < x1; c++) if (cx.free(c, r, oi) && (r === y0 || rg.f() < 0.55)) alive[key(c, r)] = 1;
    for (let it = 0; it < 4; it++) {
      const next = {};
      for (let r = y0; r <= y1; r++) for (let c = x0; c < x1; c++) {
        if (!cx.free(c, r, oi)) continue;
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (dr || dc) {
          const rr = r + dr, cc = c + dc;
          if (alive[key(cc, rr)] || (rr < y0 && cx.own[rr] && cx.own[rr][cc] === oi)) n++;
        }
        if (n >= 5 || (alive[key(c, r)] && n >= 4)) next[key(c, r)] = 1;
      }
      alive = next;
    }
    const stack = []; for (let c = x0; c < x1; c++) if (alive[key(c, y0)]) stack.push([c, y0]);
    const seen = {};
    while (stack.length) {
      const q = stack.pop(), k = key(q[0], q[1]);
      if (seen[k] || !alive[k]) continue; seen[k] = 1; cx.own[q[1]][q[0]] = oi;
      for (const d of [[1,0],[-1,0],[0,1],[0,-1]]) stack.push([q[0] + d[0], q[1] + d[1]]);
    }
  }
};

function planWall(o, rg, guinos) {
  o.windows = []; o.wallDeco = []; o.poster = null;
  const wallIds = guinos ? Object.keys(POPD).filter(k => POPD[k].place === 'wall') : [];
  let x = o.door + 16; const end = o.w - 30;
  while (x < end) {
    const opts = [];
    if (o.floor === 'parquet' && o.windows.length < 2) opts.push('win');
    if ((o.floor === 'carpet' || o.floor === 'lab') && o.poster == null) opts.push('poster');
    if (wallIds.length && o.wallDeco.length < 3) opts.push('pop');
    if (!opts.length) break;
    const k = rg.pick(opts);
    if (k === 'win') { if (x + 22 > end) break; o.windows.push(x); x += 22; }
    else if (k === 'poster') { if (x + 12 > end) break; o.poster = x; x += 12; }
    else { const id = rg.pick(wallIds), d = POPD[id]; if (x + d.w > end) break; o.wallDeco.push({ id, x:o.x + x, y:o.y + 2 + Math.max(0, 12 - d.h), w:d.w, h:d.h }); x += d.w; }
    x += rg.i(6, 18);
  }
}
const DECO_SIZE = { plant:[8,12], sofa:[34,11], cooler:[7,17], table:[16,10], shelf:[12,16], lamp:[5,16] };
function decoSize(id) { return DECO_SIZE[id] || (POPD[id] ? [POPD[id].w, POPD[id].h] : [8, 8]); }
function placeDecor(o, oi, own, rg, guinos) {
  o.decor = [];
  const popF = guinos ? Object.keys(POPD).filter(k => POPD[k].place === 'floor') : [];
  const basic = o.racks ? ['plant', 'lamp', 'shelf'] : o.pods ? ['plant', 'lamp', 'cooler'] : ['plant', 'sofa', 'cooler', 'table', 'shelf', 'lamp'];
  const ownsPx = (x, y) => { const c = Math.floor(x / TS), r = Math.floor((y - GY) / TS); return r >= 0 && c >= 0 && r < GR && c < GC && own[r][c] === oi; };
  const fits = (x, y, w, h) => {
    for (let yy = y; yy < y + h + 3; yy += 3) for (let xx = x; xx < x + w + 3; xx += 3) if (!ownsPx(Math.min(xx, x + w - 1), Math.min(yy, y + h - 1))) return false;
    return !o.decor.some(d => x < d.x + d.w + 3 && d.x < x + w + 3 && y < d.y + d.h + 2 && d.y < y + h + 2);
  };
  const pickId = () => popF.length && rg.f() < 0.55 ? rg.pick(popF) : rg.pick(basic);
  for (let n = rg.i(2, 4), tries = 0; n > 0 && tries < 50; tries++) {
    const id = pickId(), s = decoSize(id), y = o.y + 102 - s[1], x = o.x + rg.i(8, Math.max(8, o.w - 36 - s[0]));
    if (y >= o.y + 81 && fits(x, y, s[0], s[1])) { o.decor.push({ id, x, y, w:s[0], h:s[1] }); n--; }
  }
  const wing = [];
  for (let r = 0; r < GR; r++) for (let c = 0; c < GC; c++) if (own[r][c] === oi && (r >= o.ty + o.th || c < o.tx || c >= o.tx + o.tw)) wing.push([c, r]);
  for (let m = Math.min(5, Math.ceil(wing.length / 9)), tries = 0; m > 0 && wing.length && tries < 80; tries++) {
    const q = rg.pick(wing), id = pickId(), s = decoSize(id), x = q[0] * TS + rg.i(0, 3), y = GY + q[1] * TS + 8 - s[1];
    if (fits(x, y, s[0], s[1])) { o.decor.push({ id, x, y, w:s[0], h:s[1] }); m--; }
  }
}

function buildWorld(day, guinos) {
  const rg = makeRng(strHash(day.key));
  const offs = SPEC.map((s, i) => makeOffice(s, i, rg));
  const own = []; for (let r = 0; r < GR; r++) own.push(new Array(GC).fill(-1));
  const reserved = new Set(), K = (c, r) => r * GC + c;
  const rows = rg.f() < 0.5 ? [[offs[0], offs[1]], [offs[3], offs[2]]] : [[offs[0], offs[2]], [offs[3], offs[1]]];
  if (rg.f() < 0.5) rows.reverse();
  rows.forEach(r => { if (rg.f() < 0.5) r.reverse(); });
  placeRow(rows[0], rg.i(1, 2), rg);
  const b1 = Math.max(rows[0][0].ty, rows[0][1].ty) + 13;
  placeRow(rows[1], rg.i(b1 + 2, Math.max(b1 + 2, 22)), rg);
  offs.forEach((o, oi) => {
    o.x = o.tx * TS; o.y = GY + o.ty * TS; o.w = o.tw * TS; o.h = o.th * TS; o.deskY = o.y + 58; o.podY = o.y + 46;
    for (let r = o.ty; r < o.ty + o.th; r++) for (let c = o.tx; c < o.tx + o.tw; c++) own[r][c] = oi;
    if (o.agents) o.agents.forEach(a => { a.dx = o.x + a.rel; });
    if (o.visitor) o.visitor.slotDx = o.x + o.visitor.rel;
    o.doorTile = [Math.floor((o.x + o.door + 5) / TS), o.ty - 1];
    reserved.add(K(o.doorTile[0], o.ty - 1)); reserved.add(K(o.doorTile[0], o.ty - 2));
  });
  const free = (c, r, oi) => {
    if (c < 0 || r < 0 || c >= GC || r >= GR || own[r][c] !== -1 || reserved.has(K(c, r))) return false;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const cc = c + dc, rr = r + dr;
      if (cc >= 0 && rr >= 0 && cc < GC && rr < GR && own[rr][cc] !== -1 && own[rr][cc] !== oi) return false;
    }
    return true;
  };
  const cx = { own, free, rg };
  for (const oi of shuffle([0, 1, 2, 3], rg)) {
    const o = offs[oi];
    o.strategy = rg.pick(o.pods ? ['cueva', 'cueva', 'mancha', 'alas'] : ['alas', 'escalera', 'mancha', 'mordida']);
    GROW[o.strategy](o, oi, cx);
  }
  // paths: a plaza, then every door finds its way to the network along a noisy cheapest route
  const path = new Set(), ptiles = [];
  const plazaC = [];
  for (let r = 1; r < GR - 3; r++) for (let c = 1; c < GC - 3; c++) {
    let ok = true;
    for (let dr = -1; dr <= 3 && ok; dr++) for (let dc = -1; dc <= 3 && ok; dc++) if (own[r + dr][c + dc] !== -1) ok = false;
    if (ok) plazaC.push([c, r]);
  }
  const plaza = plazaC.length ? rg.pick(plazaC) : [offs[0].doorTile[0], offs[0].doorTile[1]];
  for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) { const k = K(plaza[0] + dc, plaza[1] + dr); if (plazaC.length && !path.has(k)) { path.add(k); ptiles.push(k); } }
  if (!plazaC.length) { path.add(K(plaza[0], plaza[1])); ptiles.push(K(plaza[0], plaza[1])); }
  const noise = new Float64Array(GR * GC); for (let i = 0; i < noise.length; i++) noise[i] = rg.f() * 2.5;
  const route = (sc, sr) => {
    const N = GR * GC, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N), heap = [];
    const push = (d, k) => { heap.push([d, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; const t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, rr = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr; if (m === i) break; const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m; } } return top; };
    const s = K(sc, sr); dist[s] = 0; push(0, s);
    while (heap.length) {
      const e = pop(), k = e[1]; if (done[k]) continue; done[k] = 1;
      if (path.has(k) && k !== s) { const out = []; let q = k; while (q !== -1) { out.push(q); q = prev[q]; } return out.reverse(); }
      const c = k % GC, r = (k / GC) | 0;
      for (const d of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const cc = c + d[0], rr = r + d[1];
        if (cc < 0 || rr < 0 || cc >= GC || rr >= GR || own[rr][cc] !== -1) continue;
        const kk = K(cc, rr), nd = e[0] + 1 + noise[kk];
        if (nd < dist[kk]) { dist[kk] = nd; prev[kk] = k; push(nd, kk); }
      }
    }
    return [s];
  };
  for (const oi of shuffle([0, 1, 2, 3], rg)) {
    const dt = offs[oi].doorTile;
    if (dt[1] < 0) continue;
    for (const k of route(dt[0], dt[1])) if (!path.has(k)) { path.add(k); ptiles.push(k); }
  }
  // trees and bushes keep a tile of grass around paths and buildings
  const near = (c, r, d) => {
    for (let dr = -d; dr <= d; dr++) for (let dc = -d; dc <= d; dc++) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= GC || rr >= GR) continue;
      if (own[rr][cc] !== -1 || path.has(K(cc, rr)) || reserved.has(K(cc, rr))) return true;
    }
    return false;
  };
  const trees = [], bushes = [];
  for (let tries = 0, want = rg.i(10, 18); trees.length < want && tries < 500; tries++) {
    const c = rg.i(0, GC - 2), r = rg.i(2, GR - 1);
    if (near(c, r, 1) || near(c + 1, r, 1) || near(c, r - 1, 0)) continue;
    if (trees.some(q => Math.abs(q.c - c) < 3 && Math.abs(q.r - r) < 3)) continue;
    trees.push({ c, r, kind:rg.i(0, 2), x:c * TS - 3, y:GY + r * TS - 10 });
  }
  for (let tries = 0, want = rg.i(10, 20); bushes.length < want && tries < 400; tries++) {
    const c = rg.i(0, GC - 1), r = rg.i(1, GR - 1);
    if (near(c, r, 0) || trees.some(q => Math.abs(q.c - c) < 2 && Math.abs(q.r - r) < 2)) continue;
    bushes.push({ c, r, x:c * TS + rg.i(0, 2), y:GY + r * TS + rg.i(1, 3) });
  }
  const outdoor = [];
  if (guinos) {
    const popF = Object.keys(POPD).filter(k => POPD[k].place === 'floor');
    if (popF.length && plazaC.length) { const id = rg.pick(popF), d = POPD[id]; outdoor.push({ id, x:plaza[0] * TS + 12 - (d.w >> 1), y:GY + plaza[1] * TS + 20 - d.h, w:d.w, h:d.h }); }
    for (let tries = 0, n = rg.i(1, 3); popF.length && n > 0 && tries < 60; tries++) {
      const c = rg.i(1, GC - 3), r = rg.i(2, GR - 2);
      if (near(c, r, 1) || near(c + 1, r, 1) || trees.some(q => Math.abs(q.c - c) < 3 && Math.abs(q.r - r) < 3)) continue;
      const id = rg.pick(popF), d = POPD[id]; outdoor.push({ id, x:c * TS, y:GY + r * TS + 8 - d.h, w:d.w, h:d.h }); n--;
    }
  }
  // finish offices: wall features, decor, build order (flood from the door)
  const reveal = [];
  shuffle([0, 1, 2, 3], rg).forEach((oi, k) => {
    const o = offs[oi];
    planWall(o, rg, guinos); placeDecor(o, oi, own, rg, guinos);
    const start = [o.doorTile[0], o.ty], seen = new Set([K(start[0], start[1])]), q = [start];
    o.order = [];
    while (q.length) {
      const t = q.shift(); o.order.push(t);
      for (const d of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const c = t[0] + d[0], r = t[1] + d[1], kk = K(c, r);
        if (c < 0 || r < 0 || c >= GC || r >= GR || own[r][c] !== oi || seen.has(kk)) continue;
        seen.add(kk); q.push([c, r]);
      }
    }
    o.buildStart = 0.5 + k * 0.45; o.buildDur = 2 + o.order.length * 0.0045; o.doneAt = o.buildStart + o.buildDur + 0.25;
    o.order.forEach((tl, i) => reveal.push({ x:tl[0] * TS, y:GY + tl[1] * TS, w:TS, h:TS, time:o.buildStart + (i / o.order.length) * o.buildDur }));
  });
  const pStart = Math.max.apply(null, offs.map(o => o.doneAt)) - 1.2;
  ptiles.forEach((k, i) => reveal.push({ x:(k % GC) * TS, y:GY + ((k / GC) | 0) * TS, w:TS, h:TS, time:pStart + i * 0.01 }));
  trees.forEach(tr => reveal.push({ x:tr.x, y:tr.y, w:14, h:18, time:pStart + rg.f() * 1.8 }));
  bushes.forEach(b => reveal.push({ x:b.x, y:b.y, w:8, h:6, time:pStart + rg.f() * 1.8 }));
  const buildEnd = Math.max.apply(null, reveal.map(r => r.time)) + 0.4;
  return { day, offices:offs, own, path, ptiles, plaza, plazaOk:plazaC.length > 0, trees, bushes, outdoor, reveal, buildEnd,
           season:SEASONS[day.season], seed:strHash(day.key) };
}

// ---------- painting the world (once per day) ----------
function drawFloorPattern(g, kind, x0, y0, w, h) {
  const x1 = x0 + w, y1 = y0 + h;
  if (kind === 'parquet') {
    for (let r = 0, y = y0; y < y1; r++, y += 4) {
      for (let x = x0 - (r % 2) * 8; x < x1; x += 16) { R(g, x, y, 16, 4, (((x - x0 + 16) >> 4) + r) % 3 === 0 ? '#ad7f55' : '#b98a5e'); R(g, x, y, 1, 4, '#8f6542'); }
      R(g, x0, y + 3, w, 1, '#9c7049');
    }
  } else if (kind === 'carpet') {
    R(g, x0, y0, w, h, '#45557a');
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if ((x * 3 + y * 5) % 7 === 0) R(g, x, y, 1, 1, '#52648c');
  } else if (kind === 'server') {
    R(g, x0, y0, w, h, '#2b3038');
    for (let x = x0; x < x1; x += 8) R(g, x, y0, 1, h, '#232830');
    for (let y = y0; y < y1; y += 8) R(g, x0, y, w, 1, '#232830');
  } else {
    R(g, x0, y0, w, h, '#cfd6dd');
    for (let x = x0; x < x1; x += 10) R(g, x, y0, 1, h, '#bcc4cc');
    for (let y = y0; y < y1; y += 10) R(g, x0, y, w, 1, '#bcc4cc');
  }
}
function drawWall(g, o) {
  R(g, o.x, o.y, o.w, 16, o.wall);
  if (o.floor === 'parquet') {
    R(g, o.x, o.y + 11, o.w, 4, '#cdb894');
    for (const rx of o.windows) {
      const wx = o.x + rx;
      R(g, wx, o.y + 2, 22, 10, '#8a6a48'); R(g, wx + 1, o.y + 3, 20, 8, '#9ad7ff');
      R(g, wx + 10, o.y + 3, 1, 8, '#8a6a48'); R(g, wx + 4, o.y + 5, 4, 1, '#ffffff'); R(g, wx + 3, o.y + 6, 6, 1, '#ffffff');
    }
  } else if (o.floor === 'carpet') {
    if (o.poster != null) { const px = o.x + o.poster; R(g, px, o.y + 3, 12, 9, OL); R(g, px + 1, o.y + 4, 10, 7, '#e5533d'); R(g, px + 3, o.y + 6, 6, 3, '#ffd23f'); }
  } else if (o.floor === 'server') {
    R(g, o.x, o.y + 12, o.w, 2, '#2a2f38'); for (let x = o.x + 4; x < o.x + o.w; x += 9) R(g, x, o.y + 12, 3, 2, '#e5533d');
  } else {
    R(g, o.x, o.y + 13, o.w, 1, '#58e1f0');
    if (o.poster != null) { const px = o.x + o.poster; R(g, px, o.y + 3, 9, 8, '#f2c14e'); R(g, px + 4, o.y + 4, 1, 4, OL); R(g, px + 4, o.y + 9, 1, 1, OL); }
  }
  R(g, o.x, o.y + 15, o.w, 1, 'rgba(0,0,0,0.35)');
  const lw = txtW(o.name + ' · ' + o.kind) + 6;
  R(g, o.x + 5, o.y + 3, lw, 9, OL); R(g, o.x + 6, o.y + 4, lw - 2, 7, '#2a2236');
  txt(g, o.name, o.x + 8, o.y + 5, '#ffe9a8');
  txt(g, ' · ' + o.kind, o.x + 8 + txtW(o.name) + 1, o.y + 5, '#8be9fd');
}
function drawRack(g, x, y) {
  R(g, x, y, 12, 28, '#1b1e24'); R(g, x, y, 12, 1, '#3a404c');
  for (let i = 0; i < 6; i++) R(g, x + 1, y + 2 + i * 4, 10, 3, '#2f3540');
}
function drawCooler(g, x, y) {
  R(g, x + 1, y, 5, 6, '#8fd3ff'); R(g, x + 2, y + 1, 1, 4, '#c9ecff'); R(g, x, y + 6, 7, 1, '#9aa0aa');
  R(g, x, y + 7, 7, 10, '#e8e8ee'); R(g, x + 6, y + 7, 1, 10, '#b9bcc6'); R(g, x + 2, y + 9, 2, 1, '#3b7dd8');
}
function drawPlant(g, x, y) {
  R(g, x + 1, y + 7, 6, 5, '#a0522d'); R(g, x + 1, y + 7, 6, 1, '#c0703d');
  const L = '#4c8a3f', L2 = '#6fb35a';
  R(g, x + 3, y, 2, 7, L); R(g, x, y + 2, 3, 2, L2); R(g, x + 5, y + 1, 3, 2, L2); R(g, x + 1, y + 4, 2, 2, L); R(g, x + 5, y + 4, 2, 2, L);
}
function drawSofa(g, x, y) {
  R(g, x, y, 30, 5, '#7a3b4f'); R(g, x, y + 5, 30, 4, '#8f4a60'); R(g, x - 2, y + 3, 3, 7, '#6e3a4c'); R(g, x + 29, y + 3, 3, 7, '#6e3a4c');
  R(g, x + 1, y + 10, 2, 1, OL); R(g, x + 27, y + 10, 2, 1, OL);
}
function drawDeco(g, d, t) {
  const x = d.x, y = d.y;
  if (d.id === 'plant') drawPlant(g, x, y);
  else if (d.id === 'sofa') drawSofa(g, x + 2, y);
  else if (d.id === 'cooler') { drawCooler(g, x, y); const q = (t % 3) / 3; if (q < 0.5) R(g, x + 3, y + 4 - Math.round(q * 8), 1, 1, '#ffffff'); }
  else if (d.id === 'table') {
    R(g, x, y + 2, 16, 3, '#8a6a48'); R(g, x, y + 2, 16, 1, '#a8845e'); R(g, x + 1, y + 5, 2, 5, '#5a3d28'); R(g, x + 13, y + 5, 2, 5, '#5a3d28');
    R(g, x + 4, y, 3, 2, '#e8e8ee'); R(g, x + 9, y + 1, 5, 1, '#3b7dd8');
  } else if (d.id === 'shelf') {
    R(g, x, y, 12, 16, '#6b4329'); R(g, x + 1, y + 1, 10, 14, '#3e2616'); R(g, x + 1, y + 5, 10, 1, '#6b4329'); R(g, x + 1, y + 10, 10, 1, '#6b4329');
    const bc = ['#e5533d', '#3b7dd8', '#f2c14e', '#4cc38a', '#9b5de5'];
    for (let s = 0; s < 3; s++) for (let b = 0; b < 4; b++) { const h = 2 + (hash(x * 7 + s * 5 + b) % 2); R(g, x + 2 + b * 2, y + 5 * s + 5 - h, 1, h, bc[(s + b + x) % bc.length]); }
  } else if (d.id === 'lamp') {
    R(g, x + 1, y + 14, 3, 2, '#3a3346'); R(g, x + 2, y + 5, 1, 9, '#3a3346'); R(g, x, y + 1, 5, 4, '#f2c14e'); R(g, x + 1, y, 3, 1, '#f2c14e');
    g.globalAlpha = 0.25; R(g, x - 1, y + 5, 7, 2, '#fff1a8'); g.globalAlpha = 1;
  } else if (POPD[d.id]) {
    const s = POPD[d.id], fr = s.fps ? s.frames[Math.floor(t * s.fps) % s.frames.length] : s.frames[0];
    spr(g, fr, x, y, s.pal, false);
  }
}
const TREE = [[5,4],[3,8],[2,10],[1,12],[1,12],[0,14],[0,14],[1,12],[1,12],[2,10],[4,6]];
function drawTree(g, tr, S) {
  const x = tr.x, y = tr.y;
  R(g, x + 3, y + 16, 9, 2, 'rgba(0,0,0,0.25)');
  R(g, x + 5, y + 10, 4, 7, '#6b4329'); R(g, x + 5, y + 10, 1, 7, '#8a5a3a');
  if (tr.kind === 1) {
    for (let r = 0; r < 12; r++) { const half = 1 + Math.floor((r % 4) + r / 2); R(g, x + 7 - half, y + r - 1, half * 2, 1, r % 4 === 3 ? S.cd : '#2f6a3a'); }
    if (S === SEASONS.invierno) for (let r = 0; r < 12; r += 4) R(g, x + 6 - Math.floor(r / 2), y + r - 1, 2 + r, 1, '#ffffff');
    return;
  }
  TREE.forEach((q, r) => {
    R(g, x + q[0], y + r, q[1], 1, tr.kind === 2 && S !== SEASONS.invierno ? '#b5482a' : S.c);
    R(g, x + q[0] + q[1] - 2, y + r, 2, 1, S.cd);
    if (r < 5) R(g, x + q[0] + 1, y + r, 2, 1, S.ch);
  });
}
function drawWorld(w, guinos) {
  const S = w.season;
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const terrain = mk(), full = mk(), tg = terrain.getContext('2d'), g = full.getContext('2d');
  R(tg, 0, 0, W, H, '#14111b');
  R(tg, 0, GY, W, H - GY, S.g);
  for (let r = 0; r < GR; r++) for (let c = 0; c < GC; c++) {
    const h = hash(w.seed + r * 977 + c * 131);
    for (let k = 0; k < 4; k++) R(tg, c * TS + (h >> (k * 3)) % 8, GY + r * TS + (h >> (k * 3 + 12)) % 8, 1, 1, k % 2 ? S.d : S.l);
    if (h % 9 === 0) { const fc = S.fl[(h >> 5) % S.fl.length]; R(tg, c * TS + (h >> 8) % 7, GY + r * TS + (h >> 11) % 7, 1, 1, fc); R(tg, c * TS + (h >> 14) % 7, GY + r * TS + (h >> 17) % 7, 1, 1, fc); }
  }
  g.drawImage(terrain, 0, 0);
  const isP = (c, r) => c >= 0 && r >= 0 && c < GC && r < GR && w.path.has(r * GC + c);
  const plazaT = new Set(); if (w.plazaOk) for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) plazaT.add((w.plaza[1] + dr) * GC + w.plaza[0] + dc);
  w.path.forEach(k => {
    const c = k % GC, r = (k / GC) | 0, x = c * TS, y = GY + r * TS, h = hash(k * 31 + w.seed);
    if (plazaT.has(k)) { R(g, x, y, 8, 8, '#b9b2a6'); R(g, x, y, 8, 1, '#a39c90'); R(g, x, y, 1, 8, '#a39c90'); R(g, x + 3 + h % 3, y + 3, 1, 1, '#d6d0c4'); return; }
    R(g, x, y, 8, 8, S === SEASONS.invierno ? '#b8b0a2' : '#c8b48a');
    if (!isP(c, r - 1)) R(g, x, y, 8, 1, '#a8946a');
    if (!isP(c, r + 1)) R(g, x, y + 7, 8, 1, '#a8946a');
    if (!isP(c - 1, r)) R(g, x, y, 1, 8, '#a8946a');
    if (!isP(c + 1, r)) R(g, x + 7, y, 1, 8, '#a8946a');
    R(g, x + 1 + h % 5, y + 2 + (h >> 4) % 4, 1, 1, '#b5a078'); R(g, x + 2 + (h >> 7) % 4, y + 1 + (h >> 10) % 5, 1, 1, '#d8c8a0');
  });
  w.offices.forEach((o, oi) => {
    const mine = (c, r) => c >= 0 && r >= 0 && c < GC && r < GR && w.own[r][c] === oi;
    const tiles = []; for (let r = 0; r < GR; r++) for (let c = 0; c < GC; c++) if (w.own[r][c] === oi) tiles.push([c, r]);
    tiles.forEach(q => { const x = q[0] * TS, y = GY + q[1] * TS; if (!mine(q[0], q[1] + 1)) R(g, x + 2, y + 8, 8, 3, 'rgba(0,0,0,0.28)'); if (!mine(q[0] + 1, q[1])) R(g, x + 8, y + 3, 2, 8, 'rgba(0,0,0,0.28)'); });
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    tiles.forEach(q => { x0 = Math.min(x0, q[0] * TS); y0 = Math.min(y0, GY + q[1] * TS); x1 = Math.max(x1, q[0] * TS + TS); y1 = Math.max(y1, GY + q[1] * TS + TS); });
    g.save(); g.beginPath(); tiles.forEach(q => g.rect(q[0] * TS, GY + q[1] * TS, TS, TS)); g.clip();
    drawFloorPattern(g, o.floor, x0, y0, x1 - x0, y1 - y0);
    g.restore();
    drawWall(g, o);
    tiles.forEach(q => {
      const x = q[0] * TS, y = GY + q[1] * TS, hall = q[0] >= o.tx && q[0] < o.tx + o.tw && q[1] < o.ty + 2 && q[1] >= o.ty;
      if (!hall && !mine(q[0], q[1] - 1)) { R(g, x, y, 8, 7, o.wall); R(g, x, y + 6, 8, 1, 'rgba(0,0,0,0.35)'); }
      if (o.floor === 'lab' && !mine(q[0], q[1] + 1)) for (let rr = 5; rr < 8; rr++) for (let xx = 0; xx < 8; xx++) R(g, x + xx, y + rr, 1, 1, ((x + xx + rr) >> 2) & 1 ? '#f2c14e' : OL);
    });
    tiles.forEach(q => {
      const x = q[0] * TS, y = GY + q[1] * TS;
      if (!mine(q[0], q[1] - 1)) R(g, x, y, 8, 1, '#05030a');
      if (!mine(q[0], q[1] + 1)) R(g, x, y + 7, 8, 1, '#05030a');
      if (!mine(q[0] - 1, q[1])) R(g, x, y, 1, 8, '#05030a');
      if (!mine(q[0] + 1, q[1])) R(g, x + 7, y, 1, 8, '#05030a');
    });
    for (let i = 0; i < o.racks; i++) drawRack(g, o.x + 6 + i * 16, o.y + 20);
    if (o.pods) { R(g, o.x + 184, o.podY - 4, 46, 44, '#1f2a33'); R(g, o.x + 184, o.podY - 4, 46, 1, '#58e1f0'); R(g, o.x + 184, o.podY + 39, 46, 1, '#0f151a'); }
    const gx = o.x + o.w - 24;
    R(g, gx + 1, o.y + 57, 9, 2, '#3a3346');
    R(g, gx - 2, o.y + 81, 19, 3, '#3a3346'); R(g, gx - 2, o.y + 81, 19, 1, '#4d4459');
    txt(g, 'CARGA', gx - 3, o.y + 19, '#8a8399');
  });
  w.bushes.forEach(b => { R(g, b.x, b.y + 1, 8, 4, S.cd); R(g, b.x + 1, b.y, 6, 4, S.c); R(g, b.x + 2, b.y, 2, 1, S.ch); R(g, b.x + 1, b.y + 5, 6, 1, 'rgba(0,0,0,0.25)'); });
  w.trees.slice().sort((a, b) => a.y - b.y).forEach(tr => drawTree(g, tr, S));
  w.terrain = terrain; w.full = full;
}
function drawConstruction(g, w) {
  g.drawImage(w.terrain, 0, 0);
  const tb = w.tb;
  for (const rv of w.reveal) {
    if (rv.time > tb) continue;
    g.drawImage(w.full, rv.x, rv.y, rv.w, rv.h, rv.x, rv.y, rv.w, rv.h);
    const a = tb - rv.time;
    if (a < 0.15) {
      g.globalAlpha = 1 - a / 0.15;
      R(g, rv.x, rv.y, rv.w, 1, '#ffffff'); R(g, rv.x, rv.y + rv.h - 1, rv.w, 1, '#ffffff'); R(g, rv.x, rv.y, 1, rv.h, '#ffffff'); R(g, rv.x + rv.w - 1, rv.y, 1, rv.h, '#ffffff');
      g.globalAlpha = 1;
    }
  }
}
function drawBuilder(g, x, y, p, t) {
  x = Math.round(x); y = Math.round(y);
  const up = Math.floor(t * 10) % 2;
  drawChar(g, x, y, p, { view:'F', legs:up ? 0 : 1, hair:0, acc:'builder' });
  const hx = x + 9;
  if (up) { R(g, hx, y + 4, 1, 5, '#8a5a3a'); R(g, hx - 1, y + 2, 3, 2, '#8f96a3'); }
  else { R(g, hx, y + 9, 3, 1, '#8a5a3a'); R(g, hx + 2, y + 9, 2, 3, '#8f96a3'); R(g, hx + 4, y + 12, 1, 1, '#ffd23f'); R(g, hx + 3, y + 13, 1, 1, '#fff6c9'); R(g, hx + 5, y + 11, 1, 1, '#fff6c9'); }
}
function drawBuilders(g, w, t) {
  const tb = w.tb;
  w.offices.forEach((o, oi) => {
    const s = o.buildStart, D = o.buildDur, N = o.order.length;
    if (tb < s - 0.3 || tb > s + D + 0.6) return;
    for (let b = 0; b < 2; b++) {
      const fi = Math.max(0, Math.min(N - 1, (tb - s) / D * N));
      let i = Math.floor(fi); if (i % 2 !== b) i = Math.max(0, i - 1);
      const j = Math.min(N - 1, i + 2), f = Math.max(0, Math.min(1, (fi - i) / 2));
      const A = o.order[i], B = o.order[j];
      const x = A[0] * TS + 4 + (B[0] - A[0]) * TS * f - 5, y = GY + A[1] * TS + 4 + (B[1] - A[1]) * TS * f - 13;
      const p = palFor('builder', 30 + oi * 2 + b);
      if (tb < s) { drawPoof(g, x + 5, y + 8, (tb - s + 0.3) / 0.3); continue; }
      if (tb > s + D) { const q = (tb - s - D) / 0.6; if (q < 0.5) drawBuilder(g, x, y, p, t + b * 0.3); drawPoof(g, x + 5, y + 8, q); continue; }
      drawBuilder(g, x, y, p, t + b * 0.3);
    }
  });
}

// ---------- gags & emojis ----------
function gagNow(t, opt, cand) {
  const ids = Object.keys(POPG);
  if (opt.gag === 'ninguno' || !ids.length || !cand.length) return null;
  const F = Math.max(2, opt.freq || 6), k = Math.floor(t / F), lt = t - k * F;
  const id = POPG[opt.gag] ? opt.gag : ids[hash(k * 7 + 3) % ids.length], gg = POPG[id];
  if (lt > gg.dur) return null;
  return { agent:cand[hash(k * 13 + 1) % cand.length], id, p:lt / gg.dur };
}
function emojiNow(t, opt, cand) {
  const ids = Object.keys(POPE);
  if (!opt.emojis || !ids.length || !cand.length) return null;
  const F = Math.max(2, (opt.freq || 6) * 0.6), tt = t + F * 0.5, k = Math.floor(tt / F), lt = tt - k * F, dur = 1.6;
  if (lt > dur) return null;
  return { agent:cand[hash(k * 29 + 5) % cand.length], id:ids[hash(k * 3 + 11) % ids.length], p:lt / dur };
}
function drawEmojiThrow(g, cx, cy, id, p, t) {
  const e = POPE[id]; if (!e) return;
  const fr = e.fps ? e.frames[Math.floor(t * e.fps) % e.frames.length] : e.frames[0];
  if (p > 0.7) g.globalAlpha = Math.max(0, (1 - p) / 0.3);
  spr(g, fr, Math.round(cx + 1 + p * 8), Math.round(cy - 6 - Math.sin(p * Math.PI) * 12 - p * 4), e.pal, false);
  g.globalAlpha = 1;
}
function seatExtras(a, gag, emo, p) {
  const ex = {};
  if (gag && gag.agent === a && POPG[gag.id].pose) { try { Object.assign(ex, POPG[gag.id].pose(gag.p) || {}); } catch (e) {} }
  if (emo && emo.agent === a && emo.p < 0.2) ex.arms = 'up';
  return ex;
}
function drawSeatFx(g, a, o, gag, emo, t) {
  const cx = a.dx + 2, cy = o.deskY - 10;
  if (gag && gag.agent === a) { try { POPG[gag.id].draw(g, cx, cy, gag.p, t); } catch (e) {} }
  if (emo && emo.agent === a) drawEmojiThrow(g, cx, cy, emo.id, emo.p, t);
}

const POD_CYCLE = [['empty', 3], ['beamIn', 1], ['matIn', 1.8], ['run', 12], ['matOut', 1.8], ['beamOut', 0.8], ['empty', 2]];
// -> [state, fx]
function podState(pod, opt, t) {
  if (opt.kindling !== 'mixto') return [{ normal:'run', incendio:'fire', congelado:'frozen', muerto:'dead' }[opt.kindling] || pod.st, {}];
  if (!pod.cycle) return [pod.st, {}];
  const T = segTotal(POD_CYCLE), ph = phaseAt(POD_CYCLE, (t + 4) % T);
  if (ph.name === 'beamIn') return ['empty', { beam:ph.p }];
  if (ph.name === 'beamOut') return ['empty', { beam:1 - ph.p }];
  if (ph.name === 'matIn') return ['run', { mat:ph.p }];
  if (ph.name === 'matOut') return ['run', { mat:1 - ph.p }];
  return [ph.name, {}];
}
function zoneRect(o, z, extraDx) {
  const xs = z.ids.map(i => o.agents[i].dx).concat(extraDx != null ? [extraDx] : []);
  const rx = Math.min.apply(null, xs) - 5;
  return { rx, rw:Math.max.apply(null, xs) + 29 - rx, ry:o.deskY - 26 };
}
const POOF = [['none', 3], ['poofIn', 0.7], ['minis', 9], ['poofOut', 0.7], ['none', 4.6]];
function convoState(o, t) {
  if (!o.convos || !o.convos.length) return null;
  const P = 16, k = Math.floor((t + o.x * 0.05) / P), lt = (t + o.x * 0.05) - k * P;
  const pair = o.convos[k % o.convos.length], A = o.agents[pair[0]], B = o.agents[pair[1]];
  const ax = A.dx + 3, bx = B.dx + 3, wt = Math.abs(bx - ax) / 22, talk = 4.5;
  const dir = bx > ax ? 1 : -1;
  if (lt < 0.4) return { A, B, phase:'stand', x:ax };
  if (lt < 0.4 + wt) return { A, B, phase:'walk', x:ax + (bx - ax) * ((lt - 0.4) / wt), dir };
  if (lt < 0.4 + wt + talk) return { A, B, phase:'talk', x:bx, lt:lt - 0.4 - wt };
  if (lt < 0.4 + 2 * wt + talk) return { A, B, phase:'walk', x:bx + (ax - bx) * ((lt - 0.4 - wt - talk) / wt), dir:-dir };
  return null;
}

function drawDynamic(g, t, opt, w) {
  const tb = w.tb, offices = w.offices;
  R(g, 0, 0, W, GY, '#14111b');
  for (let x = 0; x < W; x += 2) R(g, x, GY - 1, 1, 1, '#2a2236');
  txt(g, 'PIXELAGENTS', 8, 6, '#ffe9a8', 2);
  let lx = 106;
  ['personal', 'work', 'plus'].forEach((acc, i) => {
    drawChar(g, lx, 6, palFor(acc, i * 5 + 2), { view:'F', face:((t + i) % 3) < 0.12 ? 'blink' : null, legs:null, hair:acc === 'plus' ? 1 : i, acc });
    txt(g, ACC[acc].name, lx + 13, 11, ACC[acc].B);
    lx += 14 + txtW(ACC[acc].name) + 8;
  });
  txt(g, w.day.label, lx + 6, 11, '#b3abc4');
  let total = 0;
  offices.forEach((o, oi) => { o.now = o.spend + Math.floor((t + oi * 0.7) / 2.2) * 0.07; total += o.now; });
  const tt = 'HOY $' + total.toFixed(2);
  coin(g, W - 14 - txtW(tt), 8); txt(g, tt, W - 8 - txtW(tt), 9, '#f5c542');

  if (tb >= w.buildEnd) w.outdoor.forEach(d => drawDeco(g, d, t));
  const cand = [];
  offices.forEach(o => { if (o.agents && tb >= o.doneAt) o.agents.forEach(a => { if (a.st !== 'sleep') cand.push(a); }); });
  const gag = gagNow(t, opt, cand), emo = emojiNow(t, opt, cand);
  const counts = { run:0, fire:0, frozen:0, dead:0 };

  offices.forEach((o, oi) => {
    if (tb < o.doneAt) return;
    const fresh = tb - o.doneAt;
    o.wallDeco.forEach(d => drawDeco(g, d, t));
    o.decor.forEach(d => drawDeco(g, d, t));
    if (o.agents) {
      const cv = convoState(o, t), v = o.visitor, vs = v ? visitorState(o, v, t) : null;
      o.zones.forEach(z => {
        const r = zoneRect(o, z, null), zi = o.zones.indexOf(z);
        let rw = r.rw;
        if (vs && v.zone === zi) rw += Math.round((zoneRect(o, z, v.slotDx).rw - r.rw) * Math.min(1, vs.desk * 1.5));
        drawRug(g, r.rx, r.ry, rw, RUGS[strHash(z.repo) % RUGS.length], z.repo, 1);
      });
      if (vs && v.newZone && vs.rug > 0) drawRug(g, v.slotDx - 5, o.deskY - 26, 34, RUGS[strHash(v.newZone) % RUGS.length], v.newZone, vs.rug);
      drawDoor(g, o.x + o.door, o.y, vs ? vs.door : false, vs ? vs.ding : 0);
      o.agents.forEach(a => drawChair(g, a.dx + 2, o.deskY));
      if (vs && vs.desk > 0.3) drawChair(g, v.slotDx + 2, o.deskY);
      const vp = v ? palFor(v.acc, v.seed) : null, item = v ? ITEM[v.acc] : null;
      if (vs && vs.walker) {
        const wk = vs.walker;
        if (wk.alpha != null) g.globalAlpha = Math.max(0, wk.alpha);
        drawChar(g, wk.x, wk.y, vp, { view:wk.view, flip:wk.flip, legs:wk.legs, hair:v.hair, acc:v.acc, hand:wk.hand });
        drawItem(g, wk.x, wk.y, item, wk.view, wk.flip, wk.hand, t);
        g.globalAlpha = 1;
      }
      o.agents.forEach(a => drawDesk(g, a.dx, o.deskY));
      if (vs) drawDeskBuilt(g, v.slotDx, o.deskY, vs.desk, t, v.seed);
      const greet = vs && vs.ph.name === 'greet' ? vs.ph.tin : -1;
      const neighbours = vs && v.zone != null ? o.zones[v.zone].ids : [];
      o.agents.forEach((a, ai) => {
        if (cv && cv.A === a && cv.phase !== 'stand') { drawMonitor(g, a.dx + 13, o.deskY - 9, 'off', t, a.seed); return; }
        if (cv && cv.A === a) return;
        const talking = cv && cv.B === a && cv.phase === 'talk';
        const speaking = talking && Math.floor(cv.lt / 0.9) % 2 === 1;
        const ex = seatExtras(a, gag, emo);
        if (greet > 1.2 && neighbours.indexOf(ai) >= 0) { ex.say = 'HOLA'; ex.wave = true; }
        drawSeat(g, a.dx, o.deskY, a, talking ? 'talk' : a.st, t, speaking, ex);
        drawSeatFx(g, a, o, gag, emo, t);
        if (a.minis) drawMinis(g, a.dx + 1, o.deskY + 14, a, a.minis, t);
        if (a.poof) {
          const ph = phaseAt(POOF, (t + oi * 3) % segTotal(POOF)), mx = a.dx + 1, my = o.deskY + 14;
          const show = ph.name === 'minis' || (ph.name === 'poofIn' && ph.p > 0.5) || (ph.name === 'poofOut' && ph.p < 0.5);
          if (show) drawMinis(g, mx, my, a, a.poof, t);
          if (ph.name === 'poofIn' || ph.name === 'poofOut') for (let i = 0; i < a.poof; i++) drawPoof(g, mx + i * 8 + 3, my + 4, ph.p);
        }
      });
      if (vs && vs.seated) {
        const n = vs.ph.name, ex = { item };
        if (n === 'greet' && vs.ph.tin < 1.4) ex.say = 'HOLA';
        if (n === 'wave') { ex.say = 'CHAO'; ex.wave = true; }
        drawSeat(g, v.slotDx, o.deskY, v, 'work', t, false, ex);
      } else if (vs && vs.desk >= 1) drawMonitor(g, v.slotDx + 13, o.deskY - 9, 'off', t, v.seed);
      if (cv) {
        const a = cv.A, p = palFor(a.acc, a.seed), wy = o.deskY + 8;
        R(g, Math.round(cv.x) + 2, wy + 14, 7, 1, 'rgba(0,0,0,0.3)');
        if (cv.phase === 'walk') {
          const f = [1, 0, 2, 0][Math.floor(t * 8) % 4];
          drawChar(g, cv.x, wy, p, { view:'S', flip:cv.dir < 0, legs:f, hair:a.hair, acc:a.acc, hand:f === 1 ? 1 : 0 });
        } else {
          const speaking = cv.phase === 'talk' && Math.floor(cv.lt / 0.9) % 2 === 0;
          drawChar(g, cv.x, wy, p, { view:'F', face:speaking && Math.floor(t * 8) % 2 ? 'talk' : null, legs:0, hair:a.hair, acc:a.acc });
          if (speaking) talkBubble(g, Math.round(cv.x) + 7, wy - 8, t + 3);
        }
      }
      if (fresh < 0.6) o.agents.forEach(a => drawPoof(g, a.dx + 12, o.deskY - 2, fresh / 0.6));
    } else {
      drawDoor(g, o.x + o.door, o.y, false, 0);
    }
    for (let i = 0; i < o.racks; i++) for (let j = 0; j < 6; j++) {
      const rx = o.x + 6 + i * 16, ry = o.y + 23 + j * 4, on = hash(i * 13 + j * 7 + Math.floor(t * 3)) % 3 !== 0;
      R(g, rx + 2, ry, 1, 1, on ? (j % 3 ? '#5dff9b' : '#ffb84d') : '#1b3a26');
      R(g, rx + 4, ry, 1, 1, hash(i + j * 5 + Math.floor(t * 5)) % 2 ? '#5dff9b' : '#1b3a26');
    }
    if (o.pods) {
      o.pods.forEach((pod, i) => {
        const ps = podState(pod, opt, t), st = ps[0], px = o.x + 10 + i * 30;
        if (counts[st] != null) counts[st]++;
        drawPod(g, px, o.podY, pod, st, t, ps[1]);
        txt(g, pod.name, px + Math.round((22 - txtW(pod.name)) / 2), o.podY + 33, '#cfd6de');
        if (fresh < 0.6) drawPoof(g, px + 11, o.podY + 14, fresh / 0.6);
      });
      txt(g, 'MICROVMS', o.x + 188, o.podY, '#58e1f0');
      [['VIVAS', counts.run, '#5dff9b'], ['FUEGO', counts.fire, '#ff9a5c'], ['HIELO', counts.frozen, '#9fdcff'], ['RIP', counts.dead, '#a9aeb7']]
        .forEach((r, i) => { R(g, o.x + 188, o.podY + 9 + i * 7, 3, 3, r[2]); txt(g, r[0] + ' ' + r[1], o.x + 194, o.podY + 8 + i * 7, '#e6e2ee'); });
      txt(g, STRAT_NAME[o.strategy] || '', o.x + 188, o.podY + 36, '#5b7080');
    }
    const gx = o.x + o.w - 24, lvl = Math.max(1, Math.min(99, Math.round(o.load + Math.sin(t * 0.7 + oi) * 4)));
    drawThermo(g, gx + 4, o.y + 26, lvl);
    if (lvl >= 80) for (let i = 0; i < 2; i++) { const q = (t + i * 0.5) % 1; g.globalAlpha = 1 - q; R(g, gx + 6 + i * 2, o.y + 24 - Math.round(q * 6), 1, 1, '#ffffff'); g.globalAlpha = 1; }
    txt(g, lvl + '%', gx + 6 - Math.round(txtW(lvl + '%') / 2), o.y + 61, lvl < 50 ? '#4cc38a' : lvl < 80 ? '#f2c14e' : '#e5533d');
    drawPig(g, gx, o.y + 72, t, oi * 0.7);
    const s = '$' + o.now.toFixed(2);
    txt(g, s, gx + 7 - Math.round(txtW(s) / 2), o.y + 87, '#f5c542');
    if (fresh < 0.6) drawPoof(g, gx + 6, o.y + 50, fresh / 0.6);
  });
  if (tb < w.buildEnd) drawBuilders(g, w, t);
}

// ---------- character sheet ----------
function drawSheet(g, t, opt) {
  R(g, 0, 0, SW, SH, '#1c1726');
  const cols = ['TRABAJA', 'PIENSA', 'ESPERA', 'DUERME', 'CAMINA', 'HABLA', 'SUBAGENTES'];
  cols.forEach((c, i) => txt(g, c, 70 + i * 58 + 12 - Math.round(txtW(c) / 2), 4, '#8a8399'));
  for (let x = 4; x < SW - 4; x += 2) R(g, x, 12, 1, 1, '#2a2236');
  ['personal', 'work', 'plus'].forEach((acc, r) => {
    const y = 18 + r * 38, seed = r * 5 + 2, ag = { acc, seed, hair:acc === 'plus' ? 1 : r };
    const p = palFor(acc, seed);
    txt(g, ACC[acc].name, 6, y + 10, ACC[acc].B); txt(g, ACC[acc].tag, 6, y + 18, '#8a8399');
    const dy = y + 24;
    ['work', 'think', 'wait', 'sleep'].forEach((st, i) => {
      const dx = 70 + i * 58;
      drawChair(g, dx + 2, dy); drawDesk(g, dx, dy); drawSeat(g, dx, dy, ag, st, t + i, false);
    });
    const wx = 70 + 4 * 58 + 7, f = [1, 0, 2, 0][Math.floor(t * 8) % 4];
    R(g, wx + 2, y + 24, 7, 1, 'rgba(0,0,0,0.3)');
    drawChar(g, wx, y + 10, p, { view:'S', legs:f, hair:ag.hair, acc, hand:f === 1 ? 1 : 0 });
    drawItem(g, wx, y + 10, ITEM[acc], 'S', false, f === 1 ? 1 : 0, t);
    const hx = 70 + 5 * 58, turn = Math.floor(t / 0.9) % 2;
    const p2 = palFor(acc, seed + 1);
    drawChar(g, hx, y + 10, p, { view:'F', face:turn === 0 && Math.floor(t * 8) % 2 ? 'talk' : null, legs:0, hair:ag.hair, acc });
    drawChar(g, hx + 13, y + 10, p2, { view:'F', face:turn === 1 && Math.floor(t * 8) % 2 ? 'talk' : null, legs:0, hair:(ag.hair + 1) % 2, acc });
    R(g, hx + 2, y + 24, 21, 1, 'rgba(0,0,0,0.3)');
    talkBubble(g, turn === 0 ? hx + 6 : hx + 19, y + 1, t);
    const sx = 70 + 6 * 58;
    drawChair(g, sx + 2, dy); drawDesk(g, sx, dy); drawSeat(g, sx, dy, ag, 'work', t + 2, false);
    drawMinis(g, sx + 26, dy + 1, ag, 2, t);
  });
  const ky = 148;
  txt(g, 'KINDLING', 6, ky + 10, '#58e1f0'); txt(g, 'MICROVMS', 6, ky + 18, '#8a8399');
  [['run', 'NORMAL'], ['fire', 'INCENDIO'], ['frozen', 'CONGELADO'], ['dead', 'MUERTO']].forEach((s, i) => {
    const px = 70 + i * 58 + 1;
    drawPod(g, px, ky, { acc:['work', 'personal', 'work', 'plus'][i], seed:20 + i, hair:i % 2 }, s[0], t + i);
    txt(g, s[1], px + 11 - Math.round(txtW(s[1]) / 2), ky + 33, '#cfd6de');
  });
  [25, 65, 92].forEach((l, i) => {
    const x = 316 + i * 26;
    drawThermo(g, x, ky - 2, l);
    txt(g, l + '%', x + 2 - Math.round(txtW(l + '%') / 2), ky + 33, l < 50 ? '#4cc38a' : l < 80 ? '#f2c14e' : '#e5533d');
  });
  txt(g, 'CARGA', 318, ky - 10, '#8a8399');
  drawPig(g, 404, ky + 14, t, 0);
  txt(g, 'GASTO', 402, ky - 10, '#8a8399');
  txt(g, '$' + (12 + Math.floor(t / 2.2) * 0.07).toFixed(2), 401, ky + 33, '#f5c542');
  // builders, gags, emojis and pop decor
  const oy = 198;
  for (let x = 4; x < SW - 4; x += 2) R(g, x, oy - 4, 1, 1, '#2a2236');
  txt(g, 'OBRAS', 6, oy + 10, '#ffd23f'); txt(g, 'Y GUINOS', 6, oy + 18, '#8a8399');
  const placed = Math.floor(t * 3) % 5;
  for (let i = 0; i < 4; i++) if (i < placed) { drawFloorPattern(g, 'parquet', 64 + i * 8, oy + 26, 8, 8); if (i === placed - 1) { R(g, 64 + i * 8, oy + 26, 8, 1, '#ffffff'); R(g, 64 + i * 8, oy + 33, 8, 1, '#ffffff'); } }
  drawBuilder(g, 62 + Math.min(3, placed) * 8, oy + 12, palFor('builder', 31), t);
  const gids = Object.keys(POPG);
  if (gids.length) {
    const slot = 2.6, cyc = t % (gids.length * slot), k = Math.floor(cyc / slot), gg = POPG[gids[k]], p = Math.min(1, (cyc - k * slot) / gg.dur);
    const dx = 122, dy = oy + 36, ag = { acc:['personal', 'work', 'plus'][k % 3], seed:40 + k, hair:k % 2 };
    let ex = {}; if (gg.pose) { try { ex = gg.pose(p) || {}; } catch (e) {} }
    drawChair(g, dx + 2, dy); drawDesk(g, dx, dy); drawSeat(g, dx, dy, ag, 'work', t, false, ex);
    try { gg.draw(g, dx + 2, dy - 10, p, t); } catch (e) {}
    const nm = plain(gg.name || gids[k]);
    txt(g, nm, dx + 12 - Math.round(txtW(nm) / 2), dy + 14, '#cfd6de');
  }
  let x = 176;
  for (const id of Object.keys(POPD)) {
    const d = POPD[id]; if (x + d.w > SW - 4) break;
    drawDeco(g, { id, x, y:oy + 36 - d.h }, t); x += d.w + 5;
  }
  x = 176;
  for (const id of Object.keys(POPE)) {
    if (x + 9 > SW - 4) break;
    const e = POPE[id], fr = e.fps ? e.frames[Math.floor(t * e.fps) % e.frames.length] : e.frames[0];
    spr(g, fr, x, oy + 42 + (Math.floor(t * 2 + x) % 2), e.pal, false); x += 13;
  }
}

function startPixelOffice(mapCv, sheetCv, getOpts) {
  const g = mapCv.getContext('2d'), s = sheetCv.getContext('2d');
  g.imageSmoothingEnabled = false; s.imageSmoothingEnabled = false;
  let last = performance.now(), t = 0, raf = 0, stop = false, world = null, wkey = '';
  function frame(now) {
    if (stop) return;
    const o = getOpts();
    t += Math.min(0.1, (now - last) / 1000) * (o.speed || 1); last = now;
    const day = dayInfo(o.dia), key = day.key + (o.guinos ? ':g' : '');
    if (key !== wkey) { wkey = key; world = buildWorld(day, o.guinos); drawWorld(world, o.guinos); world.t0 = t; }
    world.tb = t - world.t0;
    g.clearRect(0, 0, W, H);
    if (world.tb < world.buildEnd) drawConstruction(g, world); else g.drawImage(world.full, 0, 0);
    drawDynamic(g, t, o, world);
    drawSheet(s, t, o);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => { stop = true; cancelAnimationFrame(raf); };
}

class Component extends DCLogic {
  renderVals() {
    if (!this._refs) {
      this._refs = {
        map: (el) => { if (el) this._map = el; this.boot(); },
        sheet: (el) => { if (el) this._sheet = el; this.boot(); }
      };
    }
    return { mapRef: this._refs.map, sheetRef: this._refs.sheet };
  }
  componentDidMount() {
    setTimeout(() => {
      if (!this._map) this._map = document.querySelector('canvas[data-px="map"]');
      if (!this._sheet) this._sheet = document.querySelector('canvas[data-px="sheet"]');
      this.boot();
    }, 0);
  }
  componentWillUnmount() { if (this._stop) this._stop(); this._stop = null; }
  boot() {
    if (this._stop || !this._map || !this._sheet || !this._map.getContext) return;
    this._stop = startPixelOffice(this._map, this._sheet, () => ({
      speed: Number(this.props.velocidad ?? 1),
      kindling: this.props.kindling ?? 'mixto',
      dia: Number(this.props.dia ?? 0),
      guinos: this.props.guinos ?? true,
      gag: this.props.gag ?? 'aleatorio',
      emojis: this.props.emojis ?? true,
      freq: Number(this.props.frecuencia ?? 6)
    }));
  }
}
