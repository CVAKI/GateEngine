/* Editor / simulation: Run / Live mode: start, stop, clock, live values, clicking switches while running. */
(function () {
  'use strict';
  const { clamp } = EditorKit;

  EditorKit.mix(Editor, {
    live(key) { return this.running && this.sim ? this.sim.pin(this.prefix + key) : 0; },

    liveZ(key) { return this.running && this.sim ? this.sim.isZ(this.prefix + key) : false; },

    // a bus wire counts as high when any of its bits is high
    liveBus(key, bits) { if (!this.running || !this.sim) return 0; for (let i = 0; i < bits; i++) if (this.sim.pin(this.prefix + key + '[' + i + ']')) return 1; return 0; },

    setAuto(on) {
      this.auto = !!on;
      if (!this.plate) return;
      if (this.auto && !this.running) this.run();
      else if (!this.auto && this.running) this.stop();
      else this.render();
    },

    // after an edit while Live: rebuild the netlist, keep the switches, the screens and the clock running
    refreshLive() {
      if (!this.auto || !this.running || this.readonly || !this.plate) return;
      const nl = GateSim.compile(this.plate, this.lib);
      if (nl.errors.length) {
        if (this.cb.onToast && nl.errors[0] !== this._liveErr) this.cb.onToast(nl.errors[0], 'error');
        this._liveErr = nl.errors[0];
        return;
      }
      this._liveErr = null;
      this.sim = new GateSim.Sim(nl, this.sim);
      this.sim.settle();
      this.startClock();
      this.render();
      if (this.cb.onRunState) this.cb.onRunState(true, nl);
    },

    run() {
      if (!this.plate) return false;
      if (this.stack.length) this.exit(this.stack.length);
      this.endWire();
      const nl = GateSim.compile(this.plate, this.lib);
      if (nl.errors.length) { if (this.cb.onToast) this.cb.onToast(nl.errors[0], 'error'); return false; }
      this.canvases.clear();
      this.sim = new GateSim.Sim(nl);
      this.running = true;
      this.sel = null;
      this.sim.settle();
      if (this.sim.unstable && this.cb.onToast) this.cb.onToast('Circuit did not settle (feedback loop oscillating).', 'warn');
      this.startClock();
      this.render();
      if (this.cb.onSelect) this.cb.onSelect(null);
      if (this.cb.onRunState) this.cb.onRunState(true, nl);
      return true;
    },

    stop() {
      clearInterval(this.clockTimer); this.clockTimer = null;
      const was = this.running;
      this.running = false; this.sim = null; this.canvases.clear();
      if (this.stack.length) { const s = this.stack[0]; this.plate = s.plate; this.stack = []; this.prefix = ''; this.readonly = false; this.sel = null; this.renderCrumbs(); }
      if (this.plate) this.render();
      if (was && this.cb.onRunState) this.cb.onRunState(false);
    },

    startClock() {
      clearInterval(this.clockTimer); this.clockTimer = null;
      if (!this.sim || !this.sim.clocks.length) return;
      // No upper limit on the Hz you type. Up to 33 Hz: one half-period per timer tick. Faster: as many half-periods
      // as fit in the frame budget. Hz = 0 means MAX (as fast as this PC can go). The real speed is measured and shown.
      const max = !this.hz || this.hz >= 1e6;
      const per = max ? Infinity : Math.max(1, Math.round(this.hz * 2 * 0.015));
      let n = 0, t00 = performance.now();
      this.clockTimer = setInterval(() => {
        const t0 = performance.now();
        let i = 0;
        for (; i < per; i++) { this.sim.tickClocks(); this.sim.settle(); if (performance.now() - t0 > 11) { i++; break; } }
        n += i;
        const now = performance.now();
        if (now - t00 > 500) { this.realHz = n / 2 / ((now - t00) / 1000); n = 0; t00 = now; if (this.cb.onHz) this.cb.onHz(this.realHz); }
        this.render();
      }, max ? 15 : Math.max(15, 500 / this.hz));
    },

    // hz: any number > 0, or 0 for MAX
    setHz(hz) { hz = Number(hz); this.hz = hz > 0 ? Math.max(0.1, hz) : 0; if (this.running) this.startClock(); },

    runClick(id, e) {
      const n = this.nodeMap.get(id);
      if (!n || !this.sim) return;
      if (n.type === 'INPUT') {
        if (this.prefix) return;                       // inside a chip the inputs come from the outside
        n.props.value = this.sim.toggle(id);
        this.sim.settle(); this.render();
      } else if (n.type === 'BUS_IN') {
        const bit = this.bitUnder(n, e);
        if (bit >= 0) this.tapBit(n, bit);
      } else if (n.type === 'BUTTON') {
        const key = this.prefix + id;
        this.sim.set(key, 1); this.sim.settle(); this.render();
        const up = () => { window.removeEventListener('pointerup', up); if (this.sim) { this.sim.set(key, 0); this.sim.settle(); this.render(); } };
        window.addEventListener('pointerup', up);
      }
    },
  });
})();
