const fs = require('fs');
const s = fs.readFileSync(__dirname + '/prototype.html', 'utf8');
const js = s.split('class DCLogic{}')[1].split('window.__o=')[0];
const api = new Function('class DCLogic{}\n' + js + '\nreturn { buildWorld, dayInfo, GC, GR, TS, GY };')();
const strat = {}; let fails = 0, ms = 0;
for (let d = -30; d < 30; d++) {
  const day = api.dayInfo(d), t0 = Date.now(), w = api.buildWorld(day, true); ms = Math.max(ms, Date.now() - t0);
  const errs = [];
  w.offices.forEach((o, oi) => {
    strat[o.strategy] = (strat[o.strategy] || 0) + 1;
    if (o.x < 0 || o.x + o.w > 480 || o.y < 24 || o.y + o.h > 328) errs.push(o.name + ' fuera del mapa');
    // hall must stay complete except the bottom row (mordida)
    for (let r = o.ty; r < o.ty + o.th - 1; r++) for (let c = o.tx; c < o.tx + o.tw; c++) if (w.own[r][c] !== oi) errs.push(o.name + ' sala rota ' + c + ',' + r);
    const k = o.doorTile[1] * api.GC + o.doorTile[0];
    if (!w.path.has(k)) errs.push(o.name + ' puerta sin camino');
    if (o.order.length < o.tw * (o.th - 1)) errs.push(o.name + ' orden de obra corto');
    (o.decor || []).forEach(dd => { if (dd.y < o.y) errs.push(o.name + ' deco por encima'); });
  });
  if (errs.length) { fails++; console.log(day.key, [...new Set(errs)].slice(0, 4).join(' | ')); }
}
console.log('dias con fallos:', fails, '/ 60 · estrategias:', JSON.stringify(strat), '· max ms:', ms);
