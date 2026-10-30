// Control panel: display controls, photo library management, schedule and
// device settings. All actions go through ctx.actions so the phone (remote
// commands over the realtime channel) and the panel behave identically.
import { library } from './library.js';
import { loadBlob } from './blobstore.js';
import { EFFECTS } from './slideshow.js';
import { PROFILES } from './settings.js';
import {
  importFiles, folderPickerSupported, addFolder, getFolders, scanFolder, forgetFolder, folderPermission,
} from './importer.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const PAGE = 240;

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function fmtBytes(n) {
  if (!Number.isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}
function facts(dl, pairs) {
  dl.replaceChildren(...pairs.flatMap(([k, v]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    return [dt, dd];
  }));
}

// ---- thumbnails (lazy, object URLs revoked when panel closes) --------------
class ThumbGrid {
  constructor(root, onToggle) {
    this.root = root;
    this.onToggle = onToggle;
    this.urls = new Map();
    this.selection = new Set();
    this.filter = '';
    this.limit = PAGE;
    this.observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { this.observer.unobserve(e.target); this.#loadThumb(e.target); }
    }, { root: root.closest('.pane'), rootMargin: '300px' });
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('.thumb');
      if (!btn) return;
      const id = btn.dataset.id;
      this.selection.has(id) ? this.selection.delete(id) : this.selection.add(id);
      btn.setAttribute('aria-pressed', String(this.selection.has(id)));
      this.onToggle();
    });
  }

  async #loadThumb(btn) {
    const p = library.photos.get(btn.dataset.id);
    if (!p || this.urls.has(p.id)) return;
    try {
      const url = URL.createObjectURL(await loadBlob(p, 'thumb'));
      this.urls.set(p.id, url);
      const img = btn.querySelector('img');
      if (img) img.src = url;
    } catch { btn.classList.add('is-broken'); }
  }

  render() {
    const photos = library.list(this.filter);
    const visible = photos.slice(0, this.limit);
    const existing = new Map($$('.thumb', this.root).map((b) => [b.dataset.id, b]));
    const frag = document.createDocumentFragment();
    for (const p of visible) {
      let b = existing.get(p.id);
      if (!b) {
        b = document.createElement('button');
        b.type = 'button';
        b.className = 'thumb';
        b.dataset.id = p.id;
        const img = document.createElement('img');
        img.alt = p.name;
        img.decoding = 'async';
        b.append(img);
        if (this.urls.has(p.id)) img.src = this.urls.get(p.id);
        else this.observer.observe(b);
      }
      existing.delete(p.id);
      b.classList.toggle('is-hidden', !p.selected);
      b.classList.toggle('is-broken', !!p.broken);
      b.setAttribute('aria-pressed', String(this.selection.has(p.id)));
      b.title = p.name;
      frag.append(b);
    }
    for (const [id, b] of existing) { this.observer.unobserve(b); this.#revoke(id); }
    this.root.replaceChildren(frag);
    for (const id of this.selection) if (!library.photos.has(id)) this.selection.delete(id);
    return { shown: visible.length, total: photos.length };
  }

  #revoke(id) {
    const u = this.urls.get(id);
    if (u) { URL.revokeObjectURL(u); this.urls.delete(id); }
  }

  release() {
    for (const id of [...this.urls.keys()]) this.#revoke(id);
    this.observer.disconnect();
    this.root.replaceChildren();
  }
}

