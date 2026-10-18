/* Netlist compiler + simulator.
 * compile(plate, lib) flattens a plate (and every plate nested inside it) into a flat netlist:
 *   { netCount, gates:[{type, ins:[net], out:net}], sources:[...], topNets (pin key -> net), errors }
 * That flat netlist is the intermediate form the future binary / GPU backend will consume.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./gates.js'));
  else root.GateSim = factory(root.GateDefs);
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';
  const SOURCE_TYPES = ['CONST0', 'CONST1', 'BUTTON', 'CLOCK'];

  function compile(rootPlate, lib) {
    const parent = [], ids = new Map(), errors = [], rawGates = [], rawSources = [], rawScreens = [], rawMems = [], pinRaw = [];
    const idf = (k) => { let v = ids.get(k); if (v === undefined) { v = parent.length; parent.push(v); ids.set(k, v); } return v; };
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
    let widthErr = false;

    function walk(plate, path, stack, depth) {
      const byId = new Map(plate.nodes.map((n) => [n.id, n]));
      const descs = new Map(plate.nodes.map((n) => [n.id, D.describe(n, lib)]));
      // Raw net ids of one pin. A bus pin (bits > 1) has one net per bit.
      const nets = (nid, q) => {
        const bits = q.bits || 1;
        if (bits === 1) return [idf(path + nid + '.' + q.name)];
        const a = [];
        for (let i = 0; i < bits; i++) a.push(idf(path + nid + '.' + q.name + '[' + i + ']'));
        return a;
      };
      for (const w of plate.wires) {
        const a = byId.get(w.from.node), b = byId.get(w.to.node);
        if (!a || !b) continue;
        const qa = descs.get(a.id).outputs.find((q) => q.name === w.from.pin);
        const qb = descs.get(b.id).inputs.find((q) => q.name === w.to.pin);
        if (!qa || !qb) { union(idf(path + w.from.node + '.' + w.from.pin), idf(path + w.to.node + '.' + w.to.pin)); continue; }
        const na = nets(a.id, qa), nb = nets(b.id, qb);
        if (na.length !== nb.length) {
          if (!widthErr) { widthErr = true; errors.push(`Bus width mismatch: a ${na.length}-bit wire goes into a ${nb.length}-bit pin (${path}${w.from.node} to ${w.to.node})`); }
          continue;
        }
        for (let i = 0; i < na.length; i++) union(na[i], nb[i]);
      }
      for (const n of plate.nodes) {
        const d = descs.get(n.id);
        for (const q of d.inputs.concat(d.outputs)) {
          const bits = q.bits || 1;
          nets(n.id, q).forEach((r, i) => pinRaw.push([path + n.id + '.' + q.name + (bits > 1 ? '[' + i + ']' : ''), r]));
        }
        const one = (q) => nets(n.id, q)[0];
        if (n.type === 'TUNNEL_IN' || n.type === 'TUNNEL_OUT') {
          // tunnels with the same name on one plate are one net
          const nm = String((n.props && n.props.name) || '').trim();
          if (nm) union(idf('T:' + path + nm), one((n.type === 'TUNNEL_IN' ? d.inputs : d.outputs)[0]));
        }
        if (D.GATES.includes(n.type)) {
          rawGates.push({ type: n.type, ins: d.inputs.map(one), out: one(d.outputs[0]) });
        } else if (n.type === 'TRI') {
          // tri-state buffer: drives its output only while EN is 1, otherwise the output floats (Z)
          rawGates.push({ type: 'TRI', ins: [one(d.inputs[0]), one(d.inputs[1])], out: one(d.outputs[0]) });
        } else if (n.type === 'SPLIT') {
          const bus = nets(n.id, d.inputs[0]);
          d.outputs.forEach((q) => { const g = q.bits || 1, k = Number(q.name.slice(1)), o = nets(n.id, q); for (let j = 0; j < g; j++) union(bus[k * g + j], o[j]); });   // bit number comes from the pin name (o3 = bit 3), not from where the pin sits
        } else if (n.type === 'MERGE') {
          const bus = nets(n.id, d.outputs[0]);
          d.inputs.forEach((q) => { const g = q.bits || 1, k = Number(q.name.slice(1)), o = nets(n.id, q); for (let j = 0; j < g; j++) union(o[j], bus[k * g + j]); });
        } else if (n.type === 'MEM') {
          // sparse memory: only the words that were written take up space, so 2^46 addresses cost nothing until used
          const m = d.mem, by = (name) => d.inputs.find((q) => q.name === name);
          rawMems.push({ key: path + n.id, abits: m.abits, dbits: m.dbits, rom: m.mode === 'rom', write: m.write, init: m.init,
            a: nets(n.id, by('a')), d: m.mode === 'rom' ? [] : nets(n.id, by('d')), we: m.mode === 'rom' ? -1 : one(by('we')), q: nets(n.id, d.outputs[0]) });
        } else if (n.type === 'SCREEN') {
          const g = d.geom, by = (name) => d.inputs.find((q) => q.name === name);
          rawScreens.push(g.mode === 'direct'
            ? { key: path + n.id, mode: 'direct', w: g.w, h: g.h, color: 'mono', write: g.write, px: d.inputs.map(one) }
            : { key: path + n.id, mode: 'addr', w: g.w, h: g.h, color: g.color, write: g.write,
              x: nets(n.id, by('x')), y: nets(n.id, by('y')), d: nets(n.id, by('d')), we: one(by('we')), clr: one(by('clr')) });
        } else if (n.type === 'BUS_IN' && depth === 0) {
          // top-level Bit input: one source per bit, keyed 'n3[0]', 'n3[1]', ...
          const val = D.fixProps('BUS_IN', n.props).value;
          nets(n.id, d.outputs[0]).forEach((net, i) => rawSources.push({ key: path + n.id + '[' + i + ']', kind: 'INPUT', net, init: D.bitOf(val, i) }));
        } else if (SOURCE_TYPES.includes(n.type) || (n.type === 'INPUT' && depth === 0)) {
          const init = n.type === 'CONST1' ? 1 : (n.type === 'INPUT' && n.props && n.props.value ? 1 : 0);
          rawSources.push({ key: path + n.id, kind: n.type, net: one(d.outputs[0]), init });
        } else if (n.type === 'PLATE') {
          const ref = n.props && n.props.ref;
          const child = ref ? lib.get(ref) : null;
          if (!child) { errors.push(`Missing plate "${ref}"`); continue; }
          if (stack.includes(ref) || depth >= 24) { errors.push(`Plate "${ref}" contains itself`); continue; }
          const cp = path + n.id + '/';
          for (const c of child.nodes) {
            if (c.type === 'INPUT') union(idf(path + n.id + '.' + c.id), idf(cp + c.id + '.q'));
            else if (c.type === 'OUTPUT') union(idf(path + n.id + '.' + c.id), idf(cp + c.id + '.d'));
            else if (c.type === 'BUS_IN' || c.type === 'BUS_OUT') {
              // bus pin of the chip: one net per bit, joined to the matching bit of the part inside
              const bits = D.fixProps(c.type, c.props).bits, inner = c.type === 'BUS_IN' ? '.q[' : '.d[';
              for (let i = 0; i < bits; i++) union(idf(path + n.id + '.' + c.id + '[' + i + ']'), idf(cp + c.id + inner + i + ']'));
            }
          }
          walk(child, cp, stack.concat(ref), depth + 1);
        }
      }
    }
    walk(rootPlate, '', [rootPlate.name], 0);

    const dense = new Map();
    const net = (raw) => { const r = find(raw); let v = dense.get(r); if (v === undefined) { v = dense.size; dense.set(r, v); } return v; };
    const gates = rawGates.map((g) => ({ type: g.type, ins: g.ins.map(net), out: net(g.out) }));
    const sources = rawSources.map((s) => ({ key: s.key, kind: s.kind, net: net(s.net), init: s.init }));
    const mems = rawMems.map((m) => ({ key: m.key, abits: m.abits, dbits: m.dbits, rom: m.rom, write: m.write, init: m.init,
      a: m.a.map(net), d: m.d.map(net), we: m.we < 0 ? -1 : net(m.we), q: m.q.map(net) }));
    const screens = rawScreens.map((s) => s.mode === 'direct'
      ? { key: s.key, mode: 'direct', w: s.w, h: s.h, color: 'mono', write: s.write, px: s.px.map(net) }
      : { key: s.key, mode: 'addr', w: s.w, h: s.h, color: s.color, write: s.write, x: s.x.map(net), y: s.y.map(net), d: s.d.map(net), we: net(s.we), clr: net(s.clr) });
    // Every pin of every node, nested plates included, keyed by path ('' for the top plate,
    // 'n3/' for the plate inside part n3, ...). The editor uses it to show live values inside chips.
    // Bus pins are stored per bit: 'n5.bus[0]', 'n5.bus[1]', ...
    const topNets = new Map();
    for (const [k, raw] of pinRaw) topNets.set(k, net(raw));
    return { netCount: dense.size, gates, sources, screens, mems, topNets, errors };
  }

  class Sim {
    // `prev` (optional): the simulator this one replaces after an edit in Live mode. Screen contents are kept.
    constructor(nl, prev) {
      this.nl = nl;
      this.v = new Uint8Array(nl.netCount);
      this.z = new Uint8Array(nl.netCount);           // 1 = nobody drives this net (floating, reads as 0)
      this.src = new Map(nl.sources.map((s) => [s.key, Object.assign({}, s, { val: s.init })]));
      this.clocks = [...this.src.values()].filter((s) => s.kind === 'CLOCK');
      this.unstable = false;
      this.conflicts = 0;                             // nets driven to different values at once (last settle)
      this.clashNets = new Set();
      // tri-state: nets with tri-state drivers are resolved from ALL their drivers
      this.triD = new Uint8Array(nl.gates.length);
      this.triEn = new Uint8Array(nl.gates.length);
      this.triNets = new Map();
      nl.gates.forEach((g, i) => { if (g.type === 'TRI') { if (!this.triNets.has(g.out)) this.triNets.set(g.out, []); this.triNets.get(g.out).push(i); } });
      for (const n of this.triNets.keys()) this.z[n] = 1;
      // memories (sparse): Map address -> value, both BigInt. A word that is 0 is not stored.
      this.mems = new Map();
      for (const m of nl.mems || []) {
        const old = prev && prev.mems && prev.mems.get(m.key);
        const keep = old && old.def.abits === m.abits && old.def.dbits === m.dbits && old.def.rom === m.rom;
        const mem = { def: m, data: keep ? new Map(old.data) : new Map(), prevWe: keep ? old.prevWe : 0, ver: keep ? old.ver + 1 : 1 };
        if (!keep) for (const e of m.init || []) {
          try { const a = BigInt(String(e[0]).trim()), v = BigInt(String(e[1]).trim()) & ((1n << BigInt(m.dbits)) - 1n); if (a >= 0n && a < (1n << BigInt(m.abits)) && v) mem.data.set(a, v); } catch (err) { /* skip a bad entry */ }
        }
        this.mems.set(m.key, mem);
      }
      this.memList = [...this.mems.values()];
      // pixel screens
      this.screens = new Map();
      for (const d of nl.screens || []) {
        const size = d.mode === 'direct' ? d.px.length : d.w * d.h;
        const old = prev && prev.screens && prev.screens.get(d.key);
        const keep = old && old.def.mode === d.mode && old.def.w === d.w && old.def.h === d.h && old.def.color === d.color;
        const sc = { def: d, fb: keep ? old.fb.slice() : new Uint8Array(size), ver: keep ? old.ver + 1 : 1, prevWe: keep ? old.prevWe : 0 };
        this.screens.set(d.key, sc);
      }
    }
    set(key, val) { const s = this.src.get(key); if (s) s.val = val ? 1 : 0; }
    get(key) { const s = this.src.get(key); return s ? s.val : 0; }
    toggle(key) { const s = this.src.get(key); if (!s) return 0; s.val ^= 1; return s.val; }
    // Bit input at the top level: read / write it as a number (bit i is source 'id[i]')
    // Wide buses: Number up to 53 bits, BigInt above (setBus accepts either)
    setBus(id, bits, val) { for (let i = 0; i < bits; i++) this.set(id + '[' + i + ']', D.bitOf(typeof val === 'bigint' ? val : (val > 2 ** 53 ? BigInt(val) : val), i)); }
    getBus(id, bits) { return this.collect(bits, (i) => this.get(id + '[' + i + ']')); }
    collect(bits, f) {
      if (bits <= D.SAFE_BITS) { let n = 0; for (let i = 0; i < bits; i++) if (f(i)) n += 2 ** i; return n; }
      let n = 0n; for (let i = 0; i < bits; i++) if (f(i)) n |= 1n << BigInt(i); return n;
    }
    tickClocks() { for (const c of this.clocks) c.val ^= 1; }
    resolveTri(net) {
      let val = 0, active = 0, clash = false;
      for (const gi of this.triNets.get(net)) {
        if (!this.triEn[gi]) continue;
        const d = this.triD[gi];
        if (active && d !== val) clash = true;
        val = d; active++;
      }
      if (clash) { val = 0; this.clashNets.add(net); } else this.clashNets.delete(net);
      const z = active ? 0 : 1;
      if (this.v[net] !== val || this.z[net] !== z) { this.v[net] = val; this.z[net] = z; return true; }
      return false;
    }
    // One in-place pass over all gates. Returns true if any net changed.
    // In-place (Gauss-Seidel) order makes cross-coupled latches settle deterministically.
    step() {
      const v = this.v, gates = this.nl.gates;
      let changed = false;
      for (const s of this.src.values()) if (v[s.net] !== s.val) { v[s.net] = s.val; changed = true; }
      for (let i = 0; i < gates.length; i++) {
        const g = gates[i];
        if (g.type === 'TRI') {
          this.triD[i] = v[g.ins[0]]; this.triEn[i] = v[g.ins[1]];
          if (this.resolveTri(g.out)) changed = true;
          continue;
        }
        // same truth tables as GateDefs.evalGate, without building an array per gate (this loop is the hot path)
        const ins = g.ins, n = ins.length;
        let ones = 0;
        for (let k = 0; k < n; k++) if (v[ins[k]]) ones++;
        let out;
        switch (g.type) {
          case 'AND': out = ones === n ? 1 : 0; break;
          case 'NAND': out = ones === n ? 0 : 1; break;
          case 'OR': out = ones > 0 ? 1 : 0; break;
          case 'NOR': out = ones > 0 ? 0 : 1; break;
          case 'XOR': out = ones & 1; break;
          case 'XNOR': out = (ones & 1) ^ 1; break;
          case 'NOT': out = v[ins[0]] ? 0 : 1; break;
          case 'BUF': out = v[ins[0]] ? 1 : 0; break;
          default: out = D.evalGate(g.type, ins.map((q) => v[q]));
        }
        if (v[g.out] !== out) { v[g.out] = out; changed = true; }
      }
      // memory reads: Q follows the word at address A all the time (like an asynchronous-read RAM)
      for (let mi = 0; mi < this.memList.length; mi++) {
        const m = this.memList[mi], d = m.def, an = d.a;
        let addr = 0n;
        if (an.length <= 30) { let k = 0; for (let i = 0; i < an.length; i++) if (v[an[i]]) k |= 1 << i; addr = BigInt(k); }
        else for (let i = 0; i < an.length; i++) if (v[an[i]]) addr |= 1n << BigInt(i);
        const word = m.data.get(addr) || 0n, q = d.q;
        for (let i = 0; i < q.length; i++) { const b = Number((word >> BigInt(i)) & 1n); if (v[q[i]] !== b) { v[q[i]] = b; changed = true; } }
      }
      return changed;
    }
    // Writes happen after the circuit settled: edge = on WE 0 -> 1, level = for as long as WE is 1. True if a word changed.
    updateMems() {
      let wrote = false;
      for (const m of this.memList) {
        const d = m.def;
        if (d.rom) continue;
        const we = this.v[d.we];
        if (d.write === 'level' ? we : (we && !m.prevWe)) {
          const addr = this.big(d.a), val = this.big(d.d);
          if ((m.data.get(addr) || 0n) !== val) { if (val) m.data.set(addr, val); else m.data.delete(addr); m.ver++; wrote = true; }
        }
        m.prevWe = we;
      }
      return wrote;
    }
    settle() {
      const max = Math.min(10000, this.nl.gates.length * 2 + 16);
      let ok = false;
      for (let r = 0; r < 8; r++) {
        ok = false;
        for (let i = 0; i < max; i++) if (!this.step()) { ok = true; break; }
        if (!this.memList.length || !this.updateMems()) break;   // a write can change what the memory reads, so settle again
      }
      this.unstable = !ok;
      this.conflicts = this.clashNets.size;
      this.updateScreens();
      return ok;
    }
    num(nets) { let n = 0; for (let i = 0; i < nets.length; i++) if (this.v[nets[i]]) n += 2 ** i; return n; }
    // Screens react to the settled circuit: 'edge' writes one pixel when WE goes 0 -> 1, 'level' writes
    // for as long as WE is 1. CLR (level) wipes the screen. Direct screens just mirror their pins.
    updateScreens() {
      const v = this.v;
      for (const sc of this.screens.values()) {
        const d = sc.def, fb = sc.fb;
        if (d.mode === 'direct') {
          for (let i = 0; i < d.px.length; i++) { const b = v[d.px[i]]; if (fb[i] !== b) { fb[i] = b; sc.ver++; } }
          continue;
        }
        const we = v[d.we];
        if (v[d.clr]) {
          let dirty = false; for (let i = 0; i < fb.length; i++) if (fb[i]) { fb[i] = 0; dirty = true; }
          if (dirty) sc.ver++;
        } else if (d.write === 'level' ? we : (we && !sc.prevWe)) {
          const x = this.num(d.x), y = this.num(d.y);
          if (x < d.w && y < d.h) {
            const c = this.num(d.d), idx = y * d.w + x;
            if (fb[idx] !== c) { fb[idx] = c; sc.ver++; }
          }
        }
        sc.prevWe = we;
      }
    }
    pin(key) { const n = this.nl.topNets.get(key); return n === undefined ? 0 : this.v[n]; }
    isZ(key) { const n = this.nl.topNets.get(key); return n !== undefined && this.z[n] === 1; }
    // Value of a bus pin as a number, plus how many of its bits are floating.
    bus(key, bits) { return this.collect(bits, (i) => this.pin(key + '[' + i + ']')); }
    big(nets) { let n = 0n; for (let i = 0; i < nets.length; i++) if (this.v[nets[i]]) n |= 1n << BigInt(i); return n; }
    memRead(key, addr) { const m = this.mems.get(key); return (m && m.data.get(BigInt(addr))) || 0n; }
    memWrite(key, addr, val) { const m = this.mems.get(key); if (!m) return; const a = BigInt(addr), v = BigInt(val) & ((1n << BigInt(m.def.dbits)) - 1n); if (v) m.data.set(a, v); else m.data.delete(a); m.ver++; }
  }

  return { compile, Sim };
});
