// Widgets for the Home Display dashboard. Each one gets its card body and an
// api ({ config, save(patch), ctx }), and returns { setVisible(on), destroy() }.
// Nothing runs while the dashboard is hidden or the screen is blacked out.
import { apiFetch } from './config.js';
import { eastern, fmtClock } from './tz.js';
import { Slideshow } from './slideshow.js';
import { loadBlob } from './blobstore.js';
import { CAMERA_VIEWS } from './cameras.js';

const h = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

/* ---------------- clock ---------------- */
function clock(el, api) {
  const wrap = h('div', 'w-clock');
  const time = h('div', 'clock-face');
  const hm = h('span', 'clock-hm');
  const sec = h('span', 'clock-sec');
  const ampm = h('span', 'clock-ampm');
  time.append(hm, sec, ampm);
  const date = h('p', 'clock-date');
  const zone = h('p', 'clock-zone');
  wrap.append(time, date, zone);
  el.append(wrap);
  let timer = null;
  const tick = () => {
    const now = new Date();
    const e = eastern(now);
    const { seconds, h24 } = api.config;
    const hour = h24 ? String(e.h).padStart(2, '0') : String(((e.h + 11) % 12) + 1);
    hm.textContent = `${hour}:${String(e.m).padStart(2, '0')}`;
    sec.textContent = seconds ? String(e.s).padStart(2, '0') : '';
    sec.hidden = !seconds;
    ampm.textContent = h24 ? '' : (e.h < 12 ? 'AM' : 'PM');
    date.textContent = `${e.weekday}, ${e.month} ${e.day}`;
    zone.textContent = `Eastern time (${e.zone})`;
    timer = setTimeout(tick, (seconds ? 1000 : 1000 * (60 - e.s)) - (now.getMilliseconds()) + 15);
  };
  return {
    setVisible(on) { clearTimeout(timer); if (on) tick(); },
    update() { clearTimeout(timer); tick(); },
    destroy() { clearTimeout(timer); },
  };
}