export function initUI(ctx) {
  const { settings, slideshow, display, modes, cameras, realtime, sync, actions } = ctx;
  const panel = $('#panel');
  const toggle = $('#controls-toggle');
  let activeTab = 'display';

  // ---- open / close & idle fade ----------------------------------------------
  function openPanel() {
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    renderAll();
    $(`#tab-${activeTab}`).focus();
  }
  function closePanel() {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    grid.release();
    toggle.focus({ preventScroll: true });
  }
  toggle.addEventListener('click', () => (panel.hidden ? openPanel() : closePanel()));
  $('#panel-close').addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) closePanel();
    if (panel.hidden && e.target === document.body) {
      if (e.key === ' ') { e.preventDefault(); actions.togglePause(); }
      if (e.key === 'ArrowRight') actions.next();
    }
  });
  let idleTimer;
  const active = () => {
    document.body.classList.remove('ui-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (panel.hidden) document.body.classList.add('ui-idle'); }, 6000);
  };
  for (const ev of ['pointermove', 'pointerdown', 'keydown']) document.addEventListener(ev, active, { passive: true });
  active();

  // ---- tabs --------------------------------------------------------------------
  const tabs = $$('[role="tab"]', panel);
  function selectTab(name) {
    activeTab = name;
    for (const t of tabs) {
      const on = t.id === `tab-${name}`;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(`#${t.getAttribute('aria-controls')}`).hidden = !on;
    }
    renderAll();
  }
  for (const t of tabs) t.addEventListener('click', () => selectTab(t.id.slice(4)));
  $('.tabs', panel).addEventListener('keydown', (e) => {
    const i = tabs.findIndex((t) => t.id === `tab-${activeTab}`);
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    const next = tabs[(i + d + tabs.length) % tabs.length];
    selectTab(next.id.slice(4));
    next.focus();
  });

  // ---- generic settings binding ----------------------------------------------
  const effectSelect = $('#effect-select');
  for (const [k, label] of Object.entries(EFFECTS)) effectSelect.append(new Option(label, k));
  const profileSelect = $('#profile-select');
  for (const [k, p] of Object.entries(PROFILES)) profileSelect.append(new Option(p.label, k));

  function bindSettings() {
    for (const el of $$('[data-setting]')) {
      const key = el.dataset.setting;
      const v = settings.values[key];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (document.activeElement !== el) el.value = v ?? '';
      if (el.dataset.output) $(`#${el.dataset.output}`).textContent = `${v}${el.dataset.unit || ''}`;
    }
  }
  for (const el of $$('[data-setting]')) {
    const key = el.dataset.setting;
    const commit = () => {
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.type === 'range' || el.type === 'number') v = Number(v);
      if (key === 'alwaysOn') return actions.setAlwaysOn(v);
      settings.set({ [key]: v });
    };
    el.addEventListener('change', commit);
    if (el.type === 'range') {
      el.addEventListener('input', () => {
        if (el.dataset.output) $(`#${el.dataset.output}`).textContent = `${el.value}${el.dataset.unit || ''}`;
      });
    }
  }

  // ---- Display tab --------------------------------------------------------------
  $('#mode-buttons').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b) actions.setMode(b.dataset.mode);
  });
  $('#btn-follow-schedule').addEventListener('click', () => actions.followSchedule());
  $('#btn-pause').addEventListener('click', () => actions.togglePause());
  $('#btn-next').addEventListener('click', () => actions.next());
  $('#btn-blackout').addEventListener('click', () => { closePanel(); actions.blackout(); });
  $('#btn-hw-off').addEventListener('click', () => { closePanel(); actions.screenOff(); });
  const brightness = $('#brightness');
  brightness.addEventListener('input', () => actions.setBrightness(Number(brightness.value), false));
  brightness.addEventListener('change', () => actions.setBrightness(Number(brightness.value), true));

  function renderDisplay() {
    const cur = modes.current;
    for (const b of $$('#mode-buttons [data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === cur.mode));
    const hint = $('#mode-hint');
    if (cur.source === 'doorbell') hint.textContent = 'Showing the doorbell camera.';
    else if (cur.source === 'manual') hint.textContent = Number.isFinite(cur.until)
      ? `Your choice stays until ${fmtTime(cur.until)}, then the schedule takes over.`
      : 'Your choice stays until you return to the schedule.';
    else hint.textContent = modes.isNight() ? 'Following the schedule: night view.' : 'Following the schedule.';
    $('#btn-follow-schedule').hidden = cur.source !== 'manual';

    $('#btn-pause').textContent = slideshow.userPaused ? 'Resume slideshow' : 'Pause slideshow';
    $('#btn-hw-off').hidden = !display.hasNativeScreenPower;
    if (document.activeElement !== brightness) brightness.value = settings.values.brightness;
    $('#brightness-hint').textContent = display.hasHardwareBrightness
      ? 'Sets the screen’s backlight.'
      : 'This browser can’t change the backlight, so the picture is dimmed instead. Use the device’s own brightness control for the backlight.';
    const ws = $('#wake-status');
    ws.textContent = display.wakeStatusText();
    ws.classList.toggle('is-warn', ['unsupported', 'error', 'released'].includes(display.wake.state));
  }

  // ---- Photos tab ---------------------------------------------------------------
  const grid = new ThumbGrid($('#thumb-grid'), () => renderSelection());
  const importStatus = $('#import-status');
  const progressWrap = $('#import-progress');
  const progress = $('progress', progressWrap);
  let importing = false;

  function reportImport(r) {
    const parts = [`Added ${r.added} photo${r.added === 1 ? '' : 's'}.`];
    if (r.skipped) parts.push(`${r.skipped} already in the library.`);
    if (r.failed) parts.push(`${r.failed} couldn’t be read (${r.errors[0] || 'unsupported format'}).`);
    if (!r.total) parts.splice(0, parts.length, 'No new images found.');
    importStatus.textContent = parts.join(' ');
  }
  async function runImport(task) {
    if (importing) return;
    importing = true;
    progressWrap.hidden = false;
    progress.value = 0;
    importStatus.textContent = 'Preparing…';
    const onProgress = (done, total) => {
      progress.max = total || 1;
      progress.value = done;
      importStatus.textContent = `Importing ${done} of ${total}…`;
    };
    try { reportImport(await task(onProgress)); }
    catch (err) { if (err.name !== 'AbortError') importStatus.textContent = err.message; else importStatus.textContent = ''; }
    finally { importing = false; progressWrap.hidden = true; renderPhotos(); }
  }

  $('#file-input').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) runImport((onProgress) => importFiles(files, { scope: settings.values.defaultScope, onProgress }));
  });

  const folderBtn = $('#btn-folder');
  folderBtn.hidden = !folderPickerSupported;
  folderBtn.addEventListener('click', () =>
    runImport((onProgress) => addFolder({ scope: settings.values.defaultScope, onProgress })));

  async function renderFolders() {
    const ul = $('#folder-list');
    if (!folderPickerSupported) { ul.replaceChildren(); return; }
    const folders = await getFolders();
    const items = await Promise.all(folders.map(async (f) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'name';
      const perm = await folderPermission(f);
      name.textContent = `Folder: ${f.name}`;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = perm === 'granted' ? '' : 'needs permission';
      const scan = document.createElement('button');
      scan.type = 'button';
      scan.textContent = 'Check for new photos';
      scan.addEventListener('click', () =>
        runImport((onProgress) => scanFolder(f, { scope: settings.values.defaultScope, onProgress })));
      const forget = document.createElement('button');
      forget.type = 'button';
      forget.textContent = 'Disconnect';
      forget.title = 'Stop checking this folder. Imported photos stay in the library.';
      forget.addEventListener('click', async () => { await forgetFolder(f.id); renderFolders(); });
      li.append(name, meta, scan, forget);
      return li;
    }));
    ul.replaceChildren(...items);
  }

  function renderAlbums() {
    const ul = $('#album-list');
    const albums = [...library.albums.values()].sort((a, b) => a.name.localeCompare(b.name));
    const counts = new Map();
    for (const p of library.photos.values()) for (const a of p.albumIds) counts.set(a, (counts.get(a) || 0) + 1);
    ul.replaceChildren(...albums.map((a) => {
      const li = document.createElement('li');
      const label = document.createElement('label');
      label.className = 'switch name';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = a.inSlideshow;
      cb.addEventListener('change', () => library.setAlbumInSlideshow(a.id, cb.checked));
      const t = document.createElement('span');
      t.textContent = a.name;
      label.append(cb, t);
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = `${counts.get(a.id) || 0}`;
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = 'Delete album';
      del.title = 'Deletes the album only. Its photos stay in the library.';
      del.addEventListener('click', () => {
        if (confirm(`Delete the album “${a.name}”? Its photos stay in the library.`)) library.deleteAlbum(a.id);
      });
      li.append(label, meta, del);
      return li;
    }));

    const filter = $('#filter-album');
    const current = grid.filter;
    filter.replaceChildren(
      new Option('All photos', ''),
      new Option('Hidden from slideshow', '__hidden'),
      new Option('Not in any album', '__none'),
      ...albums.map((a) => new Option(a.name, a.id)),
    );
    filter.value = library.albums.has(current) || current.startsWith('__') ? current : '';
    grid.filter = filter.value;

    const selAlbum = $('#sel-album');
    selAlbum.replaceChildren(new Option('Add to album…', ''), ...albums.map((a) => new Option(a.name, a.id)));
  }

  $('#album-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#album-name');
    if (!input.value.trim()) return;
    const album = await library.createAlbum(input.value);
    input.value = '';
    if (grid.selection.size) await library.addToAlbum([...grid.selection], album.id);
  });
  $('#filter-album').addEventListener('change', (e) => {
    grid.filter = e.target.value;
    grid.limit = PAGE;
    renderPhotos();
  });
  $('#btn-more').addEventListener('click', () => { grid.limit += PAGE; renderPhotos(); });

  function renderSelection() {
    const n = grid.selection.size;
    $('#selection-bar').hidden = n === 0;
    $('#sel-count').textContent = `${n} selected`;
    $('#btn-unalbum').hidden = !library.albums.has(grid.filter);
  }

  $('#selection-bar').addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const ids = [...grid.selection];
    if (act === 'show') await library.setShown(ids, true);
    if (act === 'hide') await library.setShown(ids, false);
    if (act === 'unalbum') await library.removeFromAlbum(ids, grid.filter);
    if (act === 'remove') {
      if (!confirm(`Remove ${ids.length} photo${ids.length === 1 ? '' : 's'} from this display’s library? The originals on your device are not touched.`)) return;
      await library.remove(ids);
    }
    if (act !== 'show' && act !== 'hide') grid.selection.clear();
    if (act === 'clear') grid.selection.clear();
    renderPhotos();
  });
  $('#sel-album').addEventListener('change', async (e) => {
    if (!e.target.value) return;
    await library.addToAlbum([...grid.selection], e.target.value);
    e.target.value = '';
  });

  function renderPhotos() {
    if (panel.hidden || activeTab !== 'photos') return;
    renderAlbums();
    const { shown, total } = grid.render();
    const eligible = library.eligibleIds().length;
    $('#library-count').textContent = `${library.photos.size} in library, ${eligible} in the slideshow`;
    $('#btn-more').hidden = shown >= total;
    renderSelection();
    renderFolders();
  }

  // ---- Device tab ---------------------------------------------------------------
  profileSelect.value = settings.values.profile;
  $('#btn-apply-profile').addEventListener('click', () => settings.applyProfile(profileSelect.value));
  const adminBtn = $('#btn-native-admin');
  adminBtn.hidden = !(display.native && !display.hasNativeScreenPower && display.native.requestScreenOffPermission);
  adminBtn.addEventListener('click', () => display.native.requestScreenOffPermission());

  async function renderDevice() {
    const rtText = { online: 'Connected', connecting: 'Connecting…', offline: 'Offline, retrying', unconfigured: 'No server set', idle: '—' };
    facts($('#conn-facts'), [
      ['Live updates', rtText[realtime.state] || realtime.state],
      ['Cameras', cameras.listState === 'ok' ? `${cameras.tiles.size} available` : cameras.statusText() || 'Not checked yet'],
      ['Photo sync', settings.values.syncEnabled ? sync.status : 'Off'],
    ]);
    const est = await navigator.storage?.estimate?.().catch(() => null);
    const persisted = await navigator.storage?.persisted?.().catch(() => false);
    let bytes = 0;
    for (const p of library.photos.values()) bytes += p.bytes || 0;
    facts($('#storage-facts'), [
      ['Photos', `${library.photos.size} (${fmtBytes(bytes)})`],
      ['Space used', est ? `${fmtBytes(est.usage)} of ${fmtBytes(est.quota)}` : 'Unknown'],
      ['Protected from cleanup', persisted ? 'Yes' : 'No — the browser may clear photos if the device runs low on space'],
    ]);
    facts($('#power-facts'), [
      ['Screen wake lock', display.wakeLockSupported ? 'Supported' : 'Not supported in this browser'],
      ['Android app', display.native ? 'Connected' : 'Not in use'],
      ['Turn screen off/on', display.hasNativeScreenPower ? 'Available' : display.native ? 'Needs permission' : 'Needs the Android app; black out is used instead'],
      ['Status', display.wakeStatusText()],
    ]);
  }

  // ---- rendering ---------------------------------------------------------------
  function renderAll() {
    $('#panel-title').textContent = settings.values.deviceName || 'Display';
    bindSettings();
    if (panel.hidden) return;
    if (activeTab === 'display') renderDisplay();
    if (activeTab === 'photos') renderPhotos();
    if (activeTab === 'device') renderDevice();
  }

  let renderQueued = false;
  const queueRender = () => {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; renderAll(); });
  };
  for (const src of [settings, library, display, modes, cameras, realtime, sync]) {
    src.addEventListener('change', queueRender);
  }
  slideshow.addEventListener('state', queueRender);
  cameras.addEventListener('status', queueRender);
  realtime.addEventListener('state', queueRender);
  sync.addEventListener('status', queueRender);

  return { openPanel, closePanel };
}
