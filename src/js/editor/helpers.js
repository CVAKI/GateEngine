/* Editor / helpers: small shared pieces (grid snap, wire routing, hop paths). Loaded first; everything lives in EditorKit. */
const EditorKit = (function () {
  'use strict';
  const G = GateDefs.GRID;
  const snap = (v) => Math.round(v / G) * G;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function route(x1, y1, x2, y2) {
    if (x2 >= x1 + 20) {
      const mx = Math.round((x1 + x2) / 2 / G) * G;
      return `M${x1},${y1}H${mx}V${y2}H${x2}`;
    }
    const ox = x1 + 10, ix = x2 - 10;
    const my = y1 === y2 ? y1 + 30 : Math.round((y1 + y2) / 2 / G) * G;
    return `M${x1},${y1}H${ox}V${my}H${ix}V${y2}H${x2}`;
  }

  // same routes as point lists (used to find where wires cross, so the crossing wire can hop over the other)
  function routePts(x1, y1, x2, y2) {
    if (x2 >= x1 + 20) { const mx = Math.round((x1 + x2) / 2 / G) * G; return [{ x: x1, y: y1 }, { x: mx, y: y1 }, { x: mx, y: y2 }, { x: x2, y: y2 }]; }
    const ox = x1 + 10, ix = x2 - 10, my = y1 === y2 ? y1 + 30 : Math.round((y1 + y2) / 2 / G) * G;
    return [{ x: x1, y: y1 }, { x: ox, y: y1 }, { x: ox, y: my }, { x: ix, y: my }, { x: ix, y: y2 }, { x: x2, y: y2 }];
  }
  // Path through user-placed bends. Missing elbows are added so a wire stays orthogonal even after
  // one of its parts was moved: first leg horizontal, last leg horizontal into the pin.
  function orthoPts(a, pts, b) {
    const all = [a].concat(pts, [b]), out = [a];
    for (let k = 1; k < all.length; k++) {
      const p = out[out.length - 1], q = all[k];
      if (p.x !== q.x && p.y !== q.y) out.push(k === all.length - 1 ? { x: p.x, y: q.y } : { x: q.x, y: p.y });
      out.push(q);
    }
    return out;
  }
  function orthoPath(a, pts, b) { return 'M' + orthoPts(a, pts, b).map((p) => p.x + ',' + p.y).join('L'); }
  // Wire path with a small hump wherever a horizontal run crosses a vertical run of a DIFFERENT signal.
  // `verts` = every vertical run on the plate: {x, y1, y2, wi (wire index), fk (signal)}.
  function hopPath(pts, wi, fk, r, verts) {
    let d = 'M' + pts[0].x + ',' + pts[0].y;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      if (p.y === q.y && p.x !== q.x) {
        const dir = q.x > p.x ? 1 : -1, lo = Math.min(p.x, q.x) + r + 2, hi = Math.max(p.x, q.x) - r - 2, hops = [];
        for (const v of verts) if (v.wi !== wi && v.fk !== fk && v.x > lo && v.x < hi && v.y1 < p.y && v.y2 > p.y) hops.push(v.x);
        hops.sort((a, b) => (a - b) * dir);
        let last = null;
        for (const x of hops) {
          if (last !== null && Math.abs(x - last) < 2 * r + 3) continue;   // two crossings too close for two humps: keep one
          d += `L${x - r * dir},${p.y}A${r},${r} 0 0 ${dir > 0 ? 1 : 0} ${x + r * dir},${p.y}`; last = x;
        }
      }
      d += 'L' + q.x + ',' + q.y;
    }
    return d;
  }
  // drop repeated points and points in the middle of a straight run
  function simplify(pts) {
    const a = [];
    for (const p of pts) { const l = a[a.length - 1]; if (!l || l.x !== p.x || l.y !== p.y) a.push(p); }
    const o = [];
    for (let i = 0; i < a.length; i++) {
      const p = a[i], l = o[o.length - 1], n = a[i + 1];
      if (l && n && ((l.x === p.x && p.x === n.x) || (l.y === p.y && p.y === n.y))) continue;
      o.push(p);
    }
    return o;
  }
  const pathOf = (pts) => 'M' + pts.map((p) => p.x + ',' + p.y).join('L');

  // parts whose name becomes the pin name when the plate is used as a chip (double-click to rename)
  const NAMEABLE = ['INPUT', 'OUTPUT', 'BUS_IN', 'BUS_OUT', 'BUTTON', 'CLOCK', 'PROBE'];

  // add methods to the Editor class (getters included)
  function mix(cls, methods) { Object.defineProperties(cls.prototype, Object.getOwnPropertyDescriptors(methods)); }

  return { G, snap, clamp, esc, route, routePts, orthoPts, orthoPath, hopPath, simplify, pathOf, NAMEABLE, mix };
})();
