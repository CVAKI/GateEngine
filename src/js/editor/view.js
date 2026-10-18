/* Editor / view: Zoom and fit-to-window. */
(function () {
  'use strict';
  const { G, clamp } = EditorKit;

  EditorKit.mix(Editor, {
    setZoom(z) {
      this.zoom = clamp(z, 0.2, 4);
      this.render();
      if (this.cb.onZoom) this.cb.onZoom(this.zoom);
    },

    zoomAt(factor, cx, cy) {
      if (!this.plate) return;
      const r = this.svg.getBoundingClientRect();
      const px = (cx - r.left) / this.zoom, py = (cy - r.top) / this.zoom;
      this.setZoom(this.zoom * factor);
      const r2 = this.svg.getBoundingClientRect();
      this.scroller.scrollLeft += r2.left + px * this.zoom - cx;
      this.scroller.scrollTop += r2.top + py * this.zoom - cy;
    },

    fit() {
      if (!this.plate) return;
      const r = this.scroller.getBoundingClientRect();
      const z = Math.min((r.width - 120) / (this.plate.width * G), (r.height - 120) / (this.plate.height * G));
      this.setZoom(clamp(z, 0.2, 2));
      this.scroller.scrollLeft = (this.scroller.scrollWidth - this.scroller.clientWidth) / 2;
      this.scroller.scrollTop = (this.scroller.scrollHeight - this.scroller.clientHeight) / 2;
    },
  });
})();