/* ---------------- reminders (read-only) ---------------- */
function reminders(el, api) {
  const head = h('header', 'w-head');
  const title = h('h3', 'w-title', 'Today');
  const count = h('span', 'w-count');
  head.append(title, count);
  const list = h('ul', 'rem-list');
  const foot = h('p', 'w-foot');
  el.append(head, list, foot);
  let timer = null, last = null;

  const render = (data) => {
    const want = api.config.space || 'all';
    const showDone = api.config.showDone !== false;
    const tasks = (data.tasks || []).filter((t) => (want === 'all' || t.space === want) && (showDone || !t.done));
    const open = tasks.filter((t) => !t.done).length;
    count.textContent = open ? `${open} to do` : '';
    list.replaceChildren();
    if (!tasks.length) {
      const li = h('li', 'rem-empty', 'Nothing left for today.');
      list.append(li);
    }
    for (const t of tasks) {
      const li = h('li', 'rem');
      li.dataset.priority = t.priority;
      if (t.done) li.classList.add('is-done');
      const mark = h('span', 'rem-mark');
      mark.setAttribute('aria-hidden', 'true');
      const body = h('div', 'rem-body');
      body.append(h('span', 'rem-title', t.title));
      const meta = [];
      if (t.overdue) meta.push(`From ${new Date(t.overdueSince + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
      if (t.priority === 'urgent') meta.push('Urgent');
      else if (t.priority === 'high') meta.push('Important');
      if (meta.length) body.append(h('span', 'rem-meta', meta.join(', ')));
      const when = h('span', 'rem-time', t.time ? fmtClock(t.time) : '');
      li.append(mark, body, when);
      if (t.done) li.setAttribute('aria-label', `${t.title}, done`);
      list.append(li);
    }
    foot.textContent = data.hiddenPersonal && want !== 'company'
      ? `${data.hiddenPersonal} personal task${data.hiddenPersonal === 1 ? ' is' : 's are'} hidden while Personal is locked in MYDAY.` : '';
    foot.hidden = !foot.textContent;
  };
  const load = async () => {
    clearTimeout(timer);
    try { last = await apiFetch('/home/today'); render(last); el.classList.remove('is-stale'); }
    catch (err) {
      el.classList.add('is-stale');
      if (!last) { list.replaceChildren(h('li', 'rem-empty', err.status === 401 ? 'Sign in again to see today’s tasks.' : 'Today’s tasks can’t be loaded right now. Trying again shortly.')); }
    }
    timer = setTimeout(load, 60_000);
  };
  return {
    setVisible(on) { clearTimeout(timer); if (on) load(); },
    update() { if (last) render(last); },
    destroy() { clearTimeout(timer); },
  };
}

/* ---------------- sticky note (editable here) ---------------- */
export const NOTE_COLORS = { butter: 'Butter', blush: 'Blush', mint: 'Mint', sky: 'Sky' };
function sticky(el, api) {
  el.closest('.card').dataset.tint = api.config.color || 'butter';
  const area = h('textarea', 'note-text');
  area.placeholder = 'Write a note…';
  area.maxLength = 2000;
  area.value = api.config.text || '';
  area.setAttribute('aria-label', 'Sticky note');
  el.append(area);
  let t = null;
  area.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => api.save({ text: area.value }), 500); });
  area.addEventListener('blur', () => { clearTimeout(t); if (area.value !== (api.config.text || '')) api.save({ text: area.value }); });
  return {
    setVisible() {},
    update() {
      el.closest('.card').dataset.tint = api.config.color || 'butter';
      if (document.activeElement !== area && area.value !== (api.config.text || '')) area.value = api.config.text || '';
    },
    destroy() { clearTimeout(t); },
  };
}

/* ---------------- weather ---------------- */
const WX = (code) => {
  if (code === 0) return ['clear', 'Clear'];
  if (code === 1) return ['partly', 'Mostly clear'];
  if (code === 2) return ['partly', 'Partly cloudy'];
  if (code === 3) return ['cloud', 'Cloudy'];
  if (code === 45 || code === 48) return ['fog', 'Fog'];
  if (code >= 51 && code <= 57) return ['rain', 'Drizzle'];
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return ['rain', code >= 65 || code === 82 ? 'Heavy rain' : 'Rain'];
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['snow', 'Snow'];
  if (code >= 95) return ['storm', 'Thunderstorms'];
  return ['cloud', '—'];
};
export function wxIcon(kind, day = true) {
  const sun = '<circle cx="24" cy="24" r="8"/><path d="M24 6v4M24 38v4M6 24h4M38 24h4M11.3 11.3l2.8 2.8M33.9 33.9l2.8 2.8M11.3 36.7l2.8-2.8M33.9 14.1l2.8-2.8"/>';
  const moon = '<path d="M31 9a14 14 0 1 0 8 23A12 12 0 0 1 31 9z"/>';
  const cloud = '<path d="M14 36h20a8 8 0 0 0 0-16 11 11 0 0 0-21 3 6.5 6.5 0 0 0 1 13z"/>';
  const small = '<path d="M17 33h18a6 6 0 0 0 0-12 9 9 0 0 0-17 2.5 5 5 0 0 0-1 9.5z"/>';
  const parts = {
    clear: day ? sun : moon,
    partly: (day ? '<g transform="translate(-6 -6) scale(.8)">' + sun + '</g>' : '<g transform="translate(-4 -6) scale(.75)">' + moon + '</g>') + small,
    cloud,
    fog: '<path d="M10 20h28M6 27h36M12 34h24"/>',
    rain: '<path d="M14 30h20a7 7 0 0 0 0-14 10 10 0 0 0-19 3 5.5 5.5 0 0 0-1 11z"/><path d="M17 36l-2 5M25 36l-2 5M33 36l-2 5"/>',
    snow: '<path d="M14 30h20a7 7 0 0 0 0-14 10 10 0 0 0-19 3 5.5 5.5 0 0 0-1 11z"/><path d="M17 37v4M15 39h4M25 37v4M23 39h4M33 37v4M31 39h4"/>',
    storm: '<path d="M14 29h20a7 7 0 0 0 0-14 10 10 0 0 0-19 3 5.5 5.5 0 0 0-1 11z"/><path d="M25 31l-4 7h6l-4 7"/>',
  };
  return `<svg viewBox="0 0 48 48" class="wx-icon" aria-hidden="true">${parts[kind] || cloud}</svg>`;
}
export const DEFAULT_PLACE = { name: 'Gaithersburg, Maryland', lat: 39.1434, lon: -77.2014 };
function weather(el, api) {
  const wrap = h('div', 'w-weather');
  el.append(wrap);
  let timer = null;
  const place = () => (api.config.lat != null ? api.config : DEFAULT_PLACE);
  const render = (d) => {
    const [kind, label] = WX(d.now.code);
    const hours = d.hours.filter((_, i) => i % 2 === 0).slice(0, 6);
    wrap.innerHTML = `
      <div class="wx-now">
        <div class="wx-glyph">${wxIcon(kind, d.now.day)}</div>
        <div class="wx-temp">${Math.round(d.now.temp)}<span class="wx-deg">°</span></div>
      </div>
      <p class="wx-label"></p>
      <p class="wx-range">High ${Math.round(d.today.hi)}°, low ${Math.round(d.today.lo)}°${d.today.rain >= 20 ? `, ${d.today.rain}% rain` : ''}</p>
      <p class="wx-place"></p>
      <ol class="wx-hours">${hours.map((x) => `<li><span>${new Date(x.t).toLocaleTimeString('en-US', { hour: 'numeric' })}</span>${wxIcon(WX(x.code)[0], x.day)}<b>${Math.round(x.temp)}°</b></li>`).join('')}</ol>`;
    wrap.querySelector('.wx-label').textContent = `${label}, feels like ${Math.round(d.now.feels)}°`;
    wrap.querySelector('.wx-place').textContent = place().name;
    window.dispatchEvent(new CustomEvent('homedisplay:sun', { detail: { sunrise: d.today.sunrise, sunset: d.today.sunset } }));
  };
  const load = async () => {
    clearTimeout(timer);
    const p = place();
    try {
      render(await apiFetch(`/home/weather?lat=${p.lat}&lon=${p.lon}`));
      el.classList.remove('is-stale');
    } catch {
      el.classList.add('is-stale');
      if (!wrap.childElementCount) wrap.innerHTML = '<p class="w-empty">Weather can’t be loaded right now. Trying again shortly.</p>';
    }
    timer = setTimeout(load, 15 * 60_000);
  };
  return {
    setVisible(on) { clearTimeout(timer); if (on) load(); },
    update() { load(); },
    destroy() { clearTimeout(timer); },
  };
}

/* ---------------- photo slideshow ---------------- */
function photos(el, api) {
  const { library } = api.ctx;
  const root = h('div', 'slides');
  const empty = h('div', 'empty-state');
  empty.append(h('p', 'empty-title', 'No photos yet'), h('p', null, 'Add some in Controls, then Photos.'));
  el.append(root, empty);
  const show = new Slideshow(root, {
    getEligible: () => library.eligibleIds(),
    loadUrl: async (id) => {
      const p = library.photos.get(id);
      if (!p || !library.isEligible(id)) throw new Error('photo no longer selected');
      return URL.createObjectURL(await loadBlob(p, 'full'));
    },
    onBroken: (id) => library.markBroken(id),
  });
  const conf = () => show.configure({ slideSeconds: Number(api.config.seconds) || 20, transitionSeconds: 1.6, effect: api.config.effect || 'crossfade', shuffle: true });
  conf();
  const onPool = () => show.poolChanged();
  library.addEventListener('change', onPool);
  return {
    setVisible(on) { if (on) show.start(); else show.stop(); },
    update() { conf(); },
    destroy() { show.stop(); library.removeEventListener('change', onPool); },
  };
}

/* ---------------- cameras ---------------- */
export function cameraToolbar(current, onPick, extra = []) {
  const bar = h('div', 'cam-tools');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Camera layout');
  for (const [k, v] of Object.entries(CAMERA_VIEWS)) {
    const b = h('button', 'cam-tool');
    b.type = 'button';
    b.dataset.view = k;
    b.title = v.label;
    b.setAttribute('aria-label', v.label);
    b.setAttribute('aria-pressed', String(k === current));
    b.innerHTML = VIEW_GLYPH[k];
    b.addEventListener('click', (e) => { e.stopPropagation(); onPick(k); for (const x of bar.querySelectorAll('[data-view]')) x.setAttribute('aria-pressed', String(x.dataset.view === k)); });
    bar.append(b);
  }
  for (const x of extra) bar.append(x);
  return bar;
}
const VIEW_GLYPH = {
  single: '<svg viewBox="0 0 20 20"><rect x="2.5" y="4" width="15" height="12" rx="2"/></svg>',
  grid2: '<svg viewBox="0 0 20 20"><rect x="2.5" y="3" width="6.5" height="6.5" rx="1.5"/><rect x="11" y="3" width="6.5" height="6.5" rx="1.5"/><rect x="2.5" y="11" width="6.5" height="6.5" rx="1.5"/><rect x="11" y="11" width="6.5" height="6.5" rx="1.5"/></svg>',
  grid3: '<svg viewBox="0 0 20 20">' + [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => `<rect x="${2 + c * 5.6}" y="${2 + r * 5.6}" width="4.4" height="4.4" rx="1"/>`)).join('') + '</svg>',
  focus: '<svg viewBox="0 0 20 20"><rect x="2" y="3" width="11" height="14" rx="1.5"/><rect x="14.5" y="3" width="3.5" height="4" rx="1"/><rect x="14.5" y="8" width="3.5" height="4" rx="1"/><rect x="14.5" y="13" width="3.5" height="4" rx="1"/></svg>',
};
export const ICON = {
  expand: '<svg viewBox="0 0 20 20"><path d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5"/></svg>',
  prev: '<svg viewBox="0 0 20 20"><path d="M12.5 4.5 7 10l5.5 5.5"/></svg>',
  next: '<svg viewBox="0 0 20 20"><path d="M7.5 4.5 13 10l-5.5 5.5"/></svg>',
};
export function iconButton(icon, label, onClick, cls = 'cam-tool') {
  const b = h('button', cls);
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = ICON[icon];
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}
export function cameraNotice(wall, session) {
  const box = h('div', 'cam-notice');
  const msg = h('p', null, wall.statusText());
  box.append(msg);
  if (['notConnected', 'unconfigured'].includes(wall.listState) || (wall.listState === 'ok' && !wall.tiles.size)) {
    if (session?.role === 'owner' && session.nest?.configured) {
      const b = h('button', 'pill-btn', wall.listState === 'ok' ? 'Connect Nest again' : 'Connect Nest');
      b.type = 'button';
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        try { const r = await apiFetch('/home/nest/connect'); location.href = r.url; }
        catch { msg.textContent = 'Couldn’t start connecting Nest. Check the server’s Nest settings.'; }
      });
      box.append(b);
    }
  }
  return box;
}
function cameras(el, api) {
  const { wall } = api.ctx;
  const slot = h('div', 'cam-slot');
  const bar = cameraToolbar(api.config.view || 'grid2', (v) => { api.save({ view: v }); wall.setView(v); }, [
    iconButton('prev', 'Previous camera', () => wall.rotate(-1), 'cam-tool only-single'),
    iconButton('next', 'Next camera', () => wall.rotate(1), 'cam-tool only-single'),
    iconButton('expand', 'Show cameras full screen', () => api.ctx.actions.setMode('cameras')),
  ]);
  let notice = null;
  const status = () => {
    notice?.remove();
    notice = null;
    const msg = wall.listState === 'unknown' ? '' : wall.statusText();
    bar.dataset.view = wall.view;
    if (msg && (wall.listState !== 'ok' || !wall.tiles.size)) { notice = cameraNotice(wall, api.ctx.session); el.append(notice); }
  };
  wall.addEventListener('status', status);
  el.append(slot, bar);
  return {
    slot,
    get view() { return api.config.view || 'grid2'; },
    setVisible() {},
    update() { wall.setView(api.config.view || 'grid2'); },
    destroy() { wall.removeEventListener('status', status); },
  };
}

/* ---------------- registry ---------------- */
export const WIDGETS = {
  clock: { name: 'Date and time', blurb: 'Big clock in Eastern time.', size: [5, 3], min: [3, 2], create: clock,
    options: [{ key: 'seconds', label: 'Show seconds', type: 'toggle' }, { key: 'h24', label: '24-hour clock', type: 'toggle' }] },
  reminders: { name: 'Reminders', blurb: 'Today’s tasks from MYDAY. Read only.', size: [4, 5], min: [3, 3], create: reminders,
    options: [
      { key: 'space', label: 'Show', type: 'select', choices: { all: 'Personal and company', personal: 'Personal only', company: 'Company only' } },
      { key: 'showDone', label: 'Keep finished tasks, crossed out', type: 'toggle', default: true },
    ] },
  sticky: { name: 'Sticky note', blurb: 'A note you can write on right here.', size: [3, 3], min: [2, 2], create: sticky,
    options: [{ key: 'color', label: 'Colour', type: 'select', choices: NOTE_COLORS }] },
  weather: { name: 'Weather', blurb: 'Now, today and the next hours.', size: [3, 3], min: [2, 2], create: weather,
    options: [{ key: 'place', label: 'Place', type: 'place' }] },
  photos: { name: 'Photo slideshow', blurb: 'Your photos, a few at a time.', size: [3, 4], min: [2, 2], create: photos,
    options: [{ key: 'seconds', label: 'Each photo stays', type: 'select', choices: { 10: '10 seconds', 20: '20 seconds', 45: '45 seconds', 120: '2 minutes' } }] },
  cameras: { name: 'Cameras', blurb: 'Nest cameras in single, 2×2, 3×3 or big and small.', size: [5, 5], min: [3, 3], single: true, create: cameras,
    options: [{ key: 'view', label: 'Layout', type: 'select', choices: Object.fromEntries(Object.entries(CAMERA_VIEWS).map(([k, v]) => [k, v.label])) }] },
};
