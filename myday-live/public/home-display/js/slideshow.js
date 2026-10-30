// Continuous photo slideshow designed for 24/7 operation.
//
// • Two persistent layers are reused forever (no DOM growth).
// • Only transform and opacity are animated (compositor/GPU), via the Web
//   Animations API; every animation is cancelled when its layer retires.
// • Each layer owns exactly one object URL, revoked when the layer retires.
// • The next photo is fully decoded off-screen before its transition starts.
// • Only eligible (user-selected) photos are ever shown; if the current photo
//   stops being eligible it is replaced immediately.
// • Order is a shuffle "bag" (or sequential); the same photo never appears
//   twice in a row when more than one photo is eligible.
// • A watchdog restarts the cycle if it ever stalls.

export const EFFECTS = {
  random: 'Random mix',
  kenburns: 'Ken Burns zoom and pan',
  zoomIn: 'Slow zoom in',
  zoomOut: 'Slow zoom out',
  rotate: 'Gentle rotation',
  pan: 'Cinematic pan',
  parallax: 'Slow parallax',
  crossfade: 'Crossfade',
  fade: 'Fade through black',
  dissolve: 'Dissolve',
  slide: 'Slide',
};
const RANDOM_POOL = ['kenburns', 'zoomIn', 'zoomOut', 'rotate', 'pan', 'parallax', 'crossfade', 'fade', 'dissolve', 'slide'];

const rand = (a, b) => a + Math.random() * (b - a);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Motion of the photo while it is on screen.
function motionFrames(effect) {
  switch (effect) {
    case 'kenburns': {
      const ox = rand(-4, 4), oy = rand(-3, 3);
      const zoomIn = Math.random() < 0.5;
      const a = `translate3d(${ox}%, ${oy}%, 0) scale(${zoomIn ? 1.04 : 1.18})`;
      const b = `translate3d(${-ox}%, ${-oy}%, 0) scale(${zoomIn ? 1.18 : 1.04})`;
      return { photo: [{ transform: a }, { transform: b }] };
    }
    case 'zoomIn': return { photo: [{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }] };
    case 'zoomOut': return { photo: [{ transform: 'scale(1.14)' }, { transform: 'scale(1)' }] };
    case 'rotate': {
      const d = Math.random() < 0.5 ? 1 : -1;
      return { photo: [{ transform: `rotate(${-1.6 * d}deg) scale(1.08)` }, { transform: `rotate(${1.6 * d}deg) scale(1.12)` }] };
    }
    case 'pan': {
      const d = Math.random() < 0.5 ? 1 : -1;
      return { photo: [{ transform: `translate3d(${-4 * d}%, 0, 0) scale(1.12)` }, { transform: `translate3d(${4 * d}%, 0, 0) scale(1.12)` }] };
    }
    case 'parallax': {
      const d = Math.random() < 0.5 ? 1 : -1;
      return {
        photo: [{ transform: `translate3d(${-2.5 * d}%, 0, 0) scale(1.06)` }, { transform: `translate3d(${2.5 * d}%, 0, 0) scale(1.06)` }],
        backdrop: [{ transform: `translate3d(${2 * d}%, 0, 0) scale(1.25)` }, { transform: `translate3d(${-2 * d}%, 0, 0) scale(1.25)` }],
      };
    }
    default: return { photo: [{ transform: 'scale(1.0)' }, { transform: 'scale(1.04)' }] };
  }
}

// How the incoming layer enters and the outgoing layer leaves.
function transitionFrames(effect, t) {
  switch (effect) {
    case 'fade': // fade out to black, then fade in
      return {
        incoming: { frames: [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }], ms: t * 1.4 },
        outgoing: { frames: [{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }], ms: t * 1.4 },
      };
    case 'dissolve':
      return {
        incoming: { frames: [{ opacity: 0, transform: 'scale(1.03)' }, { opacity: 1, transform: 'scale(1)' }], ms: t * 1.3, easing: 'cubic-bezier(.4,0,.2,1)' },
        outgoing: { frames: [{ opacity: 1 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }], ms: t * 1.3 },
      };
    case 'slide': {
      const d = Math.random() < 0.5 ? 1 : -1;
      return {
        incoming: { frames: [{ opacity: 1, transform: `translate3d(${100 * d}%, 0, 0)` }, { opacity: 1, transform: 'translate3d(0,0,0)' }], ms: t, easing: 'cubic-bezier(.65,0,.35,1)' },
        outgoing: { frames: [{ opacity: 1, transform: 'translate3d(0,0,0)' }, { opacity: 1, transform: `translate3d(${-100 * d}%, 0, 0)` }], ms: t, easing: 'cubic-bezier(.65,0,.35,1)' },
      };
    }
    default: // crossfade (used by all motion effects)
      return {
        incoming: { frames: [{ opacity: 0 }, { opacity: 1 }], ms: t, easing: 'ease-in-out' },
        outgoing: { frames: [{ opacity: 1 }, { opacity: 0 }], ms: t, easing: 'ease-in-out' },
      };
  }
}

