/* ==========================================================================
   KV23 — main interactions
   Smooth scroll (Lenis) + GSAP ScrollTrigger, with graceful fallbacks.
   ========================================================================== */
(() => {
  'use strict';

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const has = (s) => !!document.querySelector(s); // the same script runs on every page; skip what a page doesn't have
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasGSAP = typeof window.gsap !== 'undefined';
  if (hasGSAP && window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  // scroll speed, shared by the marquee and the rails
  const KV = { velocity: 0 };

  /* ------------------------------------------------------------------------
     Smooth scroll
     ------------------------------------------------------------------------ */
  let lenis = null;
  if (window.Lenis && !reduced) {
    lenis = new Lenis({ duration: 1.15, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
    lenis.on('scroll', (e) => {
      KV.velocity = e.velocity;
      if (hasGSAP && window.ScrollTrigger) ScrollTrigger.update();
    });
    if (hasGSAP) {
      gsap.ticker.add((t) => lenis.raf(t * 1000));
      gsap.ticker.lagSmoothing(0);
    } else {
      const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
    }
    lenis.stop();
  } else {
    // native scroll: derive velocity from per-frame delta
    let last = scrollY;
    const tick = () => { KV.velocity = lerp(KV.velocity, scrollY - last, 0.3); last = scrollY; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  const scrollToTarget = (target, opts = {}) => {
    if (lenis) lenis.scrollTo(target, { duration: 1.6, ...opts });
    else {
      const el = typeof target === 'string' ? $(target) : target;
      const y = typeof target === 'number' ? target : el ? el.getBoundingClientRect().top + scrollY : 0;
      scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' });
    }
  };

  /* ------------------------------------------------------------------------
     Text utilities: split into chars, rolling hover labels
     ------------------------------------------------------------------------ */
  function splitChars(el) {
    const frag = document.createDocumentFragment();
    const newLine = () => { const l = document.createElement('span'); l.className = 'split-line'; frag.appendChild(l); return l; };
    let line = newLine();
    let i = 0;
    // letters are grouped per word, so a heading can only wrap between words (never "RIDE WIT / H")
    const add = (text, parent) => {
      let word = null;
      for (const ch of text) {
        if (/\s/.test(ch)) { word = null; if (parent.childNodes.length) parent.appendChild(document.createTextNode(' ')); continue; }
        if (!word) { word = document.createElement('span'); word.className = 'split-word'; parent.appendChild(word); }
        const s = document.createElement('span');
        s.className = 'split-char';
        s.textContent = ch;
        s.style.setProperty('--i', i++);
        word.appendChild(s);
      }
    };
    el.childNodes.forEach((n) => {
      if (n.nodeName === 'BR') { line = newLine(); return; }
      if (n.nodeType === 3) add(n.textContent, line);
      else if (n.nodeType === 1) { const c = n.cloneNode(false); add(n.textContent, c); line.appendChild(c); }
    });
    el.textContent = '';
    el.appendChild(frag);
    return $$('.split-char', el);
  }

  $$('[data-roll]').forEach((el) => {
    const text = el.textContent.trim();
    el.setAttribute('aria-label', text);
    el.textContent = '';
    [...text].forEach((ch, i) => {
      const s = document.createElement('span');
      s.className = 'rc';
      s.setAttribute('aria-hidden', 'true');
      s.dataset.c = ch;
      s.textContent = ch;
      s.style.setProperty('--i', i);
      el.appendChild(s);
    });
  });

  const splits = new Map();
  $$('[data-split]').forEach((el) => splits.set(el, splitChars(el)));

  /* ------------------------------------------------------------------------
     Terrain lines behind every page: one map as long as the page, so it scrolls with the content
     and each part of the page sits on its own stretch of terrain. Drawn in 1000px bands, each with
     its own seed, and redrawn only when the width changes or the page grows past what's drawn.
     ------------------------------------------------------------------------ */
  function backdrop() {
    // the map sits in a clipped box the size of the page, so its own (taller) height never adds scroll
    const box = document.createElement('div');
    box.className = 'bgfx';
    box.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    box.appendChild(svg);
    document.body.prepend(box);
    const BAND = 1000;
    let drawnW = 0, drawnH = 0;
    const draw = () => {
      const w = document.documentElement.clientWidth, need = document.body.offsetHeight;
      if (w === drawnW && need <= drawnH) return;
      const h = Math.ceil((need + innerHeight) / BAND) * BAND; // a screen of spare, so small growth needs no redraw
      let d = '';
      for (let b = 0; b * BAND < h; b++) d += contourPaths(w, BAND, 7 + b * 131, b * BAND);
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.style.height = h + 'px';
      svg.innerHTML = `<path d="${d}"/>`;
      drawnW = w; drawnH = h;
    };
    draw();
    if (window.ResizeObserver) new ResizeObserver(draw).observe(document.body);
    else addEventListener('resize', draw);
  }

  /* ------------------------------------------------------------------------
     Hero: extruded 3D logo
     ------------------------------------------------------------------------ */
  const heroLogo = $('#heroLogo');
  const stack = $('.hero__logo-stack');
  const LAYERS = 16;
  for (let i = LAYERS; stack && i >= 1; i--) {
    const l = document.createElement('i');
    const t = i / LAYERS;
    l.style.transform = `translateZ(${-i * 2.6}px)`;
    l.style.setProperty('--c', `rgb(${Math.round(lerp(200, 40, t))}, ${Math.round(lerp(10, 0, t))}, ${Math.round(lerp(40, 10, t))})`);
    stack.appendChild(l);
  }
  if (heroLogo && !reduced) { // a slow idle sway, so the extrusion reads as 3D
    const tiltLoop = (now) => {
      heroLogo.style.transform = `rotateY(${(Math.cos(now / 2300) * 14).toFixed(2)}deg) rotateX(${(Math.sin(now / 1800) * 7).toFixed(2)}deg)`;
      requestAnimationFrame(tiltLoop);
    };
    requestAnimationFrame(tiltLoop);
  }

  // session clock
  const clock = $('#sessionClock');
  const fmt = (n) => String(n).padStart(2, '0');
  const tickClock = () => { const d = new Date(); clock.textContent = `${fmt(d.getHours())}:${fmt(d.getMinutes())}:${fmt(d.getSeconds())}`; };
  if (clock) { tickClock(); setInterval(tickClock, 1000); }

  /* ------------------------------------------------------------------------
     Lights-out preloader
     ------------------------------------------------------------------------ */
  function runLoader() {
    return new Promise((resolve) => {
      const loader = $('#loader');
      if (!loader) { resolve(); return; } // inner pages skip the lights-out intro
      // the lights-out intro plays once per visit, not every time you come back from another page
      let seen = false;
      try { seen = !!sessionStorage.getItem('kv23-intro'); sessionStorage.setItem('kv23-intro', '1'); } catch (e) {}
      if (reduced || seen) { loader.remove(); resolve(); return; }

      const pods = $$('.pod', loader), count = $('#loaderCount'), call = $('#loaderCall');
      let loaded = false, progress = 0;
      const start = performance.now(), MIN = 2200;
      Promise.all([
        new Promise((r) => (document.readyState === 'complete' ? r() : addEventListener('load', r, { once: true }))),
        document.fonts ? document.fonts.ready : Promise.resolve(),
      ]).then(() => (loaded = true));
      setTimeout(() => (loaded = true), 6000); // never hang on a slow CDN

      const tick = (now) => {
        const target = Math.min((now - start) / MIN, loaded ? 1 : 0.9);
        progress = lerp(progress, target, 0.12);
        if (target === 1 && progress > 0.995) progress = 1;
        count.textContent = String(Math.round(progress * 100)).padStart(3, '0');
        const lit = Math.floor(progress * 5 + 1e-6);
        pods.forEach((p, i) => p.classList.toggle('on', i < lit));
        if (progress < 1) { requestAnimationFrame(tick); return; }

        // all five lit → random hold → lights out
        setTimeout(() => {
          pods.forEach((p) => p.classList.remove('on'));
          call.style.transition = 'opacity .25s, transform .5s cubic-bezier(.16,1,.3,1)';
          call.style.opacity = '1'; call.style.transform = 'none';
          setTimeout(() => {
            if (hasGSAP) {
              gsap.to(loader, {
                clipPath: 'inset(0 0 100% 0)', duration: 1.1, ease: 'expo.inOut',
                onComplete: () => loader.remove(),
              });
              setTimeout(resolve, 350);
            } else { loader.remove(); resolve(); }
          }, 650);
        }, 450 + Math.random() * 700);
      };
      requestAnimationFrame(tick);
    });
  }

  /* ------------------------------------------------------------------------
     Intro + scroll-driven animation
     ------------------------------------------------------------------------ */
  function intro() {
    document.body.classList.remove('is-loading');
    if (lenis) lenis.start();

    if (!hasGSAP || reduced) {
      $$('[data-reveal]').forEach((el) => { el.style.opacity = 1; el.style.transform = 'none'; });
      return;
    }

    const heroChars = $$('.hero__row .split-char');
    if (!heroChars.length) { // inner pages: just bring the above-the-fold bits in
      if (has('[data-intro]')) gsap.from('[data-intro]', { y: 30, opacity: 0, duration: 1.2, ease: 'expo.out', stagger: 0.1, delay: 0.3 });
      return;
    }
    const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
    tl.from(heroChars, { yPercent: 120, rotate: 8, duration: 1.4, stagger: 0.035 }, 0)
      .from('.hero__logo', { scale: 0.4, opacity: 0, rotateX: 70, duration: 1.8 }, 0.15)
      .from('[data-intro]', { y: 30, opacity: 0, duration: 1.2, stagger: 0.08 }, 0.6);
  }

  function scrollAnimations() {
    if (!hasGSAP || !window.ScrollTrigger || reduced) return;

    // hero: drive "through" the logo, name rows peel apart
    if (has('.hero')) gsap.timeline({ scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } })
      .to('.hero__row--a', { xPercent: -30, ease: 'none' }, 0)
      .to('.hero__row--b', { xPercent: -14, ease: 'none' }, 0)
      // logo exits up and away from the name instead of growing over it; fromTo so the scrub never captures mid-intro values
      .fromTo('.hero__logo', { y: 0, scale: 1, opacity: 1 }, { y: '-30vh', scale: 0.7, opacity: 0, ease: 'power1.in', immediateRender: false }, 0)
      .fromTo('.hero__bottom, .hero__meta', { opacity: 1, y: 0 }, { opacity: 0, y: -40, ease: 'none', immediateRender: false }, 0);

    // split headings outside the hero
    splits.forEach((chars, el) => {
      if (el.closest('.hero')) return;
      gsap.from(chars, {
        yPercent: 115, rotate: 6, duration: 1.2, ease: 'expo.out', stagger: 0.025,
        scrollTrigger: { trigger: el, start: 'top 88%' },
      });
    });

    // generic reveals
    ScrollTrigger.batch('[data-reveal]', {
      start: 'top 90%', once: true,
      onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 1.2, ease: 'expo.out', stagger: 0.1 }),
    });

    // manifesto: words light up as you read
    const man = $('#manifesto');
    if (man) {
      const words = man.textContent.trim().split(/\s+/);
      man.textContent = '';
      words.forEach((w, i) => {
        const s = document.createElement('span');
        s.className = 'w'; s.textContent = w;
        man.appendChild(s);
        if (i < words.length - 1) man.appendChild(document.createTextNode(' '));
      });
      gsap.to($$('.w', man), {
        opacity: 1, ease: 'none', stagger: 0.1,
        scrollTrigger: { trigger: man, start: 'top 85%', end: 'bottom 45%', scrub: true },
      });
    }

    // the licence card swings in (animate the wrapper: the card's own transform belongs to tilt/flip)
    if (has('.licence-wrap')) gsap.from('.licence-wrap', {
      y: 140, rotate: -8, opacity: 0, duration: 1.6, ease: 'expo.out', clearProps: 'transform',
      scrollTrigger: { trigger: '.licence-wrap', start: 'top 85%' },
    });

    // big outlined titles drift sideways
    [['.evolution__title .outline', '.evolution__intro', 12], ['.ontrack__title .outline', '.ontrack__head', 10], ['.kpage__title .outline', '.kpage__hero', 10], ['.partners__title .outline', '.partners__head', 14]]
      .forEach(([el, trigger, x]) => has(el) && gsap.to(el, { xPercent: x, ease: 'none', scrollTrigger: { trigger, scrub: true } }));

    // Road to Racing roadmap: the line fills up to where Kiryl is now
    if (has('#roadmap')) {
      gsap.fromTo('#roadmap', { '--p': 0 }, { '--p': 0.3, duration: 1.8, ease: 'expo.inOut', scrollTrigger: { trigger: '#roadmap', start: 'top 80%' } });
      gsap.from('#roadmap li', { y: 30, opacity: 0, duration: 1, ease: 'expo.out', stagger: 0.12, scrollTrigger: { trigger: '#roadmap', start: 'top 80%' } });
    }

    // giant KV23 rises letter by letter
    if (has('.finish__big')) gsap.from('.finish__big span', {
      yPercent: 60, opacity: 0, stagger: 0.08, duration: 1.4, ease: 'expo.out',
      scrollTrigger: { trigger: '.finish__big', start: 'top 90%' },
    });

    sectionFx();
  }

  /* ------------------------------------------------------------------------
     On Track → Road to Racing → Chequered Flag: extra motion
     ------------------------------------------------------------------------ */
  function sectionFx() {
    const once = (trigger, start = 'top 85%') => ({ trigger, start, once: true });

    // stats board boots like a timing screen: cells flip down one by one, then a light sweeps across
    const board = $('#board');
    if (board) gsap.from($$('.cell', board), {
      rotateX: -85, opacity: 0, transformOrigin: '50% 0%', duration: 1, ease: 'expo.out', stagger: 0.07,
      clearProps: 'transform,opacity', scrollTrigger: once(board, 'top 80%'),
      onStart: () => board.classList.add('is-live'),
    });
    if (has('.irchart')) gsap.from('.irchart__facts li', { y: 24, opacity: 0, duration: 1, ease: 'expo.out', stagger: 0.12, scrollTrigger: once('.irchart', 'top 75%') });

    // licences are dealt onto the table, then the promotion gets stamped
    const promo = $('.lic--promo');
    if (promo) {
      promo.classList.add('pre-stamp');
      gsap.from('.lic', {
        y: 90, rotateY: -40, rotateZ: -3, opacity: 0, transformOrigin: '0% 50%', duration: 1.2, ease: 'expo.out', stagger: 0.14,
        clearProps: 'transform,opacity', scrollTrigger: once('.lics__track'),
        onComplete: () => promo.classList.replace('pre-stamp', 'is-stamped'),
      });
    }

    // race cards pull out of the pit lane; shorts are dealt up like cards
    if (has('#raceRail')) gsap.from('#raceRail > li', { x: 140, opacity: 0, duration: 1.1, ease: 'expo.out', stagger: 0.07, scrollTrigger: once('#raceRail', 'top 88%') });
    if (has('#shortsRail')) gsap.from('#shortsRail > li', {
      y: 140, rotate: 8, opacity: 0, transformOrigin: '0% 100%', duration: 1.2, ease: 'expo.out', stagger: 0.06,
      scrollTrigger: once('#shortsRail', 'top 90%'),
    });

    // both rails lean into your scroll speed
    const leans = $$('.rail > li').map((el) => gsap.quickSetter(el, 'skewY', 'deg'));
    let lean = 0;
    gsap.ticker.add(() => {
      const target = clamp(KV.velocity * 0.12, -4, 4), next = lerp(lean, target, 0.12);
      if (Math.abs(next - lean) < 0.003 && Math.abs(target - next) < 0.003) return;
      lean = next;
      leans.forEach((set) => set(lean));
    });

    // episodes: thumbnail wipes up, play button spins in, image drifts with the scroll
    $$('.ep').forEach((ep) => {
      const box = $('.ep__img', ep);
      gsap.fromTo(box, { clipPath: 'inset(100% 0% 0% 0% round 12px)' }, { clipPath: 'inset(0% 0% 0% 0% round 12px)', duration: 1.4, ease: 'expo.inOut', scrollTrigger: once(ep) });
      gsap.from($('.ep__play', ep), { scale: 0, rotate: -120, duration: 0.9, delay: 0.9, ease: 'back.out(2.2)', clearProps: 'transform', scrollTrigger: once(ep) });
      gsap.fromTo($('img', box), { '--py': '-5%' }, { '--py': '5%', ease: 'none', scrollTrigger: { trigger: box, start: 'top bottom', end: 'bottom top', scrub: true } });
    });

    // karting: photos get pinned to the wall one by one, the league photo drifts, the best lap flickers on like a timing screen
    if (has('#kwall')) gsap.from('#kwall li', { y: 110, opacity: 0, scale: 0.9, duration: 1.1, ease: 'expo.out', stagger: 0.08, clearProps: 'transform,opacity', scrollTrigger: once('#kwall', 'top 88%') });
    if (has('.kleague')) gsap.fromTo('.kleague__img img', { '--ky': '-5%' }, { '--ky': '5%', ease: 'none', scrollTrigger: { trigger: '.kleague', start: 'top bottom', end: 'bottom top', scrub: true } });
    if (has('.ksplit')) gsap.from('.ksplit__seg', { scaleX: 0, duration: 0.9, ease: 'expo.out', stagger: 0.12, scrollTrigger: once('.ksplit', 'top 90%') });
    if (has('.kyears')) gsap.from('.kyears__bar', { scaleY: 0, duration: 1.1, ease: 'expo.out', stagger: 0.1, scrollTrigger: once('.kyears', 'top 85%') });
    if (has('.kleague__result')) gsap.from('.kleague__result > div', { y: 30, opacity: 0, duration: 0.9, ease: 'expo.out', stagger: 0.1, scrollTrigger: once('.kleague__result', 'top 90%') });
    if (has('.ktable')) gsap.from('.ktable tbody tr', { x: -24, opacity: 0, duration: 0.8, ease: 'expo.out', stagger: 0.08, scrollTrigger: once('.ktable', 'top 90%') });
    if (has('.kboard__best')) gsap.from('.kboard__best b', { opacity: 0, duration: 0.07, repeat: 4, yoyo: true, delay: 0.4, scrollTrigger: once('.kboard__best', 'top 85%') });
    if (has('.kteaser')) gsap.from('.kteaser__stats li', { y: 30, opacity: 0, duration: 1, ease: 'expo.out', stagger: 0.08, scrollTrigger: once('.kteaser__stats', 'top 90%') });

    // chequered flag drops in; then KV23 lights up letter by letter like the start lights… and lights out
    if (!has('.finish__big')) return;
    gsap.from('.finish__flag', { scaleY: 0, transformOrigin: '50% 0%', duration: 1, ease: 'expo.out', scrollTrigger: once('.finish', 'top 90%') });
    const letters = $$('.finish__big span');
    ScrollTrigger.create({
      ...once('.finish__big', 'top 75%'),
      onEnter: () => {
        const tl = gsap.timeline({ delay: 1 });
        letters.forEach((l, i) => tl.call(() => l.classList.add('is-lit'), null, i * 0.45));
        tl.call(() => letters.forEach((l) => l.classList.remove('is-lit')), null, letters.length * 0.45 + 0.7);
      },
    });
  }

  // number counters
  function counters() {
    const run = (el) => {
      const end = parseFloat(el.dataset.count) || 0, suffix = el.dataset.suffix || '';
      if (reduced || !hasGSAP) { el.textContent = end + suffix; return; }
      const o = { v: 0 };
      gsap.to(o, { v: end, duration: 1.8, ease: 'expo.out', onUpdate: () => (el.textContent = Math.round(o.v) + suffix) });
    };
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { run(e.target); io.unobserve(e.target); }
    }), { threshold: 0.6 });
    $$('[data-count]').forEach((el) => io.observe(el));
  }

  /* ------------------------------------------------------------------------
     Marquee band — speed & direction follow your scroll
     ------------------------------------------------------------------------ */
  function marquee() {
    const track = $('#bandTrack');
    if (!track) return;
    track.innerHTML += track.innerHTML + track.innerHTML;
    let x = 0, dir = 1, w = track.scrollWidth / 3;
    addEventListener('resize', () => (w = track.scrollWidth / 3));
    const loop = () => {
      if (Math.abs(KV.velocity) > 0.5) dir = Math.sign(KV.velocity);
      x -= (reduced ? 0 : 1.2 + Math.min(Math.abs(KV.velocity) * 0.6, 30)) * dir;
      if (x <= -w) x += w;
      if (x > 0) x -= w;
      track.style.transform = `translate3d(${x}px,0,0)`;
      requestAnimationFrame(loop);
    };
    loop();
  }

  /* ------------------------------------------------------------------------
     Racing licence — tilt, holo foil, flip
     ------------------------------------------------------------------------ */
  function licence() {
    const card = $('#licence'), wrap = $('.licence-wrap');
    if (!card || !wrap) return;
    wrap.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || drag) return; // the hover tilt is for mice; fingers drag the card instead
      const r = card.getBoundingClientRect();
      const px = clamp((e.clientX - r.left) / r.width, 0, 1), py = clamp((e.clientY - r.top) / r.height, 0, 1);
      card.classList.add('is-tilting');
      card.style.setProperty('--ry', `${(px - 0.5) * 26}deg`);
      card.style.setProperty('--rx', `${(0.5 - py) * 20}deg`);
      card.style.setProperty('--mx', `${px * 100}%`);
      card.style.setProperty('--my', `${py * 100}%`);
    });
    wrap.addEventListener('pointerleave', () => {
      card.classList.remove('is-tilting');
      card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg');
    });
    // the card's turn is kept as an angle, so a swipe can turn it either way and it always lands face-up or back-up
    let turn = 0;
    const setTurn = (deg) => {
      turn = deg;
      card.style.setProperty('--flip', `${turn}deg`);
      card.classList.toggle('is-flipped', Math.round(turn / 180) % 2 !== 0);
    };
    const flip = (dir = 1) => { card.classList.remove('is-tilting'); setTurn(turn + 180 * dir); };
    let swallowClick = false;
    card.addEventListener('click', () => { if (swallowClick) { swallowClick = false; return; } flip(); });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });

    // touch: drag sideways and the card turns under your finger; let go past ~50px and it flips over that way
    let drag = null;
    card.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    });
    card.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dy) > Math.abs(dx)) { drag = null; return; } // that's a scroll, not a swipe
        drag.moved = true;
        card.classList.add('is-dragging');
        try { card.setPointerCapture(e.pointerId); } catch (err) {}
      }
      card.style.setProperty('--ry', `${clamp(dx * 0.6, -170, 170)}deg`);
    });
    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { moved, x } = drag;
      drag = null;
      if (!moved) return; // a tap: the click handler flips it
      const dx = e.clientX - x;
      card.classList.remove('is-dragging');
      card.style.setProperty('--ry', '0deg');
      if (Math.abs(dx) > 50) flip(dx > 0 ? 1 : -1);
      swallowClick = true; setTimeout(() => (swallowClick = false), 400);
    };
    card.addEventListener('pointerup', endDrag);
    card.addEventListener('pointercancel', endDrag);
  }

  /* ------------------------------------------------------------------------
     On Track — iRacing stats board (career / 2026 toggle)
     Numbers from the iRacing profile, Sports Car, as of Oct 15, 2026.
     ------------------------------------------------------------------------ */
  const STATS = {
    career: { starts: 173, wins: 19, top5: 66, poles: 19, avgStart: 6, avgFinish: 9, laps: 1680, led: 276, inc: 5.855, winp: 10.98, top5p: 38.15, ledp: 16.43 },
    y2026: { starts: 138, wins: 14, top5: 52, poles: 13, avgStart: 7, avgFinish: 9, laps: 1445, led: 201, inc: 6.029, winp: 10.14, top5p: 37.68, ledp: 13.91 },
  };

  function statsBoard() {
    if (!has('#board')) return;
    const board = $('#board'), tabs = $$('.board__tabs button', board), pill = $('.board__pill', board);
    const fields = $$('[data-k]', board);
    const fmt = (el, v) => {
      const f = el.dataset.fmt;
      if (f === 'pct') return v.toFixed(2) + '%';
      if (f === '3dp') return v.toFixed(3);
      return Math.round(v).toLocaleString('en-US');
    };
    const show = (set, fromZero) => {
      const data = STATS[set];
      fields.forEach((el) => {
        const to = data[el.dataset.k];
        const from = fromZero ? 0 : parseFloat(el.dataset.v || to);
        el.dataset.v = to;
        if (!hasGSAP || reduced) { el.textContent = fmt(el, to); return; }
        const o = { v: from };
        gsap.to(o, { v: to, duration: fromZero ? 1.8 : 0.9, ease: 'expo.out', onUpdate: () => (el.textContent = fmt(el, o.v)) });
      });
    };
    const movePill = () => {
      const b = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
      pill.style.setProperty('--l', b.offsetLeft + 'px');
      pill.style.setProperty('--w', b.offsetWidth + 'px');
    };
    tabs.forEach((t) => t.addEventListener('click', () => {
      if (t.getAttribute('aria-selected') === 'true') return;
      tabs.forEach((x) => x.setAttribute('aria-selected', String(x === t)));
      movePill();
      board.classList.remove('is-flash'); void board.offsetWidth; board.classList.add('is-flash'); // timing-screen refresh flash
      show(t.dataset.set);
    }));
    movePill();
    addEventListener('resize', movePill);
    if (document.fonts) document.fonts.ready.then(movePill);
    fields.forEach((el) => (el.dataset.v = STATS.career[el.dataset.k]));
    new IntersectionObserver(([e], io) => { if (e.isIntersecting) { show('career', true); io.disconnect(); } }, { threshold: 0.35 }).observe(board);
  }

  /* ------------------------------------------------------------------------
     On Track — iRating history chart (SVG, draws on scroll, scrub to read)
     Points traced from the iRacing profile chart (Sports Car).
     ------------------------------------------------------------------------ */
  const IRATING = [
    ['2025-10-20', 1410], ['2025-10-28', 1120], ['2025-11-08', 1205], ['2025-11-14', 1095], ['2025-11-24', 1140],
    ['2025-12-20', 905], ['2025-12-24', 995], ['2026-01-01', 1000], ['2026-01-05', 1060], ['2026-01-18', 1175],
    ['2026-01-26', 1615], ['2026-02-22', 1440], ['2026-03-18', 1440], ['2026-03-27', 1345], ['2026-06-16', 1175],
    ['2026-06-21', 1085], ['2026-06-27', 1290], ['2026-07-02', 1485], ['2026-07-26', 1580], ['2026-08-02', 1525],
    ['2026-08-08', 1865], ['2026-08-27', 1660], ['2026-08-31', 1535], ['2026-09-10', 1720], ['2026-09-17', 1780],
    ['2026-09-21', 1565], ['2026-09-30', 1750], ['2026-10-04', 2030], ['2026-10-10', 1975], ['2026-10-15', 2037],
  ].map(([d, v]) => ({ t: new Date(d + 'T12:00:00').getTime(), v, d }));
  const IR_MARKS = [
    { d: '2025-12-20', label: 'Low · 905', dy: 26 },
    { d: '2026-08-08', label: 'Summer season +421', dy: -22 },
    { d: '2026-10-15', label: 'Class B · 2037', dy: -22, anchor: 'end' },
  ];

  function iRatingChart() {
    const plot = $('#irPlot'), svg = $('#irSvg'), tip = $('#irTip');
    if (!plot) return;
    const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const pts = IRATING;
    let geo = null, drawn = false;

    const build = () => {
      const W = plot.clientWidth, H = plot.clientHeight;
      const m = { l: 44, r: 18, t: 34, b: 30 };
      const t0 = pts[0].t, t1 = pts[pts.length - 1].t, vMin = 800, vMax = 2200;
      const x = (t) => m.l + ((t - t0) / (t1 - t0)) * (W - m.l - m.r);
      const y = (v) => m.t + (1 - (v - vMin) / (vMax - vMin)) * (H - m.t - m.b);
      const xy = pts.map((p) => [x(p.t), y(p.v)]);
      const line = xy.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join('');
      const area = `${line}L${xy[xy.length - 1][0].toFixed(1)},${H - m.b}L${xy[0][0].toFixed(1)},${H - m.b}Z`;

      let grid = '';
      for (let v = 1000; v <= 2200; v += 200) grid += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
      let axis = '';
      for (let v = 1000; v <= 2200; v += 400) axis += `<text x="${m.l - 10}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
      const months = [['2025-11-01', 'Nov'], ['2026-01-01', 'Jan 26'], ['2026-03-01', 'Mar'], ['2026-05-01', 'May'], ['2026-07-01', 'Jul'], ['2026-09-01', 'Sep']];
      const narrow = W < 520;
      months.forEach(([d, lbl], i) => {
        if (narrow && i % 2) return;
        const tx = x(new Date(d + 'T12:00:00').getTime());
        axis += `<text x="${tx}" y="${H - 8}" text-anchor="middle">${lbl}</text>`;
      });
      let marks = '';
      IR_MARKS.forEach((mk) => {
        const i = pts.findIndex((p) => p.d === mk.d);
        if (i < 0) return;
        const [a, b] = xy[i];
        const anchor = mk.anchor || (a > W * 0.75 ? 'end' : 'middle');
        marks += `<g class="ir-mark"><line x1="${a}" x2="${a}" y1="${b}" y2="${b + mk.dy * 0.6}"/><circle cx="${a}" cy="${b}" r="4"/><text x="${a + (anchor === 'end' ? 4 : 0)}" y="${b + mk.dy}" text-anchor="${anchor}">${mk.label}</text></g>`;
      });
      const dots = xy.map(([a, b]) => `<circle class="ir-pt" cx="${a}" cy="${b}" r="2.6"/>`).join('');
      const [lx, ly] = xy[xy.length - 1];

      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.innerHTML = `
        <defs><linearGradient id="irGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ff2d55" stop-opacity=".35"/><stop offset="1" stop-color="#ff2d55" stop-opacity="0"/>
        </linearGradient></defs>
        <g class="ir-grid">${grid}</g><g class="ir-axis">${axis}</g>
        <path class="ir-area" d="${area}"/><path class="ir-line" d="${line}"/>
        <g class="ir-dots">${dots}</g>
        <circle class="ir-live-ring" cx="${lx}" cy="${ly}" r="5"/><circle class="ir-live" cx="${lx}" cy="${ly}" r="5"/>
        <g class="ir-marks">${marks}</g><circle class="ir-pen" r="5" cx="${xy[0][0]}" cy="${xy[0][1]}"/>
        <line class="ir-cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}"/><circle class="ir-cursor" r="6" cx="0" cy="0"/>`;
      geo = { xy, m, W, H, t0, t1, vMin, vMax };

      const path = $('.ir-line', svg), len = path.getTotalLength();
      if (!drawn && hasGSAP && !reduced) {
        path.style.strokeDasharray = len; path.style.strokeDashoffset = len;
        $('.ir-area', svg).style.opacity = 0;
        $$('.ir-dots, .ir-marks', svg).forEach((g) => (g.style.opacity = 0));
      }
    };

    const draw = () => {
      if (drawn) return;
      drawn = true;
      if (!hasGSAP || reduced) { plot.classList.add('is-drawn'); return; }
      const path = $('.ir-line', svg), pen = $('.ir-pen', svg), len = path.getTotalLength();
      const now = $('#irNow'), when = $('#irNowDate'), finalNow = now.textContent, finalWhen = when.textContent;
      // a glowing pen draws the line, and the big number reads the iRating at its tip as it goes
      const o = { p: 0 }, chart = plot.closest('.irchart');
      let lastNow = '', lastWhen = '';
      // glows (drop-shadow / big text-shadow) are switched off while the line draws: repainting them every frame is
      // what made phones stutter here. They fade back in once the line is done.
      chart.classList.add('is-drawing');
      gsap.set(pen, { opacity: 1 });
      gsap.to(o, {
        p: 1, duration: 2.4, ease: 'power2.inOut',
        onUpdate: () => {
          const L = len * o.p, pt = path.getPointAtLength(L), g = geo;
          path.style.strokeDashoffset = len - L;
          pen.setAttribute('cx', pt.x); pen.setAttribute('cy', pt.y);
          const n = String(Math.round(g.vMin + (1 - (pt.y - g.m.t) / (g.H - g.m.t - g.m.b)) * (g.vMax - g.vMin)));
          const d = dateFmt.format(g.t0 + ((pt.x - g.m.l) / (g.W - g.m.l - g.m.r)) * (g.t1 - g.t0));
          if (n !== lastNow) now.textContent = lastNow = n; // only touch the text when it actually changes
          if (d !== lastWhen) when.textContent = lastWhen = d;
        },
        onComplete: () => {
          path.style.strokeDasharray = 'none';
          now.textContent = finalNow; when.textContent = finalWhen;
          gsap.to(pen, { opacity: 0, duration: 0.4 });
          plot.classList.add('is-drawn');
          chart.classList.remove('is-drawing');
        },
      });
      gsap.to($('.ir-area', svg), { opacity: 1, duration: 1.2, delay: 1.2 });
      gsap.to($$('.ir-dots, .ir-marks', svg), { opacity: 1, duration: 0.8, delay: 1.8, stagger: 0.2 });
    };

    const scrub = (clientX) => {
      if (!geo) return;
      const r = plot.getBoundingClientRect(), px = clientX - r.left;
      let best = 0;
      geo.xy.forEach(([a], i) => { if (Math.abs(a - px) < Math.abs(geo.xy[best][0] - px)) best = i; });
      const [a, b] = geo.xy[best];
      $('.ir-cross', svg).setAttribute('x1', a); $('.ir-cross', svg).setAttribute('x2', a);
      const c = $('.ir-cursor', svg); c.setAttribute('cx', a); c.setAttribute('cy', b);
      $('b', tip).textContent = pts[best].v;
      $('span', tip).textContent = dateFmt.format(pts[best].t);
      tip.style.left = clamp(a, 60, r.width - 60) + 'px';
      tip.style.top = b + 'px';
      plot.classList.add('is-hover');
    };
    plot.addEventListener('pointermove', (e) => scrub(e.clientX));
    plot.addEventListener('pointerdown', (e) => scrub(e.clientX));
    plot.addEventListener('pointerleave', () => plot.classList.remove('is-hover'));

    build();
    let rt;
    // only rebuild when the chart's width really changes: phones fire "resize" every time the address bar slides,
    // and rebuilding mid-draw is what made the chart hitch as you scrolled into it
    let builtW = plot.clientWidth;
    addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => { if (plot.clientWidth !== builtW) { builtW = plot.clientWidth; build(); } }, 150);
    });
    new IntersectionObserver(([e], io) => { if (e.isIntersecting) { draw(); io.disconnect(); } }, { threshold: 0.4 }).observe(plot);
  }

  /* ------------------------------------------------------------------------
     On Track — GT3 progression: every GT3 Regional Tour race, first to latest
     From the iRacing results list (2026 S4 · week 5, Imola GP, Porsche 911 GT3 R (992)); practice sessions left out.
     ------------------------------------------------------------------------ */
  const GT3_RACES = [ // date, time, start, finish, incidents, championship points, strength of field
    ['Oct 12', '8:45 PM', 13, 14, 0, 34, 3081],
    ['Oct 12', '9:45 PM', 2, 17, 20, 13, 1927],
    ['Oct 13', '7:45 PM', 1, 17, 11, 11, 1695],
    ['Oct 13', '8:45 PM', 2, 3, 2, 97, 1898],
    ['Oct 14', '6:45 PM', 2, 6, 5, 79, 1851],
    ['Oct 14', '7:45 PM', 8, 11, 13, 64, 2921],
    ['Oct 14', '8:45 PM', 7, 14, 6, 30, 2752],
    ['Oct 14', '9:45 PM', 14, 13, 1, 43, 2920],
    ['Oct 15', '6:45 PM', 1, 1, 1, 106, 1748],
    ['Oct 15', '7:45 PM', 7, 9, 5, 78, 2622],
    ['Oct 15', '9:45 PM', 7, 10, 7, 56, 2374],
  ].map(([date, time, start, fin, inc, pts, sof], i) => ({ n: i + 1, date, time, start, fin, inc, pts, sof }));

  function gt3Progression() {
    const plot = $('#gt3Plot'), svg = $('#gt3Svg'), body = $('#gt3Body');
    if (!plot) return;
    const R = GT3_RACES, worst = 20;
    const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

    // summary + table
    const avg = (k) => (R.reduce((a, r) => a + r[k], 0) / R.length).toFixed(1);
    $('#gt3Sum').innerHTML = `
      <li><b>P${Math.min(...R.map((r) => r.fin))}</b><small class="mono">Best finish</small></li>
      <li><b>${R.length}</b><small class="mono">GT3 races</small></li>
      <li><b>${R.filter((r) => r.fin <= 3).length}</b><small class="mono">Podiums</small></li>
      <li><b>${avg('start')}<i>→</i>${avg('fin')}</b><small class="mono">Avg start → finish</small></li>`;
    R.slice().reverse().forEach((r) => { // latest first in the table
      const tr = make('tr', r.fin === 1 ? 'is-win' : r.fin <= 3 ? 'is-pod' : '');
      tr.append(make('td', null, String(r.n).padStart(2, '0')));
      const when = make('th', null, `${r.date} · ${r.time}`); when.scope = 'row'; tr.append(when);
      tr.append(make('td', null, `P${r.start}`));
      const fin = make('td', 'g3-pos'); fin.append(make('i', null, r.fin < r.start ? `▲${r.start - r.fin}` : r.fin > r.start ? `▼${r.fin - r.start}` : '='), document.createTextNode(`P${r.fin}`));
      tr.append(fin, make('td', null, `${r.inc}x`), make('td', null, r.pts), make('td', null, r.sof.toLocaleString('en-US')));
      body.append(tr);
    });

    // chart: finishing position per race (P1 on top), the hollow ring is where it started
    let drawn = false, built = 0;
    const build = () => {
      const W = plot.clientWidth, H = plot.clientHeight;
      const m = { l: 34, r: 16, t: 26, b: 44 };
      const x = (i) => m.l + (i / (R.length - 1)) * (W - m.l - m.r);
      const y = (p) => m.t + ((p - 1) / (worst - 1)) * (H - m.t - m.b);
      let grid = '', axis = '';
      [1, 5, 10, 15, 20].forEach((p) => {
        grid += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(p)}" y2="${y(p)}"/>`;
        axis += `<text x="${m.l - 10}" y="${y(p) + 3}" text-anchor="end">P${p}</text>`;
      });
      // race number under every point, the day under the first race of each day
      R.forEach((r, i) => {
        axis += `<text x="${x(i)}" y="${H - 24}" text-anchor="middle">${String(r.n).padStart(2, '0')}</text>`;
        const day = i && W < 620 ? r.date.replace('Oct ', '') : r.date; // narrow: "Oct 12", then just "13", "14"…
        if (!i || R[i - 1].date !== r.date) axis += `<text class="g3-day" x="${x(i)}" y="${H - 6}" text-anchor="${i ? 'middle' : 'start'}">${day}</text>`;
      });
      const line = R.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r.fin).toFixed(1)}`).join('');
      const moves = R.map((r, i) => `<line class="g3-move" x1="${x(i)}" x2="${x(i)}" y1="${y(r.start)}" y2="${y(r.fin)}"/>`).join('');
      const starts = R.map((r, i) => `<circle class="g3-start" cx="${x(i)}" cy="${y(r.start)}" r="4.5"/>`).join('');
      const fins = R.map((r, i) => `<circle class="g3-fin${r.fin <= 3 ? ' is-pod' : ''}" cx="${x(i)}" cy="${y(r.fin)}" r="5"/>`).join('');
      const lbls = R.map((r, i) => `<text class="g3-lbl" x="${x(i)}" y="${y(r.fin) + (r.fin > 15 ? -12 : 18)}" text-anchor="middle">${r.fin}</text>`).join('');
      const wi = R.findIndex((r) => r.fin === 1);
      const win = wi < 0 ? '' : `<g class="g3-win"><circle cx="${x(wi)}" cy="${y(1)}" r="9" opacity=".25"/><text x="${x(wi)}" y="${y(1) - 14}" text-anchor="middle">First GT3 win</text></g>`;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.innerHTML = `<g class="g3-grid">${grid}</g><g class="g3-axis">${axis}</g><g class="g3-moves">${moves}</g>
        <path class="g3-line" d="${line}"/>${win}<g class="g3-starts">${starts}</g><g class="g3-fins">${fins}</g><g class="g3-lbls">${lbls}</g>`;
      built = W;
      if (!drawn && hasGSAP && !reduced) {
        const p = $('.g3-line', svg), len = p.getTotalLength();
        p.style.strokeDasharray = len; p.style.strokeDashoffset = len;
        $$('.g3-moves, .g3-starts, .g3-fins, .g3-lbls, .g3-win', svg).forEach((g) => (g.style.opacity = 0));
      }
    };
    const draw = () => {
      if (drawn) return;
      drawn = true;
      if (!hasGSAP || reduced) return;
      const p = $('.g3-line', svg);
      gsap.to(p, { strokeDashoffset: 0, duration: 2, ease: 'power2.inOut', onComplete: () => (p.style.strokeDasharray = 'none') });
      gsap.to($$('.g3-fins, .g3-starts, .g3-moves, .g3-lbls', svg), { opacity: 1, duration: 0.7, delay: 0.6, stagger: 0.15 });
      gsap.fromTo($('.g3-win', svg), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.8, delay: 1.9, ease: 'back.out(2)' });
    };
    build();
    let rt;
    addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (plot.clientWidth !== built) build(); }, 150); }); // width changes only
    new IntersectionObserver(([e], io) => { if (e.isIntersecting) { draw(); io.disconnect(); } }, { threshold: 0.4 }).observe(plot);
  }

  /* ------------------------------------------------------------------------
     Horizontal rails (races, shorts): drag with the mouse, arrow buttons
     ------------------------------------------------------------------------ */
  function rails() {
    $$('.rail').forEach((rail) => {
      let down = false, moved = false, sx = 0, sl = 0;
      rail.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        down = true; moved = false; sx = e.clientX; sl = rail.scrollLeft;
      });
      addEventListener('pointermove', (e) => {
        if (!down) return;
        const dx = e.clientX - sx;
        if (!moved && Math.abs(dx) > 6) { moved = true; rail.classList.add('is-dragging'); }
        if (moved) rail.scrollLeft = sl - dx;
      });
      addEventListener('pointerup', () => {
        if (!down) return;
        down = false;
        setTimeout(() => rail.classList.remove('is-dragging'), 0);
      });
      // a drag shouldn't count as a click on a card
      rail.addEventListener('click', (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
    });
    $$('.rail-btn').forEach((b) => b.addEventListener('click', () => {
      const rail = document.getElementById(b.dataset.rail);
      rail.scrollBy({ left: Number(b.dataset.dir) * rail.clientWidth * 0.8, behavior: reduced ? 'auto' : 'smooth' });
    }));
  }

  /* ------------------------------------------------------------------------
     Road to Racing — YouTube player modal
     ------------------------------------------------------------------------ */
  function videoModal() {
    if (!has('#vmodal')) return;
    const m = $('#vmodal'), frame = $('.vmodal__frame', m), yt = $('.vmodal__yt', m), closeBtn = $('.vmodal__close', m);
    let open = false, lastFocus = null;

    const show = (id, tall) => {
      if (!/^[\w-]{11}$/.test(id)) return;
      frame.className = 'vmodal__frame ' + (tall ? 'is-tall' : 'is-wide');
      frame.textContent = '';
      const f = document.createElement('iframe');
      f.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`;
      f.title = 'YouTube video player';
      f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      f.allowFullscreen = true;
      frame.appendChild(f);
      yt.href = tall ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`;
      open = true; lastFocus = document.activeElement;
      m.classList.add('is-open'); m.setAttribute('aria-hidden', 'false');
      document.body.classList.add('menu-open');
      if (lenis) lenis.stop();
      closeBtn.focus({ preventScroll: true });
    };
    const close = () => {
      if (!open) return;
      open = false;
      m.classList.remove('is-open'); m.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('menu-open');
      if (lenis) lenis.start();
      setTimeout(() => { if (!open) frame.textContent = ''; }, 400); // unloading the iframe stops playback
      if (lastFocus) lastFocus.focus({ preventScroll: true });
    };

    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-yt]');
      if (b) show(b.dataset.yt, b.hasAttribute('data-short'));
    });
    closeBtn.addEventListener('click', close);
    $('.vmodal__bg', m).addEventListener('click', close);
    addEventListener('keydown', (e) => { if (open && e.key === 'Escape') close(); });
  }

  /* ------------------------------------------------------------------------
     Road to Racing — step 02, rental karting stats
     Counted from the RaceFacer results page (70 sessions, Aug 23, 2022 → Oct 5, 2026).
     null = not known: that cell stays hidden
     ------------------------------------------------------------------------ */
  const KARTING = {
    wins: 35, podiums: 58, sessions: 70, points: 406, km: 405, time: '10h 34m',
    split: { p1: 35, p2: 13, p3: 10, rest: 12 },
    years: [ // sessions, wins, podiums (wins included)
      { y: 2022, s: 4, w: 0, p: 3 },
      { y: 2023, s: 14, w: 10, p: 14 },
      { y: 2024, s: 28, w: 8, p: 18, note: 'League' },
      { y: 2025, s: 5, w: 4, p: 5 },
      { y: 2026, s: 19, w: 13, p: 18 },
    ],
  };

  function kartingStats() {
    const box = $('#kartStats');
    if (!box) return;
    const cell = (label, value, opts = {}) => {
      const c = document.createElement('div'), b = document.createElement('b'), s = document.createElement('small');
      c.className = 'kcell' + (opts.hot ? ' kcell--hot' : '');
      if (opts.count) { b.dataset.count = value; b.textContent = '0'; } else b.textContent = value;
      s.textContent = label;
      c.append(b, s);
      box.append(c);
    };
    [['wins', 'Wins', true], ['podiums', 'Podiums', true], ['sessions', 'Sessions'], ['points', 'RaceFacer pts'], ['km', 'Km driven']]
      .forEach(([k, label, hot]) => KARTING[k] != null && cell(label, KARTING[k], { count: true, hot }));
    if (KARTING.time) cell('Seat time', KARTING.time);

    const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

    // finishing positions: one bar split P1 / P2 / P3 / P4+
    const split = $('#kartSplit'), sp = KARTING.split;
    if (split && sp) {
      const total = sp.p1 + sp.p2 + sp.p3 + sp.rest;
      const parts = [['p1', 'P1', sp.p1], ['p2', 'P2', sp.p2], ['p3', 'P3', sp.p3], ['rest', 'P4+', sp.rest]];
      const bar = make('div', 'ksplit__bar'), legend = make('div', 'ksplit__legend mono');
      bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', parts.map(([, l, n]) => `${l}: ${n}`).join(', ') + ` of ${total} sessions`);
      parts.forEach(([k, l, n]) => {
        const seg = make('i', `ksplit__seg ksplit__seg--${k}`); seg.style.flexGrow = n; bar.append(seg);
        const key = make('span', `ksplit__key ksplit__key--${k}`); key.append(make('b', null, n), ` ${l}`); legend.append(key);
      });
      split.append(make('p', 'mono kboard__label', `Finishing positions · ${total} sessions`), bar, legend);
    }

    // season by season: bar height = sessions, red = wins, pale = other podiums
    const years = $('#kartYears');
    if (years && KARTING.years) {
      const max = Math.max(...KARTING.years.map((d) => d.s));
      const cols = make('div', 'kyears__cols');
      KARTING.years.forEach((d) => {
        const col = make('div', 'kyears__col');
        col.setAttribute('aria-label', `${d.y}: ${d.s} sessions, ${d.w} wins, ${d.p} podiums`);
        const track = make('div', 'kyears__track'), bar = make('div', 'kyears__bar');
        bar.style.height = (d.s / max) * 100 + '%';
        [['rest', d.s - d.p], ['pod', d.p - d.w], ['win', d.w]].forEach(([k, n]) => { if (n > 0) { const s = make('i', `kyears__seg kyears__seg--${k}`); s.style.flexGrow = n; bar.append(s); } });
        bar.append(make('span', 'kyears__n mono', d.s));
        if (d.note) bar.append(make('em', 'kyears__note mono', d.note));
        track.append(bar);
        col.append(track, make('b', 'kyears__y', d.y), make('small', 'kyears__wp mono', `${d.w}W · ${d.p}P`));
        cols.append(col);
      });
      const key = make('p', 'kyears__key mono');
      key.append(make('span', 'kyears__k kyears__k--win', 'Wins'), make('span', 'kyears__k kyears__k--pod', 'Podiums'), make('span', 'kyears__k kyears__k--rest', 'Other'));
      years.append(make('p', 'mono kboard__label', 'Season by season · sessions'), cols, key);
    }
  }

  /* ------------------------------------------------------------------------
     TAG E-Karting League 2024 — night by night (Mondays: practice, qualifying, pre-final, race)
     Points: official league sheet (the final word; it includes the officials' corrections and penalties).
     Groups and timing sheets: RaceFacer session results. Average / worst laps: my own sheet (nights 1–3).
     Positions in the points table are worked out from the points (+1 point = fastest lap).
     Timing sheets: 'name laps gap best', gap L = leader, +1L = a lap down, - = timing glitch.
     Other drivers are anonymised as "Driver NN" (same number all season).
     ------------------------------------------------------------------------ */
  const LEAGUE = {
    me: 'Kiryl',
    pts: { q: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], pf: [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], f: [30, 28, 26, 24, 22, 20, 19, 18, 17, 16, 15, 14, 10, 9, 8] },
    weeks: [
      {
        date: 'Mar 18', champ: 14, me: { q: 8, pf: 14, f: 18 },
        laps: { q: [40.231, 40.878, 41.37], pf: [40.023, 40.776, 43.103], f: [41.753, 42.691, 44.996] },
        group: [['Driver 01', 10, 16, 31], ['Driver 02', 6, 10, 28], ['Driver 03', 9, 11, 24], ['Driver 04', 3, 12, 26], ['Kiryl', 8, 14, 18],
          ['Driver 05', 7, 9, 22], ['Driver 06', 5, 13, 19], ['Driver 07', 1, 8, 20], ['Driver 08', 4, 7, 17], ['Driver 09', 2, 6, 16]],
        timing: {
          p: 'Driver 07 7 L 41.219, Driver 01 7 0.003 41.222, Driver 04 6 0.131 41.350, Driver 06 7 0.334 41.553, Driver 02 7 0.456 41.675, Kiryl 7 0.535 41.754, Driver 09 7 0.826 42.045, Driver 08 7 0.829 42.048, Driver 03 7 1.270 42.489',
          q: 'Driver 01 10 L 39.941, Driver 03 10 0.270 40.211, Kiryl 10 0.290 40.231, Driver 05 10 0.456 40.397, Driver 02 9 1.114 41.055, Driver 06 10 1.324 41.265, Driver 08 10 1.622 41.563, Driver 04 10 1.634 41.575, Driver 09 10 2.354 42.295, Driver 07 10 2.549 42.490',
          pf: 'Driver 01 19 L 39.322, Kiryl 18 +1L 40.023, Driver 06 18 +1L 40.424, Driver 04 18 +1L 39.974, Driver 03 18 +1L 41.620, Driver 02 18 +1L 41.574, Driver 05 18 +1L 41.143, Driver 07 18 +1L 41.592, Driver 08 18 +1L 41.814, Driver 09 17 +2L 42.064',
          f: 'Driver 02 19 L 40.792, Driver 04 19 1.255 40.928, Driver 03 19 3.115 41.317, Driver 05 19 3.599 41.138, Driver 07 19 6.692 41.239, Driver 06 19 7.572 41.270, Kiryl 18 +1L 41.753, Driver 08 18 +1L 42.041, Driver 09 18 +1L 42.116, Driver 01 18 +1L 40.096',
        },
      },
      {
        date: 'Mar 25', champ: 17, me: { q: 1, pf: 9, f: 21 },
        laps: { q: [41.719, 49.615, 58.05], pf: [41.124, 42.248, 43.372], f: [40.199, 41.19, 42.182] },
        group: [['Driver 10', 10, 16, 28], ['Driver 11', 8, 13, 30], ['Driver 12', 7, 12, 22], ['Driver 13', 9, 14, 17], ['Driver 14', 3, 10, 26],
          ['Driver 05', 4, 11, 24], ['Kiryl', 1, 9, 21], ['Driver 15', 6, 8, 16], ['Driver 16', 0, 7, 19], ['Driver 06', 5, 5, 18], ['Driver 17', 2, 6, null]],
        timing: {
          p: 'Driver 11 7 L 41.090, Driver 10 7 0.080 41.170, Kiryl 7 0.129 41.219, Driver 12 7 0.151 41.241, Driver 13 7 0.157 41.247, Driver 16 7 0.479 41.569, Driver 14 7 0.547 41.637, Driver 05 7 1.192 42.282, Driver 15 6 2.117 43.207, Driver 17 7 2.149 43.239, Driver 06 7 3.277 44.367, Driver 18 1 - -',
          q: 'Driver 10 15 L 39.409, Driver 13 16 1.121 40.530, Driver 11 16 1.527 40.936, Driver 12 14 1.566 40.975, Driver 15 16 1.690 41.099, Driver 06 15 1.998 41.407, Driver 05 15 2.061 41.470, Driver 14 16 2.101 41.510, Driver 17 16 2.190 41.599, Kiryl 15 2.310 41.719, Driver 16 16 2.436 41.845',
          pf: 'Driver 10 20 L 39.494, Driver 13 19 +1L 40.192, Driver 11 19 +1L 41.185, Driver 12 19 +1L 40.902, Driver 05 19 +1L 41.210, Driver 14 19 +1L 40.912, Kiryl 19 +1L 41.124, Driver 15 19 +1L 42.204, Driver 16 19 +1L 41.328, Driver 17 19 +1L 42.253, Driver 06 12 +8L 42.207',
          f: 'Driver 11 18 L 40.257, Driver 10 18 4.232 40.697, Driver 14 18 4.560 40.595, Driver 05 18 4.968 40.682, Kiryl 18 5.860 40.199, Driver 16 18 9.131 40.353, Driver 13 18 16.230 41.059, Driver 15 18 27.542 41.556, Driver 12 17 +1L 40.701, Driver 06 16 +2L 41.216',
        },
      },
      {
        date: 'Apr 1', champ: 11, me: { q: 9, pf: 16, f: 26 },
        laps: { q: [40.236, 40.914, 41.79], pf: [40.867, 41.583, 45.624], f: [40.876, 41.192, 41.815] },
        group: [['Driver 19', 10, 12, 30], ['Kiryl', 9, 16, 26], ['Driver 13', 8, 13, 28], ['Driver 03', 7, 14, 19], ['Driver 06', 5, 13, 22],
          ['Driver 20', 6, 11, 20], ['Driver 21', 3, 9, 25], ['Driver 22', 2, 8, 18], ['Driver 23', 4, 7, 17], ['Driver 09', 1, 6, 16]],
        timing: {
          p: 'Driver 19 8 L 40.237, Kiryl 7 0.321 40.558, Driver 22 8 0.477 40.714, Driver 20 7 0.840 41.077, Driver 21 7 0.896 41.133, Driver 06 7 0.955 41.192, Driver 13 7 1.048 41.285, Driver 23 7 1.255 41.492, Driver 03 7 1.750 41.987, Driver 09 6 3.307 43.544',
          q: 'Driver 19 9 L 40.140, Kiryl 10 0.096 40.236, Driver 13 10 0.219 40.359, Driver 03 10 0.817 40.957, Driver 20 10 0.878 41.018, Driver 06 10 0.997 41.137, Driver 23 10 1.128 41.268, Driver 21 10 1.169 41.309, Driver 22 10 1.277 41.417, Driver 09 9 3.805 43.945',
          pf: 'Kiryl 16 L 40.867, Driver 03 15 +1L 40.991, Driver 06 17 2.995 40.708, Driver 19 17 - 41.044, Driver 20 14 +2L 41.094, Driver 13 17 - 41.140, Driver 21 17 4.055 40.988, Driver 22 17 1.680 40.941, Driver 23 17 9.086 41.056, Driver 09 17 18.978 42.849',
          f: 'Driver 19 17 L 40.022, Driver 13 17 6.076 40.426, Kiryl 17 8.260 40.876, Driver 21 17 10.798 40.522, Driver 20 17 10.347 41.031, Driver 22 17 14.111 40.666, Driver 06 17 22.828 40.442, Driver 23 17 23.459 40.780, Driver 03 17 24.942 41.085, Driver 09 16 +1L 42.045',
        },
      },
      {
        date: 'Apr 8', champ: 12, me: { q: 8, pf: 13, f: 22 }, laps: { q: [40.195], pf: [40.364], f: [39.865] },
        group: [['Driver 19', 10, 16, 28], ['Driver 24', 9, 12, 30], ['Driver 10', 6, 14, 26], ['Kiryl', 8, 13, 22], ['Driver 22', 7, 11, 24],
          ['Driver 25', 5, 10, 20], ['Driver 15', 3, 9, 19], ['Driver 08', 4, 8, 18]],
        timing: {
          p: 'Driver 19 7 L 40.606, Driver 24 7 0.072 40.678, Driver 12 8 0.297 40.903, Kiryl 7 0.334 40.940, Driver 26 7 0.517 41.123, Driver 22 7 0.523 41.129, Driver 25 7 0.930 41.536, Driver 10 7 1.058 41.664, Driver 15 7 1.595 42.201, Driver 08 7 3.024 43.630',
          q: 'Driver 19 10 L 39.591, Driver 24 10 0.515 40.106, Kiryl 10 0.604 40.195, Driver 22 10 0.728 40.319, Driver 10 8 0.751 40.342, Driver 25 10 0.840 40.431, Driver 08 10 2.074 41.665, Driver 15 10 2.712 42.303',
          pf: 'Driver 10 21 L 39.891, Kiryl 21 2.334 40.364, Driver 24 21 3.071 40.553, Driver 19 20 +1L 39.837, Driver 22 20 +1L 41.025, Driver 25 20 +1L 41.448, Driver 15 20 +1L 42.081, Driver 08 20 +1L 41.982',
          f: 'Driver 24 18 L 39.659, Driver 19 18 2.927 40.313, Driver 10 18 5.371 39.873, Driver 22 18 5.635 40.072, Kiryl 18 8.368 39.865, Driver 25 18 23.855 40.924, Driver 15 17 +1L 41.784, Driver 08 17 +1L 41.246',
        },
      },
      {
        date: 'Apr 15', champ: 13, me: { q: 5, pf: 9, f: 20 }, laps: { q: [40.99], pf: [41.027], f: [40.048] },
        group: [['Driver 04', 10, 15, 30], ['Driver 27', 9, 15, 28], ['Driver 28', 7, 11, 26], ['Driver 06', 8, 13, 17], ['Driver 02', 6, 12, 19], ['Driver 23', 4, 8, 23],
          ['Driver 22', 1, 10, 24], ['Kiryl', 5, 9, 20], ['Driver 03', 3, 7, 18], ['Driver 25', 2, 6, 15], ['Driver 08', 0, 5, 16]],
        timing: {
          p: 'Driver 27 7 L 41.272, Driver 28 7 0.263 41.535, Kiryl 7 0.307 41.579, Driver 23 7 0.307 41.579, Driver 25 7 0.331 41.603, Driver 06 6 0.336 41.608, Driver 08 7 0.382 41.654, Driver 04 7 0.821 42.093, Driver 03 7 0.827 42.099, Driver 02 7 1.268 42.540, Driver 22 2 18.161 59.433',
          q: 'Driver 04 9 L 39.830, Driver 27 10 0.664 40.494, Driver 06 10 0.742 40.572, Driver 28 10 1.019 40.849, Driver 02 10 1.053 40.883, Kiryl 10 1.160 40.990, Driver 23 9 1.240 41.070, Driver 03 10 1.368 41.198, Driver 25 10 1.560 41.390, Driver 22 10 1.595 41.425, Driver 08 9 1.890 41.720',
          pf: 'Driver 04 18 L 40.196, Driver 27 18 0.744 40.036, Driver 06 18 1.083 40.544, Driver 02 18 6.038 40.688, Driver 28 18 6.759 40.446, Driver 22 18 18.346 40.981, Kiryl 18 19.857 41.027, Driver 23 18 22.992 40.977, Driver 03 17 +1L 40.849, Driver 25 17 +1L 41.018, Driver 08 17 +1L 42.242',
          f: 'Driver 04 19 L 40.249, Driver 27 19 7.249 40.879, Driver 22 19 7.833 40.962, Driver 23 19 8.223 39.708, Driver 28 19 9.066 40.798, Kiryl 19 15.625 40.048, Driver 02 19 16.885 40.144, Driver 03 18 +1L 40.951, Driver 06 18 +1L 41.115, Driver 08 18 +1L 41.234',
        },
      },
    ],
  };

  function leagueNights() {
    const tabsBox = $('#knightsTabs'), body = $('#knightsBody');
    if (!tabsBox || !body) return;
    const { pts, weeks, me } = LEAGUE;
    const ROUNDS = [['q', 'Qualifying'], ['pf', 'Pre-final'], ['f', 'Final']];
    const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const lap = (v) => v.toFixed(3);

    // a fastest lap is only certain when the score can't come from a position alone (16, 21, 25, 31…)
    const isFL = (k, v) => k !== 'q' && !pts[k].includes(v) && pts[k].includes(v - 1);
    // place everyone in a round by points
    const placeGroup = (rows) => {
      ROUNDS.forEach(([k]) => {
        rows.filter((r) => r[k] != null).sort((a, b) => b[k] - a[k]).forEach((r, i) => {
          r.pos[k] = i + 1;
          r.fl[k] = isFL(k, r[k]);
        });
      });
      rows.forEach((r) => (r.total = (r.q || 0) + (r.pf || 0) + (r.f || 0)));
      rows.sort((a, b) => b.total - a.total).forEach((r, i) => (r.rank = i + 1));
      return rows;
    };
    // nights without a group sheet: read my position straight off the points table
    const decode = (k, v) => {
      const i = pts[k].indexOf(v);
      if (i >= 0) return { pos: i + 1, fl: false };
      const j = pts[k].indexOf(v - 1);
      return j >= 0 && k !== 'q' ? { pos: j + 1, fl: true } : { pos: null, fl: false };
    };

    // RaceFacer timing sheet for one session of the night: on-track order, laps, gap, best lap
    const SESSIONS = [['p', 'Practice'], ['q', 'Qualifying'], ['pf', 'Pre-final'], ['f', 'Race']];
    let session = 'f';
    const gapText = (g) => (g === 'L' ? 'Leader' : g === '-' ? '—' : /^\+\d+L$/.test(g) ? `+${g.slice(1, -1)} lap${g === '+1L' ? '' : 's'}` : `+${g}`);
    const timingTable = (holder, w) => {
      const rows = w.timing[session].split(', ').map((r) => {
        const t = r.split(' '), best = t.pop(), gap = t.pop(), laps = t.pop(); // the name is whatever is left ("Driver 07")
        return { name: t.join(' '), laps, gap, best: best === '-' ? null : +best };
      });
      const fastest = Math.min(...rows.filter((r) => r.best).map((r) => r.best));
      const race = session === 'pf' || session === 'f';
      const table = make('table', 'kgroup ktiming__table');
      const head = make('tr');
      ['#', 'Driver', 'Laps', race ? 'Gap' : 'To P1', 'Best lap'].forEach((h) => { const th = make('th', null, h); th.scope = 'col'; head.append(th); });
      const thead = make('thead'); thead.append(head);
      const tbody = make('tbody');
      rows.forEach((r, i) => {
        const tr = make('tr', r.name === me ? 'is-me' : '');
        tr.append(make('td', 'kgroup__rank', i + 1));
        const name = make('th', null, r.name); name.scope = 'row'; tr.append(name);
        tr.append(make('td', null, r.laps), make('td', 'ktiming__gap', gapText(r.gap)));
        const best = make('td', 'ktiming__best', r.best ? lap(r.best) : '—');
        if (r.best === fastest) { best.classList.add('is-fl'); best.title = 'Fastest lap of the session'; }
        tr.append(best);
        tbody.append(tr);
      });
      table.append(thead, tbody);
      const note = make('p', 'mono ktiming__note', race
        ? 'Order on track at the flag. The official result can differ after the officials’ corrections and penalties: the points table above is the final word.'
        : 'Ranked by best lap.');
      holder.textContent = '';
      holder.append(table, note);
      if (hasGSAP && !reduced) gsap.fromTo($$('tbody tr', table), { x: -12, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45, ease: 'expo.out', stagger: 0.025 });
    };

    const render = (wi) => {
      const w = weeks[wi];
      const rows = w.group ? placeGroup(w.group.map(([name, q, pf, f]) => ({ name, q, pf, f, pos: {}, fl: {} }))) : null;
      const mine = rows ? rows.find((r) => r.name === me) : null;
      const total = w.me.q + w.me.pf + w.me.f;
      const bestOfNight = Math.min(...ROUNDS.map(([k]) => w.laps[k][0]));
      body.textContent = '';

      // left: my three rounds
      const side = make('div', 'knights__me');
      const tiles = make('div', 'knights__rounds');
      ROUNDS.forEach(([k, label]) => {
        const p = mine ? { pos: mine.pos[k], fl: mine.fl[k] } : decode(k, w.me[k]);
        const t = make('div', 'kround');
        t.append(make('small', 'mono', label));
        const big = make('b', 'kround__pos', p.pos ? `P${p.pos}` : '—');
        if (p.fl) { const fl = make('i', 'fl-dot'); fl.title = 'Fastest lap'; big.append(fl); }
        t.append(big, make('span', 'kround__pts mono', `${w.me[k]} pts`));
        const [best, avg, worst] = w.laps[k];
        const l = make('span', 'kround__lap mono' + (best === bestOfNight ? ' is-best' : ''), `best ${lap(best)}`);
        t.append(l);
        if (avg != null) t.append(make('span', 'kround__range mono', `avg ${lap(avg)} · worst ${lap(worst)}`));
        tiles.append(t);
      });
      const sum = make('div', 'knights__sum');
      [[`${total}`, 'points on the night'], [mine ? `P${mine.rank}` : '—', mine ? `in my group of ${rows.length}` : 'group not recorded'], [`P${w.champ}`, 'championship after']]
        .forEach(([v, l]) => { const d = make('div'); d.append(make('b', null, v), make('small', 'mono', l)); sum.append(d); });
      side.append(tiles, sum);

      // right: the whole group, like the sheet
      const right = make('div', 'knights__group');
      if (rows) {
        const table = make('table', 'kgroup');
        table.append(make('caption', 'mono', `My group · week ${wi + 1} · ranked by points on the night`));
        const head = make('tr');
        ['#', 'Driver', 'Qualif', 'Pre-final', 'Final', 'Pts'].forEach((h) => { const th = make('th', null, h); th.scope = 'col'; head.append(th); });
        const thead = make('thead'); thead.append(head);
        const tbody = make('tbody');
        rows.forEach((r) => {
          const tr = make('tr', r.name === me ? 'is-me' : '');
          tr.append(make('td', 'kgroup__rank', r.rank));
          const name = make('th', null, r.name); name.scope = 'row'; tr.append(name);
          ROUNDS.forEach(([k]) => {
            const td = make('td');
            if (r[k] == null) td.append(make('span', 'kgroup__dns', 'DNS'));
            else {
              td.append(make('b', null, r[k]), make('sup', 'mono', `P${r.pos[k]}`));
              if (r.fl[k]) { td.classList.add('is-fl'); td.title = 'Fastest lap'; }
            }
            tr.append(td);
          });
          tr.append(make('td', 'kgroup__total', r.total));
          tbody.append(tr);
        });
        table.append(thead, tbody);
        right.append(table);
      } else {
        const empty = make('div', 'knights__empty');
        empty.append(make('b', null, 'No group sheet for this night'), make('p', null, 'My positions here are read from the official points and the RaceFacer timing.'));
        right.append(empty);
      }

      body.append(side, right);
      if (w.timing) {
        const box = make('div', 'ktiming');
        const head = make('div', 'ktiming__head');
        head.append(make('p', 'mono ktiming__label', 'Timing sheets · RaceFacer'));
        const stabs = make('div', 'ktiming__tabs');
        stabs.setAttribute('role', 'tablist');
        stabs.setAttribute('aria-label', 'Session');
        const holder = make('div', 'ktiming__holder');
        SESSIONS.forEach(([k, label]) => {
          const b = make('button', null, label);
          b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(k === session));
          b.addEventListener('click', () => {
            session = k;
            $$('button', stabs).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
            timingTable(holder, w);
          });
          stabs.append(b);
        });
        head.append(stabs);
        box.append(head, holder);
        timingTable(holder, w);
        body.append(box);
      }
      if (hasGSAP && !reduced) {
        gsap.fromTo(body.children, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'expo.out', stagger: 0.08 });
        gsap.fromTo($$('.kgroup tbody tr', body), { x: -14, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: 'expo.out', stagger: 0.03, delay: 0.1 });
      }
    };

    weeks.forEach((w, i) => {
      const b = make('button');
      b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(i === 0));
      b.append(make('b', null, `Week ${i + 1}`), make('small', 'mono', w.date));
      b.addEventListener('click', () => {
        if (b.getAttribute('aria-selected') === 'true') return;
        $$('button', tabsBox).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
        render(i);
      });
      tabsBox.append(b);
    });
    render(0);
  }

  /* ------------------------------------------------------------------------
     Road to Racing — latest episodes & Shorts from data/youtube.json
     (written by scripts/update-youtube.ps1; the cards in the HTML stay as the fallback)
     ------------------------------------------------------------------------ */
  function youtubeFeed() {
    if (!has('#shortsRail') && !has('.episodes')) return Promise.resolve();
    const load = fetch('data/youtube.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && renderYouTube(d))
      .catch(() => {});
    return Promise.race([load, new Promise((r) => setTimeout(r, 4000))]); // never hold up the intro
  }

  function renderYouTube(data) {
    const isId = (id) => /^[\w-]{11}$/.test(id);
    const safeSrc = (s) => (/^(assets\/|https:\/\/i\.ytimg\.com\/)/.test(s) ? s : '');
    const views = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
    const isNew = (list, v) => v === list[0] && Date.now() - new Date(v.published).getTime() < 7 * 864e5; // only the latest, if it's this week's
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const img = (src, w, h, alt) => { const i = el('img'); i.src = src; i.width = w; i.height = h; i.loading = 'lazy'; i.decoding = 'async'; i.alt = alt; return i; };

    const eps = (data.episodes || []).filter((v) => isId(v.id) && safeSrc(v.thumb));
    if (eps.length) {
      const box = $('.episodes');
      box.textContent = '';
      eps.forEach((v) => {
        const b = el('button', 'ep');
        b.type = 'button'; b.dataset.yt = v.id; b.setAttribute('data-reveal', '');
        const frame = el('span', 'ep__img');
        frame.append(img(safeSrc(v.thumb), 960, 540, `Thumbnail: ${v.title}`), el('i', 'ep__play'));
        frame.lastChild.setAttribute('aria-hidden', 'true');
        if (v.duration) frame.append(el('span', 'mono ep__dur', v.duration));
        if (isNew(eps, v)) frame.append(el('span', 'mono ep__new', 'New'));
        const no = `Road to Racing · Episode ${String(v.no).padStart(2, '0')}` + (v.views ? ` · ${views.format(v.views)} views` : '');
        b.append(frame, el('span', 'mono ep__no', no), el('b', 'ep__title', v.title));
        box.append(b);
      });
    }

    const shorts = (data.shorts || []).filter((v) => isId(v.id) && safeSrc(v.thumb));
    if (shorts.length) {
      const rail = $('#shortsRail'), more = $('.short-more', rail);
      rail.textContent = '';
      shorts.forEach((v) => {
        const li = el('li'), b = el('button', 'short');
        b.type = 'button'; b.dataset.yt = v.id; b.dataset.short = '';
        b.append(img(safeSrc(v.thumb), 540, 960, ''), el('b', null, v.title));
        if (v.views) b.append(el('small', 'mono short__views', `${views.format(v.views)} views`));
        if (isNew(shorts, v)) b.append(el('span', 'mono short__new', 'New'));
        li.append(b);
        rail.append(li);
      });
      if (more) rail.append(more);
      $('.shorts__head p').textContent = 'Shorts · latest from YouTube';
    }
  }

  /* ------------------------------------------------------------------------
     Header + menu + anchors
     ------------------------------------------------------------------------ */
  function navigation() {
    const header = $('#header'), menu = $('#menu'), btn = $('#menuBtn');
    let open = false;
    const setMenu = (v) => {
      open = v;
      menu.classList.toggle('is-open', v);
      menu.setAttribute('aria-hidden', String(!v));
      btn.setAttribute('aria-expanded', String(v));
      document.body.classList.toggle('menu-open', v);
      if (lenis) v ? lenis.stop() : lenis.start();
    };
    btn.addEventListener('click', () => setMenu(!open));
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) setMenu(false); });

    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute('href');
      if (id === '#') { e.preventDefault(); return; }
      const target = $(id);
      if (!target) return;
      e.preventDefault();
      if (open) setMenu(false);
      if (getComputedStyle(target).position === 'fixed') {
        target.classList.remove('ping'); void target.offsetWidth; target.classList.add('ping');
        return;
      }
      scrollToTarget(id === '#top' ? 0 : target, { duration: open ? 1.2 : 1.6 });
    });

    // hide header when driving down, show when braking/reversing
    let lastY = scrollY;
    addEventListener('scroll', () => {
      const y = scrollY;
      if (!open) header.classList.toggle('is-hidden', y > 300 && y > lastY + 2);
      if (y < lastY - 2 || y < 300) header.classList.remove('is-hidden');
      lastY = y;
    }, { passive: true });

    if (has('#year')) $('#year').textContent = new Date().getFullYear();
  }

  /* ------------------------------------------------------------------------
     Terrain lines: contour "hills" and long flowing lines (drawn by backdrop())
     ------------------------------------------------------------------------ */
  function contourPaths(w, h, seed = 23, oy = 0) { // oy: shifts this stretch of terrain down the page
    // deterministic pseudo-random so the "terrain" is the same on every visit
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const smooth = (pts, closed) => {
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const n = pts.length;
      let m = closed ? mid(pts[n - 1], pts[0]) : pts[0];
      let d = `M${m[0].toFixed(0)},${m[1].toFixed(0)}`; // whole pixels: plenty for a background, half the markup
      for (let i = 0; i < (closed ? n : n - 1); i++) {
        const p = pts[i], q = mid(p, pts[(i + 1) % n]);
        d += `Q${p[0].toFixed(0)},${p[1].toFixed(0)} ${q[0].toFixed(0)},${q[1].toFixed(0)}`;
      }
      return d + (closed ? 'Z' : '');
    };
    let d = '';
    // concentric "hills"
    for (let cx = rnd() * 300; cx < w + 300; cx += 520 + rnd() * 360) {
      const cy = h * (0.1 + rnd() * 0.8), rings = 5 + Math.floor(rnd() * 5);
      const p1 = rnd() * 6.28, p2 = rnd() * 6.28, p3 = rnd() * 6.28, base = 40 + rnd() * 30;
      for (let i = 1; i <= rings; i++) {
        const r = i * base, pts = [];
        for (let k = 0; k < 48; k++) {
          const t = (k / 48) * Math.PI * 2;
          const rr = r * (1 + 0.2 * Math.sin(2 * t + p1) + 0.1 * Math.sin(3 * t + p2) + 0.06 * Math.sin(5 * t + p3) * (i / rings));
          pts.push([cx + Math.cos(t) * rr * 1.35, oy + cy + Math.sin(t) * rr]);
        }
        d += smooth(pts, true);
      }
    }
    // long flowing lines between the hills
    for (let j = 0; j < 6; j++) {
      const y0 = h * (j + 0.5) / 6, a = 40 + rnd() * 50, f = 260 + rnd() * 200, ph = rnd() * 6.28, pts = [];
      for (let x = -50; x <= w + 50; x += 60) pts.push([x, oy + y0 + a * Math.sin(x / f + ph) + a * 0.4 * Math.sin(x / (f * 0.37) + ph * 2)]);
      d += smooth(pts, false);
    }
    return d;
  }

  /* ------------------------------------------------------------------------
     Evolution — vertical scroll drives a sideways photo collage
     ------------------------------------------------------------------------ */
  function evolution() {
    const evo = $('#evo'), track = $('#evoTrack');
    if (!evo) return;
    const floaters = $$('[data-speed]', track);
    const items = $$('.evo__item', track);
    const hint = $('.evo__hint', evo), sign = $('.evo__sign', evo);
    // the gallery always rides the vertical scroll (phones included): it only moves when you scroll, so it stays on
    // even with "reduce motion" switched on; only the decorative camera sway is dropped then
    const pinned = true;
    let centers = [], lay = [], dist = 0, pin = null, bend = 0, lastS = NaN;

    // the corners are wide, sweeping curves (up to 1.5 screens of scroll to turn), not a tight flick.
    // The track is sized around them: extra run-in (--lead) so the first photos still reach centre stage once the
    // turn is done, and a run-out timed so "To be continued" sits fully on screen while the gallery starts to rise
    const outro = $('.evo__outro', track);
    const measure = () => {
      const W = innerWidth, H = innerHeight;
      const B = pin ? Math.min(H * 1.5, W * 2.2) : 0;
      track.style.setProperty('--lead', (pin ? Math.max(0, Math.round(B - H * 0.6)) : 0) + 'px');
      if (pin) {
        const last = items[items.length - 1], outroLeft = Math.round(last.offsetLeft + last.offsetWidth + W * 0.12);
        const u = Math.sqrt(0.6 * B * H); // scroll into the turn-out at which the gallery has risen 15% of the screen
        const run = Math.round(outroLeft - W * 0.12 + B - u + H * 0.15); // …and the outro is 12% in from the left then
        track.style.width = run + W + 'px';
        outro.style.left = outroLeft + 'px';
      }
      dist = Math.max(0, track.offsetWidth - W);
      centers = floaters.map((el) => el.offsetLeft + el.offsetWidth / 2);
      if (pin) {
        pin.style.height = evo.offsetHeight + dist + 'px';
        bend = Math.min(B, dist * 0.45); // length of the curve into / out of the sideways run
        lastS = NaN;
      }
      // lay each photo along the camera's diagonal, so it sits at its designed height the moment it's centred
      lay = floaters.map((el, i) => (pin ? DIVE * glide(clamp(centers[i] - innerWidth / 2, 0, dist)) : 0));
    };

    // s = how far the page has scrolled past the top of the pin zone.
    // Instead of stopping dead and then going sideways, the vertical motion eases out while the
    // sideways motion eases in (and the reverse on the way out), so the scroll turns the corner:
    // ↓ ↘ → → → ↘ ↓. Every scrolled pixel is spent either down or sideways, so the speed never drops.
    const screenTop = (s) => { // where the gallery's top edge sits on screen
      if (s <= -bend) return -s;
      if (s < bend) return (bend - s) ** 2 / (4 * bend);
      if (s <= dist - bend) return 0;
      if (s < dist + bend) return -((s - dist + bend) ** 2) / (4 * bend);
      return dist - s;
    };
    const trackX = (s) => clamp(-(s + screenTop(s)), -dist, 0);

    // the camera: on the straight it travels down-right at 330° (the scene slides up-left), easing into
    // and out of that slope, and drifts up and down in a slow, gentle wave on top of it.
    // The photos move as one, over the page's own terrain lines, which keep scrolling up behind them.
    const DIVE = Math.tan(Math.PI / 6); // 30° below horizontal: sinks 0.58px per px travelled
    const glide = (u) => { // the slope's run after u px of sideways travel (eases from flat to 1:1 and back)
      const r = bend || 1, ease = (t) => r * (t ** 3 - t ** 4 / 2); // integral of a smoothstep ramp
      if (u <= 0) return 0;
      if (u >= dist) return dist - r;
      if (u < r) return ease(u / r);
      if (u > dist - r) return dist - r - ease((dist - u) / r);
      return u - r / 2;
    };
    const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
    const camera = (s) => {
      // phones: no sway. On a narrow screen the swell repeats every few hundred px of scroll and reads as bobbing
      if (reduced || innerWidth < 760) return 0;
      const b = bend || 1, amp = Math.min(innerHeight * 0.025, 20), len = innerWidth * 1.2; // one swell per ~1.2 screens of travel
      return amp * Math.sin((s / len) * Math.PI * 2) * smoothstep(s / b) * smoothstep((dist - s) / b); // flat through the corners
    };
    let wasNear = true;

    const tick = () => {
      const s = -pin.getBoundingClientRect().top;
      if (s === lastS) return;
      const near = s > -innerHeight && s < dist + innerHeight;
      if (!near && !wasNear) return; // off screen: leave it as it was left
      lastS = s; wasNear = near;
      // position: sticky holds the gallery for the straight part; the transform only bends the corners
      const stuck = Math.max(-s, Math.min(0, dist - s));
      evo.style.transform = `translate3d(0,${(screenTop(s) - stuck).toFixed(2)}px,0)`;
      const x = trackX(s), y = -DIVE * glide(-x) + camera(s);
      track.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0)`;
      update(x);
    };

    // x = how far the track has moved (≤ 0), y = camera height
    const update = (x) => {
      const mid = innerWidth / 2;
      floaters.forEach((el, i) => {
        const dx = centers[i] + x - mid;
        const speed = parseFloat(el.dataset.speed) || 1;
        el.style.transform = `translate3d(${(dx * (speed - 1)).toFixed(1)}px,${(lay[i] || 0).toFixed(1)}px,0)`; // depth: faster/slower than the track
        if (el.classList.contains('evo__item')) el.style.setProperty('--focus', clamp(1 - Math.abs(dx) / (innerWidth * 0.5), 0, 1).toFixed(3));
      });
      hint.style.opacity = dist && -x / dist > 0.03 ? 0 : '';
    };

    new IntersectionObserver(([e], io) => { if (e.isIntersecting) { sign.classList.add('is-signed'); io.disconnect(); } }, { threshold: 0.6 }).observe(sign);

    if (pinned) {
      // a tall wrapper gives the sideways run its scroll length; the gallery sticks inside it
      pin = document.createElement('div');
      pin.className = 'evo-pin';
      evo.before(pin);
      pin.appendChild(evo);
      evo.classList.add('is-pinned');
    }
    measure();
    if (pinned) {
      if (window.ScrollTrigger) ScrollTrigger.addEventListener('refreshInit', measure);
      else addEventListener('resize', measure);
      if (hasGSAP) gsap.ticker.add(tick); // runs after Lenis moves the page, so nothing lags a frame
      else { const loop = () => { tick(); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
    } else {
      evo.addEventListener('scroll', () => update(-evo.scrollLeft), { passive: true });
      addEventListener('resize', () => { measure(); update(-evo.scrollLeft); });
    }
    update(0);
    lightbox(items);
  }

  function lightbox(items) {
    const lb = $('#lightbox'), img = $('img', lb), stage = $('.lightbox__stage', lb), h3 = $('h3', lb), ul = $('ul', lb), count = $('.lightbox__count', lb);
    const pad = (n) => String(n).padStart(2, '0');
    const data = items.map((it) => ({
      src: $('img', it).getAttribute('src'),
      alt: $('img', it).alt,
      stage: [...$('.evo__cap', it).childNodes].filter((n) => !(n.classList && n.classList.contains('evo__live'))).map((n) => n.textContent).join('').trim(),
      title: $('.evo__spec h3', it).textContent,
      list: $$('.evo__spec li', it).map((li) => li.textContent),
    }));
    let idx = 0, open = false, lastFocus = null;

    const fillIn = (i) => {
      const d = data[i];
      img.src = d.src; img.alt = d.alt;
      stage.textContent = d.stage; h3.textContent = d.title;
      ul.textContent = '';
      d.list.forEach((t) => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
      count.textContent = `${pad(i + 1)} / ${pad(data.length)}`;
    };

    const show = (i, fromEl) => {
      idx = (i + data.length) % data.length;
      fillIn(idx);
      if (!open) {
        open = true; lastFocus = document.activeElement;
        lb.classList.add('is-open'); lb.setAttribute('aria-hidden', 'false');
        document.body.classList.add('menu-open');
        if (lenis) lenis.stop();
        $('.lightbox__close', lb).focus({ preventScroll: true });
        // FLIP: grow the photo out of its thumbnail
        if (fromEl && hasGSAP && !reduced) {
          gsap.set(img, { clearProps: 'all' });
          (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(() => {
            const a = fromEl.getBoundingClientRect(), b = img.getBoundingClientRect();
            gsap.from(img, { x: a.left - b.left, y: a.top - b.top, scaleX: a.width / b.width, scaleY: a.height / b.height, transformOrigin: '0 0', duration: 0.9, ease: 'expo.out' });
          });
        }
      } else if (hasGSAP && !reduced) {
        gsap.fromTo(img, { opacity: 0, x: 40 }, { opacity: 1, x: 0, duration: 0.6, ease: 'expo.out' });
      }
    };
    const close = () => {
      if (!open) return;
      open = false;
      lb.classList.remove('is-open'); lb.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('menu-open');
      if (lenis) lenis.start();
      if (lastFocus) lastFocus.focus({ preventScroll: true });
    };

    items.forEach((it, i) => $('.evo__img', it).addEventListener('click', (e) => show(i, e.currentTarget)));
    $('.lightbox__prev', lb).addEventListener('click', () => show(idx - 1));
    $('.lightbox__next', lb).addEventListener('click', () => show(idx + 1));
    $('.lightbox__close', lb).addEventListener('click', close);
    $('.lightbox__bg', lb).addEventListener('click', close);
    addEventListener('keydown', (e) => {
      if (!open) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') show(idx + 1);
      else if (e.key === 'ArrowLeft') show(idx - 1);
    });
  }

  /* ------------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------------ */
  backdrop();
  navigation();
  marquee();
  licence();
  statsBoard();
  iRatingChart();
  gt3Progression();
  rails();
  videoModal();
  kartingStats(); // before counters(), which picks up its [data-count] cells
  leagueNights();
  counters();

  Promise.all([runLoader(), youtubeFeed()]).then(() => {
    evolution(); // creates its pin first so every trigger below it accounts for the pin spacing
    intro();
    scrollAnimations();
    if (window.ScrollTrigger) ScrollTrigger.refresh();
    // arriving with a #section (e.g. karting.html → index.html#partners): land on it once the layout is final,
    // i.e. after the web fonts (which change heading heights) and the page have loaded
    const hash = location.hash && location.hash.length > 1 ? location.hash : null;
    if (hash && /^#[\w-]+$/.test(hash) && has(hash)) {
      const land = () => {
        if (window.ScrollTrigger) ScrollTrigger.refresh();
        if (lenis) lenis.resize(); // Lenis still has the pre-pin page height and would stop short of the section
        scrollToTarget(hash, { immediate: true, duration: 0, force: true });
      };
      land();
      Promise.all([
        document.fonts ? document.fonts.ready : Promise.resolve(),
        new Promise((r) => (document.readyState === 'complete' ? r() : addEventListener('load', r, { once: true }))),
      ]).then(() => requestAnimationFrame(land));
    }
  });
})();
