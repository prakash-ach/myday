// The customizable dashboard: a 12-column grid whose first eight rows fill
// the screen. In edit mode cards can be dragged, resized, added, removed and
// set up. The layout is kept per display: in this browser and on the server
// (so it survives a cleared browser), whichever was saved last wins.
import { kv } from './db.js';
import { apiFetch } from './config.js';
import { WIDGETS, DEFAULT_PLACE } from './widgets.js';

const COLS = 12, ROWS = 8;
const uid = () => Math.random().toString(36).slice(2, 10);

// Cameras take the left 7 of 12 columns (about 60%); small cards on the right.
export function camerasFirstLayout(keep = []) {
  const note = keep.find((i) => i.type === 'sticky');
  const place = keep.find((i) => i.type === 'weather');
  return [
    { type: 'cameras', x: 0, y: 0, w: 7, h: 8, config: { view: 'focus' } },
    { type: 'clock', x: 7, y: 0, w: 5, h: 2, config: {} },
    { type: 'reminders', x: 7, y: 2, w: 5, h: 3, config: { space: 'all', showDone: true } },
    { type: 'weather', x: 7, y: 5, w: 3, h: 3, config: place ? { ...place.config } : { ...DEFAULT_PLACE } },
    { type: 'sticky', x: 10, y: 5, w: 2, h: 3, config: note ? { ...note.config } : { color: 'butter', text: '' } },
  ].map((it) => ({ id: uid(), ...it }));
}

export function evenLayout(keep = []) {
  const note = keep.find((i) => i.type === 'sticky');
  const place = keep.find((i) => i.type === 'weather');
  return [
    { type: 'clock', x: 0, y: 0, w: 5, h: 3, config: {} },
    { type: 'weather', x: 5, y: 0, w: 3, h: 3, config: place ? { ...place.config } : { ...DEFAULT_PLACE } },
    { type: 'reminders', x: 8, y: 0, w: 4, h: 5, config: { space: 'all', showDone: true } },
    { type: 'cameras', x: 0, y: 3, w: 5, h: 5, config: { view: 'grid2' } },
    { type: 'photos', x: 5, y: 3, w: 3, h: 5, config: { seconds: 20 } },
    { type: 'sticky', x: 8, y: 5, w: 4, h: 3, config: note ? { ...note.config } : { color: 'butter', text: '' } },
  ].map((it) => ({ id: uid(), ...it }));
}

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const clone = (items) => items.map((it) => ({ ...it }));

// Push anything under `moved` downwards, then float everything back up.
function settle(items, pinned) {
  const queue = [pinned];
  let guard = 0;
  while (queue.length && guard++ < 500) {
    const a = queue.shift();
    for (const b of items) if (b !== a && overlap(a, b)) { b.y = a.y + a.h; queue.push(b); }
  }
  compact(items, pinned);
}
function compact(items, pinned = null) {
  const order = items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  for (const it of order) {
    if (it === pinned) continue;
    while (it.y > 0) {
      it.y--;
      if (items.some((o) => o !== it && overlap(it, o))) { it.y++; break; }
    }
  }
}
function freeSpot(items, w, h) {
  for (let y = 0; y < 200; y++) for (let x = 0; x <= COLS - w; x++) {
    const c = { x, y, w, h };
    if (!items.some((o) => overlap(c, o))) return { x, y };
  }
  return { x: 0, y: 200 };
}

