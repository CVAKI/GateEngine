/* Gate Engine landing page */

/* ======================================================================
   CONFIG: change these when you ship a new build.
   The installer must be at:  dist/<filename>   (see .gitignore)
   ====================================================================== */
const CONFIG = {
  version: '0.8.0',
  // electron-builder names the NSIS installer "Gate Engine Setup <version>.exe"
  filename: (v) => `Gate Engine Setup ${v}.exe`,
  downloadDir: 'dist',
  size: '109 MB',
  // Optional: full URL of the installer if you host it on a GitHub Release instead of dist/.
  // Example: 'https://github.com/USER/REPO/releases/download/v0.8.0/Gate.Engine.Setup.0.8.0.exe'
  // (GitHub turns spaces in file names into dots.) Leave '' to use dist/.
  downloadUrl: '',
  github: '',                                  // e.g. 'https://github.com/yourname/GateEngine'; empty hides the GitHub links
  linkedin: 'https://www.linkedin.com/in/cvaki-',
};

(function () {
  'use strict';
  document.documentElement.classList.add('js');
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ---------- fill version / download link from CONFIG ---------- */
  const file = CONFIG.filename(CONFIG.version);
  const href = CONFIG.downloadUrl || (CONFIG.downloadDir + '/' + encodeURIComponent(file));   // spaces become %20
  $$('[data-download]').forEach((a) => { a.href = href; a.setAttribute('download', file); });
  $$('[data-version]').forEach((el) => { el.textContent = CONFIG.version; });
  $$('[data-version-badge]').forEach((el) => { el.textContent = 'v' + CONFIG.version; });
  $$('[data-size]').forEach((el) => { el.textContent = CONFIG.size; });
  $$('[data-filename]').forEach((el) => { el.textContent = file; });
  $$('[data-github]').forEach((a) => {
    if (CONFIG.github) { a.href = CONFIG.github; a.hidden = false; }
  });

  /* ---------- navbar: shadow on scroll, mobile menu, active link ---------- */
  const nav = $('#nav'), links = $('#links'), menuBtn = $('#menuBtn');
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  const setMenu = (open) => {
    links.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    $('use', menuBtn).setAttribute('href', open ? '#i-close' : '#i-menu');
  };
  menuBtn.addEventListener('click', () => setMenu(!links.classList.contains('open')));
  links.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('click', (e) => {
    if (links.classList.contains('open') && !e.target.closest('#links, #menuBtn')) setMenu(false);
  });

  const spy = $$('[data-spy]');
  const sections = spy.map((a) => $(a.getAttribute('href'))).filter(Boolean);
  if ('IntersectionObserver' in window && sections.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        spy.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach((s) => io.observe(s));
  }

  /* ---------- reveal on scroll ---------- */
  const reveals = $$('.reveal');
  if ('IntersectionObserver' in window) {
    const ro = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); ro.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    reveals.forEach((el, i) => { el.style.transitionDelay = (i % 3) * 70 + 'ms'; ro.observe(el); });
  } else {
    reveals.forEach((el) => el.classList.add('in'));
  }

  /* ---------- screenshot tabs ---------- */
  const SHOTS = [
    { src: 'web/img/app-calculator-live.webp', alt: 'Gate Engine running the CALCULATER plate live: bit inputs A and B feeding an 8-bit add/subtract chip', cap: 'Live circuit: A = 34 plus B = 4 gives 38 on the output lights. Active wires glow cyan.' },
    { src: 'web/img/chip-xy-co-man.webp',     alt: 'Inside the XY-CO-MAN plate, built from a 4-bit MUX, a 4-bit register and an incrementer chip', cap: 'Inside a chip: a plate built from a 4MUX, a 4REG and a 4INC-DEC. Wire humps show crossings.' },
    { src: 'web/img/map-view.webp',           alt: 'Map view of CALCULATER with every chip opened up to the gates', cap: 'Map view: every chip opened, level inside level, down to the real gates. 50 gates, 27 chips, 3 levels deep.' },
    { src: 'web/img/gpu32-live.webp',         alt: 'The 32-bit GPU circuit drawing a house on a 64 by 64 pixel screen', cap: 'MyGPU32 at 4,344 gates, with a 64 × 64 colour screen. Clock set to 100000 Hz, real speed 617 Hz.' },
  ];
  const stageImg = $('#stageImg'), stageCap = $('#stageCap'), tabs = $$('.tab');
  let cur = 0;
  const show = (i, instant) => {
    cur = i;
    tabs.forEach((t, k) => { t.classList.toggle('on', k === i); t.setAttribute('aria-selected', String(k === i)); });
    const s = SHOTS[i];
    const apply = () => { stageImg.src = s.src; stageImg.alt = s.alt; stageCap.textContent = s.cap; stageImg.classList.remove('fade'); };
    if (instant) return apply();
    stageImg.classList.add('fade');
    setTimeout(apply, 180);
  };
  tabs.forEach((t) => t.addEventListener('click', () => show(Number(t.dataset.i))));
  show(0, true);

  /* ---------- lightbox ---------- */
  const lb = $('#lb'), lbImg = $('#lbImg');
  const openLb = (src, alt) => { lbImg.src = src; lbImg.alt = alt || ''; lb.hidden = false; document.body.style.overflow = 'hidden'; };
  const closeLb = () => { lb.hidden = true; lbImg.src = ''; document.body.style.overflow = ''; };
  $('#stageBtn').addEventListener('click', () => openLb(SHOTS[cur].src, SHOTS[cur].alt));
  $$('.zoom[data-full]').forEach((b) => b.addEventListener('click', () => openLb(b.dataset.full, b.dataset.alt)));
  $('.hero-shot img').addEventListener('click', (e) => openLb(e.target.src, e.target.alt));
  $('.hero-shot img').style.cursor = 'zoom-in';
  lb.addEventListener('click', closeLb);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lb.hidden) closeLb(); });
})();
