/* Editor / geometry: Coordinates and pin lookups, plus the state of a part. */
(function () {
  'use strict';

  EditorKit.mix(Editor, {
    toPlate(e) {
      const m = this.svg.getScreenCTM();
      if (!m) return { x: 0, y: 0 };
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      return { x: p.x, y: p.y };
    },

    pinPos(nodeId, pin, out) {
      const n = this.nodeMap.get(nodeId), d = this.descs.get(nodeId);
      if (!n || !d) return null;
      const q = (out ? d.outputs : d.inputs).find((x) => x.name === pin);
      return q ? { x: n.x + q.x, y: n.y + q.y } : null;
    },

    pinBits(nodeId, pin, out) {
      const d = this.descs.get(nodeId), q = d && (out ? d.outputs : d.inputs).find((x) => x.name === pin);
      return (q && q.bits) || 1;
    },

    nodeOn(n) {
      const s = this.running && this.sim, pf = this.prefix;
      switch (n.type) {
        case 'INPUT': return s ? (pf ? !!this.sim.pin(pf + n.id + '.q') : !!this.sim.get(n.id)) : !!(n.props && n.props.value);
        case 'BUTTON': case 'CLOCK': return s ? !!this.sim.get(pf + n.id) : false;
        case 'CONST1': return true;
        case 'OUTPUT': case 'PROBE': return s ? !!this.live(n.id + '.d') : false;
      }
      return false;
    },

    // value of a Bit input / Bit output as a number (the stored value while the circuit is not running)
    busVal(n) {
      const P = GateDefs.fixProps(n.type, n.props), s = this.running && this.sim;
      if (!s) return n.type === 'BUS_IN' ? P.value : 0;
      // Number up to 53 bits, BigInt above
      return this.sim.collect(P.bits, (i) => (n.type === 'BUS_IN' ? (this.prefix ? this.sim.pin(this.prefix + n.id + '.q[' + i + ']') : this.sim.get(n.id + '[' + i + ']'))
        : this.sim.pin(this.prefix + n.id + '.d[' + i + ']')));
    },

    // everything the part needs to draw its live state
    nodeState(n) {
      const st = { on: this.nodeOn(n) };
      if (n.type === 'BUS_IN' || n.type === 'BUS_OUT') st.val = this.busVal(n);
      if (n.type === 'SEG7') st.segs = GateDefs.SEGN.map((p) => !!this.live(n.id + '.' + p));
      if (n.type === 'SCREEN' && this.running && this.sim) { const sc = this.sim.screens.get(this.prefix + n.id); if (sc && sc.def.mode === 'direct') st.px = sc.fb; }
      if (n.type === 'HEX') st.val = [0, 1, 2, 3].reduce((v, i) => v | (this.live(n.id + '.d' + i) ? 1 << i : 0), 0);
      return st;
    },
  });
})();
