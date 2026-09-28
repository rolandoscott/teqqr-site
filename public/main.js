/*
 * teqqr: site behaviour.
 *
 * Everything here is progressive enhancement: the pages are fully readable
 * without JavaScript. Styling lives in style.css; this file only toggles
 * classes/ARIA state and writes the few values that have to be computed at
 * runtime (parallax offsets, progress widths).
 */
(function () {
  "use strict";

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hasIO = "IntersectionObserver" in window;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ---- shared, rAF-throttled scroll + resize dispatch ------------------ */
  const scrollFns = [];
  const resizeFns = [];
  let scrollQueued = false;
  window.addEventListener("scroll", () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => { scrollQueued = false; scrollFns.forEach(fn => fn()); });
  }, { passive: true });
  window.addEventListener("resize", () => { resizeFns.forEach(fn => fn()); scrollFns.forEach(fn => fn()); });

  /* ---- header: scroll progress + light/dark inversion ------------------ */
  function setupHeader() {
    const header = $("[data-header]");
    if (!header) return;
    const bar = $("[data-progress]", header);
    const hero = $("[data-hero]");
    const invert = header.hasAttribute("data-header-invert") && hero;

    scrollFns.push(() => {
      if (bar) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const pct = max > 0 ? Math.min(1, window.scrollY / max) : 0;
        bar.style.width = (pct * 100).toFixed(2) + "%";
      }
      if (invert) header.classList.toggle("site-header--light", hero.getBoundingClientRect().bottom < 64);
    });
  }

  /* ---- scroll reveal --------------------------------------------------- */
  function setupReveal() {
    const items = $$("[data-reveal]");
    if (!items.length || reduced || !hasIO) return;

    const dirClass = { left: "reveal--left", right: "reveal--right" };
    const cleanup = el => {
      el.classList.remove("reveal", "reveal--up", "reveal--left", "reveal--right", "is-visible");
      el.style.transitionDelay = "";
    };
    const show = (el, delay) => {
      el.style.transitionDelay = delay + "ms";
      el.classList.add("is-visible");
      // drop the reveal classes once done so hover transforms work normally
      setTimeout(() => cleanup(el), 800 + delay);
    };

    items.forEach(el => el.classList.add("reveal", dirClass[el.dataset.reveal] || "reveal--up"));

    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        const el = e.target;
        const siblings = $$(":scope > [data-reveal]", el.parentElement);
        show(el, Math.max(0, siblings.indexOf(el)) * 70);
        io.unobserve(el);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    items.forEach(el => io.observe(el));

    // safety net: never leave content hidden
    setTimeout(() => items.forEach(el => {
      if (el.classList.contains("reveal") && !el.classList.contains("is-visible")) { io.unobserve(el); show(el, 0); }
    }), 4000);
  }

  /* ---- section rules that draw in from the left ------------------------ */
  function setupRules() {
    const rules = $$("[data-rule]");
    if (!rules.length || reduced || !hasIO) return;
    rules.forEach(r => r.classList.add("is-pending"));
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.remove("is-pending"); io.unobserve(e.target); }
    }), { threshold: 0.4 });
    rules.forEach(r => io.observe(r));
    setTimeout(() => rules.forEach(r => r.classList.remove("is-pending")), 2500);
  }

  /* ---- background parallax on scroll ----------------------------------- */
  function setupScrollParallax() {
    if (reduced) return;
    const layers = $$("[data-par]").filter(el => !el.closest("[data-hero]"));
    if (!layers.length) return;
    scrollFns.push(() => {
      const vh = window.innerHeight;
      layers.forEach(el => {
        const r = el.parentElement.getBoundingClientRect();
        if (r.bottom < -200 || r.top > vh + 200) return;
        const factor = parseFloat(el.dataset.par) || 0.25;
        const progress = (vh - r.top) / (vh + r.height);
        el.style.transform = "translate3d(0," + ((progress - 0.5) * factor * 140).toFixed(1) + "px,0)";
      });
    });
  }

  /* ---- homepage hero: pointer parallax, spotlight, card tilt ----------- */
  function setupHeroPointer() {
    const hero = $("[data-hero]");
    if (!hero || reduced || !window.matchMedia("(pointer: fine)").matches) return;
    const layers = $$("[data-par]", hero);
    const spot = $("[data-spot]", hero);
    const tilt = $("[data-tilt]", hero);
    let raf = 0, mx = 0.5, my = 0.5;

    const draw = () => {
      raf = 0;
      const dx = mx - 0.5, dy = my - 0.5;
      layers.forEach(l => {
        const k = parseFloat(l.dataset.par) || 1;
        l.style.transform = "translate3d(" + (-dx * 26 * k).toFixed(2) + "px," + (-dy * 20 * k).toFixed(2) + "px,0)";
      });
      if (tilt) tilt.style.transform = "perspective(1100px) rotateY(" + (dx * 7).toFixed(2) + "deg) rotateX(" + (-dy * 5).toFixed(2) + "deg)";
    };

    hero.addEventListener("pointermove", e => {
      const r = hero.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      mx = px / r.width; my = py / r.height;
      if (spot) {
        spot.style.setProperty("--spot-x", px + "px");
        spot.style.setProperty("--spot-y", py + "px");
        spot.classList.add("is-on");
      }
      if (!raf) raf = requestAnimationFrame(draw);
    });
    hero.addEventListener("pointerleave", () => {
      if (spot) spot.classList.remove("is-on");
      mx = 0.5; my = 0.5;
      if (!raf) raf = requestAnimationFrame(draw);
    });
  }

  /* ---- services timeline: spine, nodes, typed terminal cards ----------- */
  const timeline = {
    root: null, fill: null, stages: [],

    init() {
      this.root = $("[data-timeline]");
      if (!this.root) return;
      this.fill = $("[data-spine-fill]", this.root);
      this.stages = $$("[data-stage]", this.root);
      this.buildTicks();
      resizeFns.push(() => this.buildTicks());
      this.primeTyping();
      scrollFns.push(() => this.onScroll());
    },

    buildTicks() {
      const ticks = $("[data-ticks]", this.root);
      if (!ticks) return;
      const h = this.root.getBoundingClientRect().height;
      const step = 44;
      const frag = document.createDocumentFragment();
      for (let y = 0; y < h - 20; y += step) {
        const n = Math.round(y / step);
        const major = n % 5 === 0;
        const tick = document.createElement("span");
        tick.className = major ? "tick tick--major" : "tick";
        tick.style.top = y + "px";
        frag.appendChild(tick);
        if (major) {
          const label = document.createElement("span");
          label.className = "tick-label";
          label.style.top = (y - 6) + "px";
          label.textContent = String(n).padStart(2, "0");
          frag.appendChild(label);
        }
      }
      ticks.replaceChildren(frag);
    },

    primeTyping() {
      if (reduced || !hasIO) return;
      $$("[data-type]", this.root).forEach(s => { s.dataset.src = s.textContent; s.textContent = ""; });
      const io = new IntersectionObserver(entries => entries.forEach(e => {
        if (e.isIntersecting) { this.activate(e.target); io.unobserve(e.target); }
      }), { rootMargin: "0px 0px -18% 0px", threshold: 0.25 });
      this.stages.forEach(st => io.observe(st));
      // safety net: never leave the commands blank
      setTimeout(() => this.stages.forEach(st => {
        if (!st.dataset.typed) $$("[data-type]", st).forEach(s => { if (!s.textContent) s.textContent = s.dataset.src || ""; });
      }), 2500);
    },

    activate(stage) {
      if (!stage || stage.dataset.typed) return;
      stage.dataset.typed = "1";
      const node = $("[data-node]", stage);
      if (node) node.classList.add("is-lit");
      if (node && this.fill) {
        const tr = this.root.getBoundingClientRect(), nr = node.getBoundingClientRect();
        const p = clamp((nr.top + nr.height / 2 - tr.top) / Math.max(1, tr.height), 0, 1);
        if (p * 100 > parseFloat(this.fill.style.height || "0")) this.fill.style.height = (p * 100).toFixed(2) + "%";
      }
      this.type(stage);
    },

    type(stage) {
      const spans = $$("[data-type]", stage);
      if (!spans.length || reduced) return;
      if (spans.every(s => s.textContent)) return;
      const caret = document.createElement("span");
      caret.className = "type-caret";
      let si = 0, ci = 0;
      const id = setInterval(() => {
        if (si >= spans.length) { caret.remove(); clearInterval(id); return; }
        const s = spans[si], src = s.dataset.src || "";
        s.textContent = src.slice(0, ++ci);
        s.appendChild(caret);
        if (ci >= src.length) { si++; ci = 0; }
      }, 26);
    },

    onScroll() {
      if (!this.fill || this.root.classList.contains("is-pinned")) return;
      const r = this.root.getBoundingClientRect();
      const p = clamp((window.innerHeight * 0.52 - r.top) / Math.max(1, r.height), 0, 1);
      if (p * 100 >= parseFloat(this.fill.style.height || "0")) this.fill.style.height = (p * 100).toFixed(2) + "%";
      const reach = r.top + p * r.height;
      $$("[data-node]", this.root).forEach(n => {
        const nr = n.getBoundingClientRect();
        const on = nr.top + nr.height / 2 <= reach + 2;
        n.classList.toggle("is-lit", on);
        if (on) this.activate(n.closest("[data-stage]"));
      });
    }
  };

  /* ---- services: pinned "slideshow" mode on large screens -------------- */
  function setupPin() {
    const root = $("[data-timeline]");
    const track = $("[data-pin-track]");
    if (!root || !track) return;
    const stages = $$("[data-stage]", track);
    const buttons = $$("[data-pin-go]", track);
    const marks = $$("[data-pin-mark]", track);
    const ghost = $("[data-pin-ghost]", track);
    const sweep = $("[data-pin-sweep]", track);
    const art = $(".pin-art", track);
    const n = stages.length;
    let on = false, active = -1, ghostTimer = 0;

    const setActive = (i, force) => {
      if (!on || (!force && i === active)) return;
      active = i;
      stages.forEach((st, k) => {
        st.classList.toggle("is-active", k === i);
        st.classList.toggle("is-past", k < i);
      });
      timeline.activate(stages[i]);
      marks.forEach((m, k) => {
        m.classList.toggle("is-active", k === i);
        m.classList.toggle("is-past", k < i);
      });
      buttons.forEach((b, k) => {
        if (k === i) b.setAttribute("aria-current", "true");
        else b.removeAttribute("aria-current");
      });
      if (ghost) {
        ghost.classList.remove("is-shown");
        clearTimeout(ghostTimer);
        ghostTimer = setTimeout(() => { ghost.textContent = "0" + (i + 1); ghost.classList.add("is-shown"); }, 140);
      }
      if (sweep && !reduced) {
        sweep.classList.remove("is-sweeping");
        void sweep.offsetWidth; // restart the animation
        sweep.classList.add("is-sweeping");
      }
    };

    const layout = () => {
      const want = !reduced && window.innerWidth >= 900 && window.innerHeight >= 480;
      if (want === on) return;
      on = want;
      root.classList.toggle("is-pinned", on);
      if (on) {
        setActive(Math.max(0, active), true);
      } else {
        stages.forEach(st => st.classList.remove("is-active", "is-past"));
        if (art) art.style.transform = "";
        active = -1;
      }
    };

    const progress = () => {
      if (!on) return;
      const r = track.getBoundingClientRect();
      const p = (window.innerHeight / 2 - r.top) / Math.max(1, r.height);
      const i = clamp(Math.floor(p * n), 0, n - 1);
      setActive(i);
      if (art && !reduced) {
        const within = clamp(p * n - i, 0, 1);
        art.style.transform = p > 0 && p < 1 ? "translateY(" + ((within - 0.5) * -26).toFixed(1) + "px)" : "";
      }
    };

    const goTo = (i, smooth) => {
      const r = track.getBoundingClientRect();
      const y = window.scrollY + r.top + (r.height / n) * (i + 0.5) - window.innerHeight / 2;
      window.scrollTo({ top: y, behavior: smooth && !reduced ? "smooth" : "auto" });
      setActive(i, true);
    };

    buttons.forEach((b, i) => b.addEventListener("click", () => goTo(i, true)));

    // keyboard users tabbing into a stage that is currently faded out
    stages.forEach((st, i) => st.addEventListener("focusin", () => { if (on && i !== active) goTo(i, false); }));

    // in-page links (#migrations, #ai, #maintenance) all point into the same
    // sticky panel while pinned, so route them to the right scroll position
    document.addEventListener("click", e => {
      const a = e.target.closest("a[href^='#']");
      if (!a || !on) return;
      const i = stages.findIndex(st => "#" + st.id === a.getAttribute("href"));
      if (i < 0) return;
      e.preventDefault();
      history.pushState(null, "", a.getAttribute("href"));
      goTo(i, true);
    });

    layout();
    resizeFns.push(layout);
    scrollFns.push(progress);

    if (on && location.hash) {
      const i = stages.findIndex(st => "#" + st.id === location.hash);
      if (i >= 0) requestAnimationFrame(() => goTo(i, false));
    }
  }

  /* ---- "Where are you migrating?" picker ------------------------------- */
  function setupPicker() {
    const box = $("[data-picker]");
    if (!box) return;
    const from = $("[data-picker-from]", box);
    const to = $("[data-picker-to]", box);
    const go = $("[data-picker-go]", box);
    const label = $("[data-picker-label]", box);
    const names = {};
    Array.from(from.options).forEach(o => { names[o.value] = o.textContent; });

    const update = () => {
      go.href = "migration-" + from.value + "-to-" + to.value + ".html";
      label.textContent = "See " + names[from.value] + " → " + names[to.value] + " plan";
    };

    from.addEventListener("change", () => {
      const keep = to.value;
      const opts = Object.keys(names).filter(k => k !== from.value);
      to.replaceChildren(...opts.map(k => new Option(names[k], k)));
      to.value = opts.includes(keep) ? keep : opts[0];
      update();
    });
    to.addEventListener("change", update);
    update();
  }

  /* ---- case study: tabs, counters, cutover log ------------------------- */
  function setupPhaseTabs() {
    const list = $("[data-phase-tabs]");
    const stack = $("[data-phase-stack]");
    if (!list || !stack) return;
    const tabs = $$("[role='tab']", list);
    const panels = tabs.map(t => document.getElementById(t.getAttribute("aria-controls")));

    const select = (i, focus) => {
      tabs.forEach((t, k) => {
        const on = k === i;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
        panels[k].classList.toggle("is-active", on);
      });
      if (focus) tabs[i].focus();
    };

    tabs.forEach((t, i) => {
      t.addEventListener("click", () => select(i, false));
      t.addEventListener("keydown", e => {
        let next = null;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % tabs.length;
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = tabs.length - 1;
        if (next === null) return;
        e.preventDefault();
        select(next, true);
      });
    });

    list.classList.add("is-enhanced");
    stack.classList.add("is-enhanced");
    select(0, false);
  }

  function setupCaseStudy() {
    const countUp = el => {
      const target = Number(el.dataset.count);
      const prefix = el.dataset.prefix || "";
      if (!target || reduced) return;
      const dur = 1100, t0 = performance.now();
      const step = now => {
        const k = Math.min(1, (now - t0) / dur);
        el.textContent = prefix + Math.round(target * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      el.textContent = prefix + "0";
      requestAnimationFrame(step);
    };

    const metrics = $("[data-metrics]");
    if (metrics && hasIO && !reduced) {
      const io = new IntersectionObserver(en => {
        if (!en[0].isIntersecting) return;
        io.disconnect();
        $$("[data-count]", metrics).forEach(countUp);
      }, { threshold: 0.4 });
      io.observe(metrics);
    }

    const log = $("[data-log]");
    if (!log) return;
    const lines = $$("[data-log-line]", log);
    let timers = [];
    const play = () => {
      timers.forEach(clearTimeout);
      timers = [];
      if (reduced) { lines.forEach(l => l.classList.remove("is-hidden")); return; }
      lines.forEach(l => l.classList.add("is-hidden"));
      lines.forEach((l, i) => timers.push(setTimeout(() => l.classList.remove("is-hidden"), 240 + i * 320)));
    };
    const replay = $("[data-log-replay]", log);
    if (replay) replay.addEventListener("click", play);

    if (!reduced && hasIO) {
      lines.forEach(l => l.classList.add("is-hidden"));
      const io = new IntersectionObserver(en => {
        if (!en[0].isIntersecting) return;
        io.disconnect();
        play();
      }, { threshold: 0.35 });
      io.observe(log);
    }
  }

  /* ---- FAQ: one item open at a time ------------------------------------ */
  // Modern browsers do this natively via <details name="faq">; this covers the rest.
  function setupFaq() {
    const items = $$("details[name='faq']");
    items.forEach(d => d.addEventListener("toggle", () => {
      if (d.open) items.forEach(o => { if (o !== d && o.open) o.open = false; });
    }));
  }

  /* ---- "Taking work for Q_": always show the upcoming quarter ----------- */
  // The HTML says "this quarter" so it never goes stale without JavaScript.
  // Looks two weeks ahead, so the last couple of weeks of a quarter already
  // advertise the next one (e.g. "Q4" from mid-September).
  function setupQuarter() {
    const LEAD_DAYS = 14;
    const ahead = new Date(Date.now() + LEAD_DAYS * 24 * 60 * 60 * 1000);
    const quarter = "Q" + (Math.floor(ahead.getMonth() / 3) + 1);
    $$("[data-current-quarter]").forEach(el => { el.textContent = quarter; });
  }

  /* ---- boot ------------------------------------------------------------ */
  setupHeader();
  setupReveal();
  setupRules();
  setupScrollParallax();
  setupHeroPointer();
  timeline.init();
  setupPin();
  setupPicker();
  setupPhaseTabs();
  setupCaseStudy();
  setupFaq();
  setupQuarter();
  scrollFns.forEach(fn => fn());
})();
