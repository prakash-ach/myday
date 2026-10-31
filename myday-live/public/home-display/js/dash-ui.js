// Editing the dashboard: the edit bar, "Add a widget", each widget's setup,
// and the Nest connection controls in the Controls panel.
import { WIDGETS, NOTE_COLORS } from './widgets.js';
import { apiFetch } from './config.js';

const $ = (s) => document.querySelector(s);
const h = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };

export function initDashUI({ dashboard, actions, session, refreshSession }) {
  const bar = $('#edit-bar'), editBtn = $('#edit-toggle');
  const setEditing = (on) => {
    if (on) { actions.setMode('dashboard'); $('#panel-close').click(); }
    dashboard.setEditing(on);
    bar.hidden = !on;
    editBtn.setAttribute('aria-pressed', String(on));
  };
  editBtn.addEventListener('click', () => setEditing(!dashboard.editing));
  $('#btn-edit-dash').addEventListener('click', () => setEditing(true));
  $('#btn-edit-done').addEventListener('click', () => setEditing(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dashboard.editing && !document.querySelector('dialog[open]')) setEditing(false); });
  const layoutSheet = $('#layout-sheet');
  $('#btn-reset-layout').addEventListener('click', () => layoutSheet.showModal());
  layoutSheet.addEventListener('click', (e) => {
    const b = e.target.closest('[data-layout]');
    if (!b) return;
    layoutSheet.close();
    dashboard.reset(b.dataset.layout);
  });

  /* ---------- add ---------- */
  const addSheet = $('#add-sheet'), addList = $('#add-list');
  $('#btn-add-widget').addEventListener('click', () => {
    addList.replaceChildren();
    for (const [type, def] of Object.entries(WIDGETS)) {
      const li = h('li');
      const b = h('button', 'add-item');
      b.type = 'button';
      b.dataset.type = type;
      const taken = def.single && dashboard.find(type);
      b.disabled = !!taken;
      b.append(h('span', 'add-name', def.name), h('span', 'add-blurb', taken ? 'Already on the dashboard.' : def.blurb));
      b.addEventListener('click', () => { addSheet.close(); dashboard.add(type); });
      li.append(b);
      addList.append(li);
    }
    addSheet.showModal();
  });

  /* ---------- set up one widget ---------- */
  const setupSheet = $('#setup-sheet'), fields = $('#setup-fields');
  let setupId = null;
  dashboard.addEventListener('setup', (e) => openSetup(e.detail.id));
  $('#setup-remove').addEventListener('click', () => { setupSheet.close(); if (setupId) dashboard.remove(setupId); });

  function openSetup(id) {
    const it = dashboard.itemById(id);
    if (!it) return;
    setupId = id;
    const def = WIDGETS[it.type];
    $('#setup-title').textContent = def.name;
    fields.replaceChildren();
    for (const opt of def.options || []) {
      if (opt.type === 'toggle') {
        const lab = h('label', 'switch');
        const box = h('input');
        box.type = 'checkbox';
        box.checked = it.config[opt.key] ?? !!opt.default;
        box.addEventListener('change', () => dashboard.updateConfig(id, { [opt.key]: box.checked }));
        lab.append(box, h('span', null, opt.label));
        fields.append(lab);
      } else if (opt.type === 'select' && opt.choices === NOTE_COLORS) {
        const fs = h('fieldset', 'swatches');
        fs.append(h('legend', null, opt.label));
        for (const [k, label] of Object.entries(NOTE_COLORS)) {
          const lab = h('label', 'swatch');
          lab.dataset.tint = k;
          const r = h('input');
          r.type = 'radio'; r.name = 'tint'; r.value = k;
          r.checked = (it.config.color || 'butter') === k;
          r.addEventListener('change', () => dashboard.updateConfig(id, { color: k }));
          lab.append(r, h('span', null, label));
          fs.append(lab);
        }
        fields.append(fs);
      } else if (opt.type === 'select') {
        const lab = h('label', 'field');
        lab.append(h('span', null, opt.label));
        const sel = h('select');
        for (const [k, label] of Object.entries(opt.choices)) sel.append(new Option(label, k));
        sel.value = String(it.config[opt.key] ?? Object.keys(opt.choices)[0]);
        sel.addEventListener('change', () => dashboard.updateConfig(id, { [opt.key]: sel.value }));
        lab.append(sel);
        fields.append(lab);
      } else if (opt.type === 'place') {
        fields.append(placePicker(it, (place) => dashboard.updateConfig(id, place)));
      }
    }
    setupSheet.showModal();
  }

  /* ---------- Nest (owner connects; both accounts watch) ---------- */
  async function renderNest() {
    const s = await refreshSession();
    const st = $('#nest-status'), con = $('#btn-nest-connect'), dis = $('#btn-nest-disconnect');
    if (!s) { st.textContent = 'Can’t reach MYDAY to check the cameras.'; con.hidden = dis.hidden = true; return; }
    const owner = s.role === 'owner';
    if (!s.nest.configured) st.textContent = 'Nest isn’t set up on the server yet (NEST_PROJECT_ID is missing).';
    else if (s.nest.connected) st.textContent = 'Nest is connected.';
    else st.textContent = owner ? 'Nest isn’t connected yet.' : 'Nest isn’t connected yet. The owner connects it once from this panel.';
    con.hidden = !(owner && s.nest.configured);
    con.textContent = s.nest.connected ? 'Connect Nest again' : 'Connect Nest';
    dis.hidden = !(owner && s.nest.connected);
    const ring = $('#ring-status'), test = $('#btn-ring-test');
    test.hidden = !(owner && s.nest.connected);
    ring.textContent = !s.nest.connected ? ''
      : s.nest.events ? 'Doorbell rings are switched on: a ring brings up the door camera.'
        : 'Doorbell rings aren’t switched on yet (NEST_EVENTS_TOKEN and the Google Pub/Sub subscription).';
  }
  $('#controls-toggle').addEventListener('click', () => { if (!$('#panel').hidden) renderNest(); });
  $('#btn-ring-test').addEventListener('click', async () => {
    try {
      const r = await apiFetch('/home/events/test', { method: 'POST', json: {} });
      $('#ring-status').textContent = `Test ring sent${r.camera ? ` for ${r.camera}` : ''}. Every Home Display should show the door camera now.`;
      $('#panel-close').click();
    } catch { $('#ring-status').textContent = 'Couldn’t send a test ring.'; }
  });
  $('#btn-nest-connect').addEventListener('click', async () => {
    try { location.href = (await apiFetch('/home/nest/connect')).url; }
    catch { $('#nest-status').textContent = 'Couldn’t start connecting Nest. Check the server’s Nest settings.'; }
  });
  $('#btn-nest-disconnect').addEventListener('click', async () => {
    if (!confirm('Disconnect Nest? Cameras stop showing on every display until you connect again.')) return;
    try { await apiFetch('/home/nest/disconnect', { method: 'POST', json: {} }); } catch { /* shown below */ }
    renderNest();
  });
  void session;
}

function placePicker(it, onPick) {
  const wrap = h('div', 'place');
  const lab = h('label', 'field');
  lab.append(h('span', null, 'Place'));
  const input = h('input');
  input.type = 'search';
  input.placeholder = 'Town or ZIP code';
  input.value = it.config.name || '';
  lab.append(input);
  const list = h('ul', 'place-results');
  const msg = h('p', 'hint');
  wrap.append(lab, list, msg);
  let t = null;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = input.value.trim();
      list.replaceChildren();
      msg.textContent = '';
      if (q.length < 2) return;
      try {
        const { places } = await apiFetch(`/home/geocode?q=${encodeURIComponent(q)}`);
        if (!places.length) msg.textContent = 'No place found with that name.';
        for (const p of places) {
          const b = h('button', 'place-btn', p.name);
          b.type = 'button';
          b.addEventListener('click', () => { input.value = p.name; list.replaceChildren(); msg.textContent = `Showing weather for ${p.name}.`; onPick(p); });
          const li = h('li'); li.append(b); list.append(li);
        }
      } catch { msg.textContent = 'Place search isn’t reachable right now.'; }
    }, 350);
  });
  return wrap;
}