export class Dashboard extends EventTarget {
  constructor(root, ctx) {
    super();
    this.root = root;
    this.ctx = ctx;
    this.items = [];
    this.cards = new Map();   // id → { el, body, inst }
    this.visible = false;
    this.editing = false;
    this.deviceId = null;
    this.saveTimer = null;
    this.placeholder = document.createElement('div');
    this.placeholder.className = 'card-placeholder';
    new ResizeObserver(() => this.#measure()).observe(root);
    this.#bindPointer();
  }

  async load(deviceId) {
    this.deviceId = deviceId;
    const local = await kv.get('layout').catch(() => null);
    let remote = null;
    try { remote = (await apiFetch(`/home/layout?display=${deviceId}`)).layout; } catch { /* offline: use local */ }
    const pick = [local, remote].filter((l) => l && Array.isArray(l.items) && l.items.length)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    this.items = pick ? pick.items.filter((it) => WIDGETS[it.type]) : camerasFirstLayout();
    this.updatedAt = pick?.updatedAt || 0;
    if (!pick) this.save(true);
    this.render();
  }

  save(now = false) {
    this.updatedAt = Date.now();
    const layout = { items: this.items, updatedAt: this.updatedAt };
    kv.set('layout', layout).catch(() => {});
    clearTimeout(this.saveTimer);
    const push = () => apiFetch(`/home/layout?display=${this.deviceId}`, { method: 'PUT', json: { layout } })
      .catch((e) => { this.saveTimer = setTimeout(push, 30_000); console.warn('[dashboard] save', e.message); });
    if (now) push(); else this.saveTimer = setTimeout(push, 1200);
  }

  /* ---------- rendering ---------- */
  render() {
    const keep = new Set(this.items.map((it) => it.id));
    for (const [id, c] of this.cards) if (!keep.has(id)) { c.inst.destroy?.(); c.el.remove(); this.cards.delete(id); }
    for (const it of this.items) if (!this.cards.has(it.id)) this.#mount(it);
    this.#place();
    this.dispatchEvent(new Event('widgets'));
  }

  #mount(it) {
    const def = WIDGETS[it.type];
    const el = document.createElement('section');
    el.className = `card card-${it.type}`;
    el.dataset.id = it.id;
    el.setAttribute('aria-label', def.name);
    const body = document.createElement('div');
    body.className = 'card-body';
    const chrome = document.createElement('div');
    chrome.className = 'card-chrome';
    chrome.innerHTML = `
      <span class="card-name"></span>
      <button type="button" class="chip" data-act="setup">Set up</button>
      <button type="button" class="chip" data-act="remove" aria-label="Remove">Remove</button>
      <span class="card-grip" aria-hidden="true"></span>`;
    chrome.querySelector('.card-name').textContent = def.name;
    if (!def.options?.length) chrome.querySelector('[data-act="setup"]').remove();
    el.append(body, chrome);
    this.root.append(el);
    const api = {
      get config() { return it.config; },
      save: (patch) => { Object.assign(it.config, patch); this.save(); },
      ctx: this.ctx,
    };
    const inst = def.create(body, api);
    this.cards.set(it.id, { el, body, inst, api });
    if (this.visible) inst.setVisible(true);
  }

