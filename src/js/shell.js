/* Shell: IntelliJ-style tool-window rails. Click a rail button to hide or show its panel.
 * On a narrow window there is no room for both side panels, so only one of them stays open at a time. */
(function () {
  'use strict';
  const KEY = 'ge.shell';
  const NARROW = 960;                       // window width (px) below which both panels would squeeze the editor
  const ide = document.getElementById('ide');
  if (!ide) return;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
  const panels = [
    { btn: 'railExp', cls: 'no-exp', id: 'exp' },
    { btn: 'railPal', cls: 'no-pal', id: 'pal' },
  ];
  const want = {};                          // what the user chose (remembered)
  panels.forEach((p) => { want[p.id] = saved[p.id] !== false; });
  let eff = Object.assign({}, want);        // what is really shown right now
  const isNarrow = () => window.innerWidth < NARROW;

  function apply(p, show) {
    ide.classList.toggle(p.cls, !show);
    const b = document.getElementById(p.btn);
    if (b) { b.classList.toggle('on', show); b.setAttribute('aria-pressed', String(show)); }
  }
  function applyAll() { panels.forEach((p) => apply(p, eff[p.id])); }
  function layout() {
    eff = Object.assign({}, want);
    if (isNarrow() && eff.exp && eff.pal) eff.exp = false;   // keep Components (what you build with), Explorer one click away
    applyAll();
  }

  panels.forEach((p) => {
    const b = document.getElementById(p.btn);
    if (!b) return;
    b.addEventListener('click', () => {
      if (isNarrow()) {
        const show = !eff[p.id];
        eff[p.id] = show;
        if (show) panels.forEach((o) => { if (o !== p) eff[o.id] = false; });   // one panel at a time
      } else {
        want[p.id] = !want[p.id];
        eff = Object.assign({}, want);
        try { localStorage.setItem(KEY, JSON.stringify(want)); } catch (e) { /* ignore */ }
      }
      applyAll();
    });
  });

  let wasNarrow = isNarrow();
  window.addEventListener('resize', () => {
    const n = isNarrow();
    if (n !== wasNarrow) { wasNarrow = n; layout(); }
  });
  layout();
})();