class Layer {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'slide-layer';
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'slide-backdrop';
    this.img = document.createElement('img');
    this.img.className = 'slide-photo';
    this.img.alt = '';
    this.img.decoding = 'async';
    this.el.append(this.backdrop, this.img);
    root.append(this.el);
    this.url = null;
    this.photoId = null;
    this.anims = [];
  }

  async load(id, url) {
    this.retire();
    this.url = url;
    this.photoId = id;
    this.img.src = url;
    await this.img.decode();
    this.backdrop.style.backgroundImage = `url("${url}")`;
  }

  animate(target, frames, opts) {
    const a = target.animate(frames, { fill: 'forwards', ...opts });
    this.anims.push(a);
    return a;
  }

  pause() { for (const a of this.anims) if (a.playState === 'running') a.pause(); }
  play() { for (const a of this.anims) if (a.playState === 'paused') a.play(); }

  retire() {
    for (const a of this.anims) a.cancel();
    this.anims = [];
    this.el.style.opacity = '0';
    this.el.style.zIndex = '0';
    this.backdrop.style.backgroundImage = '';
    this.img.removeAttribute('src');
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.photoId = null;
  }
}

export class Slideshow extends EventTarget {
  constructor(root, { getEligible, loadUrl, onBroken }) {
    super();
    this.root = root;
    this.getEligible = getEligible;
    this.loadUrl = loadUrl;
    this.onBroken = onBroken;
    this.layers = [new Layer(root), new Layer(root)];
    this.front = 0;
    this.queue = [];
    this.lastId = null;
    this.running = false;
    this.userPaused = false;
    this.gen = 0;
    this.timer = null;
    this.nextDueAt = 0;
    this.remaining = 0;
    this.failures = new Map();
    this.lastAdvanceAt = 0;
    this.opts = { slideSeconds: 12, transitionSeconds: 2.5, effect: 'random', shuffle: true };
    setInterval(() => this.#watchdog(), 30_000);
    document.addEventListener('visibilitychange', () => this.#onVisibility());
  }

  get currentId() { return this.layers[this.front].photoId; }

  configure({ slideSeconds, transitionSeconds, effect, shuffle }) {
    const orderChanged = shuffle !== this.opts.shuffle;
    this.opts = {
      slideSeconds: Math.max(3, Number(slideSeconds) || 12),
      transitionSeconds: Math.min(8, Math.max(0.3, Number(transitionSeconds) || 2.5)),
      effect: EFFECTS[effect] ? effect : 'random',
      shuffle: !!shuffle,
    };
    if (orderChanged) this.queue = [];
    // Apply a shorter duration to the photo already on screen.
    if (this.running && this.nextDueAt) {
      const maxDue = performance.now() + this.opts.slideSeconds * 1000;
      if (this.nextDueAt > maxDue) this.#schedule(this.opts.slideSeconds * 1000);
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.#advance();
  }

  stop() {
    this.running = false;
    this.gen++;
    clearTimeout(this.timer);
    for (const l of this.layers) l.retire();
    this.root.classList.remove('is-empty');
  }

  setPaused(paused) {
    if (paused === this.userPaused) return;
    this.userPaused = paused;
    if (!this.running) return;
    if (paused) {
      clearTimeout(this.timer);
      this.remaining = Math.max(1000, this.nextDueAt - performance.now());
      for (const l of this.layers) l.pause();
    } else {
      for (const l of this.layers) l.play();
      this.#schedule(this.remaining || this.opts.slideSeconds * 1000);
    }
    this.dispatchEvent(new Event('state'));
  }

  next() { if (this.running) { clearTimeout(this.timer); this.#advance(); } }

  /** Call whenever the library or selection changes. */
  poolChanged() {
    if (!this.running) return;
    const pool = this.getEligible();
    const current = this.currentId;
    if (!pool.length) { this.#showEmpty(); return; }
    if (!current || !pool.includes(current)) { clearTimeout(this.timer); this.#advance(); }
  }

  #schedule(ms) {
    clearTimeout(this.timer);
    this.nextDueAt = performance.now() + ms;
    if (this.userPaused) { this.remaining = ms; return; }
    this.timer = setTimeout(() => this.#advance(), ms);
  }

  #pick() {
    const pool = this.getEligible();
    if (!pool.length) return null;
    if (pool.length === 1) return pool[0];
    const inPool = new Set(pool);
    this.queue = this.queue.filter((id) => inPool.has(id));
    if (!this.queue.length) {
      if (this.opts.shuffle) {
        this.queue = shuffled(pool);
      } else {
        const i = pool.indexOf(this.lastId);
        this.queue = i < 0 ? pool.slice() : [...pool.slice(i + 1), ...pool.slice(0, i + 1)];
      }
      if (this.queue[0] === this.lastId) this.queue.push(this.queue.shift());
    }
    return this.queue.shift();
  }

  #showEmpty() {
    this.gen++;
    clearTimeout(this.timer);
    for (const l of this.layers) l.retire();
    this.root.classList.add('is-empty');
    this.dispatchEvent(new Event('empty'));
    this.lastAdvanceAt = Date.now();
  }

  async #advance(attempt = 0) {
    if (!this.running) return;
    const gen = ++this.gen;
    this.lastAdvanceAt = Date.now();
    const id = this.#pick();
    if (!id) { this.#showEmpty(); return; }
    this.root.classList.remove('is-empty');

    const incoming = this.layers[1 - this.front];
    const outgoing = this.layers[this.front];
    try {
      const url = await this.loadUrl(id);
      if (gen !== this.gen) { URL.revokeObjectURL(url); return; }
      await incoming.load(id, url);
      if (gen !== this.gen) return;
      this.failures.delete(id);
    } catch (err) {
      incoming.retire();
      if (gen !== this.gen) return;
      const n = (this.failures.get(id) || 0) + 1;
      this.failures.set(id, n);
      console.warn('[slideshow] could not show photo', id, err);
      if (n >= 3) { this.failures.delete(id); this.onBroken?.(id); }
      const poolSize = this.getEligible().length;
      // Skip to another photo quickly; back off if everything is failing.
      const delay = attempt < poolSize ? 400 : Math.min(30_000, 2000 * attempt);
      this.timer = setTimeout(() => this.#advance(attempt + 1), delay);
      return;
    }

    this.lastId = id;
    this.#transition(incoming, outgoing, gen);
    this.front = 1 - this.front;
    this.dispatchEvent(new CustomEvent('photo', { detail: { id } }));
    this.#schedule(this.opts.slideSeconds * 1000);
  }

  #transition(incoming, outgoing, gen) {
    let effect = this.opts.effect === 'random'
      ? RANDOM_POOL[Math.floor(Math.random() * RANDOM_POOL.length)]
      : this.opts.effect;
    if (reducedMotion.matches) effect = 'crossfade';
    const t = this.opts.transitionSeconds * 1000;
    const hasOutgoing = !!outgoing.photoId;
    const tr = transitionFrames(effect, t);

    incoming.el.style.zIndex = '2';
    outgoing.el.style.zIndex = '1';
    incoming.el.style.opacity = '';

    incoming.animate(incoming.el, hasOutgoing ? tr.incoming.frames : [{ opacity: 0 }, { opacity: 1 }],
      { duration: tr.incoming.ms, easing: tr.incoming.easing || 'linear' });

    if (!reducedMotion.matches) {
      const motion = motionFrames(effect);
      const life = this.opts.slideSeconds * 1000 + tr.incoming.ms * 2;
      incoming.animate(incoming.img, motion.photo, { duration: life, easing: 'linear' });
      if (motion.backdrop) incoming.animate(incoming.backdrop, motion.backdrop, { duration: life, easing: 'linear' });
    }

    if (hasOutgoing) {
      const out = outgoing.animate(outgoing.el, tr.outgoing.frames,
        { duration: tr.outgoing.ms, easing: tr.outgoing.easing || 'linear' });
      out.finished.then(() => { if (outgoing.photoId && gen === this.gen) outgoing.retire(); }).catch(() => {});
    }
    if (this.userPaused) incoming.pause();
  }

  #onVisibility() {
    // Browsers throttle timers in hidden tabs; resync when visible again.
    if (document.visibilityState === 'visible' && this.running && !this.userPaused
        && performance.now() > this.nextDueAt + 2000) this.next();
  }

  #watchdog() {
    if (!this.running || this.userPaused || document.visibilityState !== 'visible') return;
    if (this.root.classList.contains('is-empty')) return;
    const limit = (this.opts.slideSeconds * 3 + 30) * 1000;
    if (Date.now() - this.lastAdvanceAt > limit) {
      console.warn('[slideshow] stalled — restarting cycle');
      this.next();
    }
  }
}