  #place() {
    for (const it of this.items) {
      const c = this.cards.get(it.id);
      if (!c || c.el.classList.contains('is-dragging')) continue;
      c.el.style.gridColumn = `${it.x + 1} / span ${it.w}`;
      c.el.style.gridRow = `${it.y + 1} / span ${it.h}`;
      c.el.style.setProperty('--h', it.h);
      c.el.style.order = String(it.y * 12 + it.x);
    }
    const bottom = Math.max(ROWS, ...this.items.map((it) => it.y + it.h));
    this.root.style.setProperty('--rows', bottom);
  }

  // Animate cards from where they were to where they are now.
  #flip(change) {
    const before = new Map([...this.cards].map(([id, c]) => [id, c.el.getBoundingClientRect()]));
    change();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const [id, c] of this.cards) {
      if (c.el.classList.contains('is-dragging')) continue;
      const a = before.get(id), b = c.el.getBoundingClientRect();
      if (!a || (Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1)) continue;
      c.el.animate([
        { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)`, width: `${a.width}px`, height: `${a.height}px` },
        { transform: 'none', width: `${b.width}px`, height: `${b.height}px` },
      ], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }

  #measure() {
    const cs = getComputedStyle(this.root);
    const gap = parseFloat(cs.rowGap) || 16;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const row = Math.max(56, (this.root.clientHeight - pad - gap * (ROWS - 1)) / ROWS);
    this.root.style.setProperty('--row', `${row}px`);
    this.narrow = this.root.clientWidth < 720;
    this.root.classList.toggle('is-narrow', this.narrow);
  }

  metrics() {
    const r = this.root.getBoundingClientRect();
    const cs = getComputedStyle(this.root);
    const gap = parseFloat(cs.columnGap) || 16;
    const padL = parseFloat(cs.paddingLeft), padT = parseFloat(cs.paddingTop);
    const colW = (this.root.clientWidth - padL - parseFloat(cs.paddingRight) - gap * (COLS - 1)) / COLS;
    const rowH = parseFloat(this.root.style.getPropertyValue('--row')) || 80;
    return { left: r.left + padL, top: r.top + padT - this.root.scrollTop, gap, colW, rowH };
  }

  /* ---------- visibility & widgets ---------- */
  setVisible(on) {
    if (on === this.visible) return;
    this.visible = on;
    for (const c of this.cards.values()) c.inst.setVisible(on);
  }

  find(type) { return this.items.find((it) => it.type === type); }
  instanceOf(type) { const it = this.find(type); return it ? this.cards.get(it.id)?.inst : null; }

  add(type) {
    const def = WIDGETS[type];
    if (!def || (def.single && this.find(type))) return;
    const [w, h] = def.size;
    const spot = freeSpot(this.items, w, h);
    const config = type === 'weather' ? { ...DEFAULT_PLACE } : type === 'sticky' ? { color: ['butter', 'blush', 'mint', 'sky'][this.items.filter((i) => i.type === 'sticky').length % 4], text: '' } : {};
    const it = { id: uid(), type, ...spot, w, h, config };
    this.items.push(it);
    this.#flip(() => this.render());
    this.save();
    this.cards.get(it.id)?.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  remove(id) {
    this.items = this.items.filter((it) => it.id !== id);
    compact(this.items);
    this.#flip(() => this.render());
    this.save();
  }

  reset(which = 'cameras') {
    const keep = this.items;
    for (const c of this.cards.values()) { c.inst.destroy?.(); c.el.remove(); }
    this.cards.clear();
    this.items = which === 'even' ? evenLayout(keep) : camerasFirstLayout(keep);
    this.render();
    this.save(true);
  }

  updateConfig(id, patch) {
    const it = this.items.find((x) => x.id === id);
    if (!it) return;
    Object.assign(it.config, patch);
    this.cards.get(id)?.inst.update?.();
    this.save();
    this.dispatchEvent(new Event('widgets'));
  }

  setEditing(on) {
    this.editing = on;
    document.body.classList.toggle('is-editing', on);
    if (!on) document.activeElement?.blur?.();
    this.dispatchEvent(new Event('editing'));
  }

  /* ---------- drag & resize ---------- */
  #bindPointer() {
    let op = null;
    const cellFor = (m, px, py) => ({ x: Math.round((px - m.left) / (m.colW + m.gap)), y: Math.round((py - m.top) / (m.rowH + m.gap)) });

    this.root.addEventListener('pointerdown', (e) => {
      if (!this.editing || this.narrow || e.button > 0) return;
      const el = e.target.closest('.card');
      if (!el || e.target.closest('button')) return;
      const it = this.items.find((x) => x.id === el.dataset.id);
      if (!it) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const resize = !!e.target.closest('.card-grip');
      op = { el, rect: el.getBoundingClientRect(), id: it.id, resize, px: e.clientX, py: e.clientY, start: clone(this.items), orig: { ...it }, m: this.metrics(), target: { ...it }, pid: e.pointerId };
      if (!resize) {
        el.classList.add('is-dragging');
        this.placeholder.style.gridColumn = el.style.gridColumn;
        this.placeholder.style.gridRow = el.style.gridRow;
        this.root.append(this.placeholder);
      } else el.classList.add('is-resizing');
    });

    this.root.addEventListener('pointermove', (e) => {
      if (!op || e.pointerId !== op.pid) return;
      const dx = e.clientX - op.px, dy = e.clientY - op.py;
      const { m, orig } = op;
      let next;
      if (op.resize) {
        const min = WIDGETS[orig.type].min;
        const w = Math.min(COLS - orig.x, Math.max(min[0], Math.round((orig.w * (m.colW + m.gap) + dx) / (m.colW + m.gap))));
        const h = Math.min(30, Math.max(min[1], Math.round((orig.h * (m.rowH + m.gap) + dy) / (m.rowH + m.gap))));
        next = { ...orig, w, h };
      } else {
        op.el.style.transform = `translate(${dx}px, ${dy}px) rotate(${Math.max(-1.5, Math.min(1.5, dx / 160))}deg)`;
        const cell = cellFor(m, op.rect.left + dx, op.rect.top + dy);
        next = { ...orig, x: Math.min(COLS - orig.w, Math.max(0, cell.x)), y: Math.max(0, cell.y) };
      }
      if (next.x === op.target.x && next.y === op.target.y && next.w === op.target.w && next.h === op.target.h) return;
      op.target = next;
      const items = clone(op.start);
      const moved = items.find((x) => x.id === op.id);
      Object.assign(moved, { x: next.x, y: next.y, w: next.w, h: next.h });
      settle(items, moved);
      const pos = items.find((x) => x.id === op.id);
      this.#flip(() => {
        this.items = items;
        this.#place();
        this.placeholder.style.gridColumn = `${pos.x + 1} / span ${pos.w}`;
        this.placeholder.style.gridRow = `${pos.y + 1} / span ${pos.h}`;
      });
      if (op.resize) this.cards.get(op.id)?.inst.update?.();
    });

    const end = (e) => {
      if (!op || e.pointerId !== op.pid) return;
      const { el, resize } = op;
      if (!resize) {
        const from = el.getBoundingClientRect();
        el.classList.remove('is-dragging');
        el.style.transform = '';
        this.placeholder.remove();
        compact(this.items);
        this.#place();
        const to = el.getBoundingClientRect();
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
          el.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'none' }],
            { duration: 240, easing: 'cubic-bezier(.2,.9,.25,1.1)' });
        }
      } else {
        el.classList.remove('is-resizing');
        compact(this.items);
        this.#place();
      }
      const changed = JSON.stringify(op.start.map(({ x, y, w, h }) => [x, y, w, h])) !== JSON.stringify(this.items.map(({ x, y, w, h }) => [x, y, w, h]));
      op = null;
      if (changed) this.save();
    };
    this.root.addEventListener('pointerup', end);
    this.root.addEventListener('pointercancel', end);

    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('.card-chrome button');
      if (!b) return;
      const id = b.closest('.card').dataset.id;
      if (b.dataset.act === 'remove') this.remove(id);
      if (b.dataset.act === 'setup') this.dispatchEvent(new CustomEvent('setup', { detail: { id } }));
    });
  }

  itemById(id) { return this.items.find((x) => x.id === id); }
}
