import { kv } from './db.js';
import { settings } from './settings.js';
import { library } from './library.js';
import { loadBlob } from './blobstore.js';
import { Slideshow } from './slideshow.js';
import { DisplayController } from './display.js';
import { ModeManager } from './modes.js';
import { CameraWall } from './cameras.js';
import { Realtime } from './realtime.js';
import { HouseholdSync } from './sync.js';
import { initUI } from './ui.js';
import { Dashboard } from './dashboard.js';
import { Backdrop } from './backdrop.js';
import { initDashUI } from './dash-ui.js';
import { cameraToolbar, iconButton } from './widgets.js';
import { apiFetch } from './config.js';
import { eastern } from './tz.js';

const $ = (s) => document.querySelector(s);

async function boot() {
  await settings.load();
  // The redesign makes the dashboard the day view, once; later choices stand.
  if (!settings.values.dash2) await settings.set({ dash2: true, dayMode: 'dashboard' });
  let deviceId = await kv.get('deviceId');
  if (!deviceId) { deviceId = crypto.randomUUID(); await kv.set('deviceId', deviceId); }
  await library.load(deviceId);

  // Ask the browser not to evict the photo library under storage pressure.
  navigator.storage?.persist?.().catch(() => {});

  // ---- runtime state that survives reloads ----------------------------------
  const runtime = (await kv.get('runtime')) || {};
  const saveRuntime = () => kv.set('runtime', {
    paused: slideshow.userPaused,
    blackout: display.blackout,
    manual: modes.manual,
  }).catch(() => {});

  // ---- components -------------------------------------------------------------
  const display = new DisplayController(settings);
  await display.init(runtime);

  const slideshow = new Slideshow($('#slides'), {
    getEligible: () => library.eligibleIds(),
    loadUrl: async (id) => {
      const p = library.photos.get(id);
      if (!p || !library.isEligible(id)) throw new Error('photo no longer selected');
      return URL.createObjectURL(await loadBlob(p, 'full'));
    },
    onBroken: (id) => library.markBroken(id),
  });
  slideshow.configure(settings.values);
  slideshow.userPaused = !!runtime.paused;

  const modes = new ModeManager(settings, runtime.manual);
  const cameras = new CameraWall({
    getOrder: () => settings.values.cameraOrder,
    setOrder: (ids) => settings.set({ cameraOrder: ids }),
  });
  const ctx = { library, wall: cameras, actions: null, session: null };
  const refreshSession = async () => {
    try { ctx.session = await apiFetch('/home/session'); } catch { /* keep the last one */ }
    return ctx.session;
  };
  await refreshSession();
  const dashboard = new Dashboard($('#dashboard-root'), ctx);
  await dashboard.load(deviceId);
  const backdrop = new Backdrop(settings, library, () => modes.current.mode);

  // Full-screen cameras: layout buttons, previous/next in single view, and a way back.
  const fullCam = $('#camera-full');
  const fullBar = cameraToolbar(settings.values.cameraView, (v) => settings.set({ cameraView: v }), [
    iconButton('prev', 'Previous camera', () => cameras.rotate(-1), 'cam-tool only-single'),
    iconButton('next', 'Next camera', () => cameras.rotate(1), 'cam-tool only-single'),
  ]);
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'cam-back';
  back.textContent = 'Dashboard';
  back.addEventListener('click', () => actions.setMode('dashboard'));
  fullBar.append(back);
  fullCam.after(fullBar);
  const syncFullBar = () => {
    for (const b of fullBar.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === settings.values.cameraView));
    fullBar.dataset.view = cameras.root.dataset.view || '';
  };
  const realtime = new Realtime(deviceId, settings.values.deviceName);
  const sync = new HouseholdSync(settings);

  // ---- applying the current mode ------------------------------------------------
  let resumeBlackoutAfterDoorbell = false;

  function resolveView() {
    const { mode, focusCameraId } = modes.current;
    if (focusCameraId) return 'cameras';
    if (mode === 'night') return settings.values.nightView === 'clock' ? 'clock' : 'cameras';
    return mode || 'photos';
  }

  function apply() {
    const view = resolveView();
    const { mode, focusCameraId } = modes.current;
    const body = document.body;
    body.dataset.mode = mode;
    body.dataset.view = view;
    body.classList.toggle('night-gray', mode === 'night' && settings.values.nightGrayscale);

    // Nothing visible while blacked out: stop streams and animation, keep
    // the realtime channel (doorbell) running.
    const screenVisible = !display.blackout && !display.hardwareOff;
    const camWidget = dashboard.instanceOf('cameras');
    if (view === 'cameras' || !camWidget) {
      cameras.mount(fullCam);
      cameras.setView(settings.values.cameraView);
    } else {
      cameras.mount(camWidget.slot);
      cameras.setView(camWidget.view);
    }
    cameras.setActive(screenVisible && (view === 'cameras' || (view === 'dashboard' && !!camWidget)), { focusCameraId });
    syncFullBar();
    dashboard.setVisible(screenVisible && view === 'dashboard');
    backdrop.setActive(screenVisible && view === 'dashboard');
    backdrop.applyTheme();

    const fallback = view === 'cameras' && cameras.allOffline && settings.values.cameraFallbackToPhotos && !focusCameraId;
    body.classList.toggle('camera-fallback', fallback);
    const status = $('#camera-status');
    const msg = view === 'cameras' && cameras.listState !== 'unknown' ? cameras.statusText() : '';
    status.hidden = !msg;
    status.textContent = msg;

    const wantSlides = screenVisible && (view === 'photos' || fallback);
    if (wantSlides) slideshow.start(); else slideshow.stop();

    const banner = $('#doorbell-banner');
    banner.hidden = modes.current.source !== 'doorbell';
    if (!banner.hidden) $('#doorbell-camera').textContent = cameras.cameraName(focusCameraId);

    window.dispatchEvent(new CustomEvent('homedisplay:dashboard', { detail: { visible: view === 'dashboard' && screenVisible } }));
  }

  modes.addEventListener('change', apply);
  modes.addEventListener('persist', saveRuntime);
  modes.addEventListener('interruptend', () => {
    if (resumeBlackoutAfterDoorbell) {
      resumeBlackoutAfterDoorbell = false;
      display.setBlackout(true);
    }
  });
  display.addEventListener('change', () => { apply(); saveRuntime(); });
  cameras.addEventListener('status', apply);
  dashboard.addEventListener('widgets', apply);
  library.addEventListener('change', () => slideshow.poolChanged());
  settings.addEventListener('change', (e) => {
    slideshow.configure(settings.values);
    if ('deviceName' in e.detail) realtime.deviceName = settings.values.deviceName;
    if ('serverUrl' in e.detail) { if (settings.values.serverUrl) realtime.reconnectNow(); cameras.refreshList(); sync.run(); }
    apply();
  });

  // ---- actions (shared by the panel and remote commands) -------------------
  const actions = ctx.actions = {
    setMode: (mode) => {
      if (display.blackout || display.hardwareOff) display.wakeUp('user');
      modes.setManual(mode);
    },
    followSchedule: () => modes.followSchedule(),
    pause: () => { slideshow.setPaused(true); saveRuntime(); },
    resume: () => { slideshow.setPaused(false); saveRuntime(); },
    togglePause: () => (slideshow.userPaused ? actions.resume() : actions.pause()),
    next: () => slideshow.next(),
    blackout: () => { resumeBlackoutAfterDoorbell = false; display.setBlackout(true); },
    screenOff: () => { if (!display.screenOffHardware()) display.setBlackout(true); },
    wake: () => { resumeBlackoutAfterDoorbell = false; display.wakeUp('user'); },
    setBrightness: (v, persist = true) => {
      display.applyBrightness(v);
      if (persist) settings.set({ brightness: v });
    },
    setAlwaysOn: (on) => settings.set({ alwaysOn: !!on }),
  };

  // ---- realtime events --------------------------------------------------------
  realtime.on('doorbell', ({ cameraId }) => {
    const wasDark = display.blackout || display.hardwareOff;
    if (wasDark) {
      if (!settings.values.wakeOnDoorbell) return; // owner chose to stay dark
      resumeBlackoutAfterDoorbell = display.blackout;
      display.wakeUp('doorbell');
    }
    modes.doorbell(cameraId);
  });
  realtime.on('display', (m) => {
    // Remote control from the household phone app.
    const map = {
      mode: () => actions.setMode(m.mode),
      followSchedule: actions.followSchedule,
      pause: actions.pause,
      resume: actions.resume,
      next: actions.next,
      blackout: actions.blackout,
      screenOff: actions.screenOff,
      wake: actions.wake,
      brightness: () => actions.setBrightness(Number(m.value)),
      alwaysOn: () => actions.setAlwaysOn(m.value),
    };
    map[m.action]?.();
    realtime.send({ type: 'display:ack', action: m.action, requestId: m.requestId });
  });
  realtime.on('settings', (m) => { if (m.values && typeof m.values === 'object') settings.set(m.values); });
  realtime.on('photos:changed', () => sync.run());
  realtime.addEventListener('state', () => {
    if (realtime.state === 'online') {
      realtime.send({ type: 'display:state', mode: modes.current, blackout: display.blackout, paused: slideshow.userPaused });
    }
  });

  $('#doorbell-dismiss').addEventListener('click', () => modes.endInterrupt());

  // ---- clocks ---------------------------------------------------------------
  function tickClock() {
    const now = new Date();
    const e = eastern(now);
    const t = `${((e.h + 11) % 12) + 1}:${String(e.m).padStart(2, '0')}`;
    const te = $('#clock-time');
    if (te.textContent !== t) { te.textContent = t; te.dateTime = now.toISOString(); }
    $('#clock-date').textContent = `${e.h < 12 ? 'AM' : 'PM'}, ${e.weekday}, ${e.month} ${e.day} (${e.zone})`;
    setTimeout(tickClock, 1000 - now.getMilliseconds() + 5);
  }
  tickClock();

  // ---- daily refresh safety valve ---------------------------------------------
  let bootedAt = Date.now();
  setInterval(() => {
    if (!settings.values.dailyRefresh || Date.now() - bootedAt < 60 * 60_000) return;
    const now = new Date();
    const [h, m] = settings.values.dailyRefreshAt.split(':').map(Number);
    if (now.getHours() === h && now.getMinutes() === m && modes.current.source !== 'doorbell') {
      bootedAt = Date.now();
      location.reload();
    }
  }, 20_000);

  // ---- last-resort error handling: log and keep running -------------------------
  window.addEventListener('error', (e) => console.error('[home-display]', e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => console.error('[home-display] unhandled', e.reason));

  // ---- start --------------------------------------------------------------------
  initUI({ settings, slideshow, display, modes, cameras, realtime, sync, actions });
  initDashUI({ dashboard, actions, session: ctx.session, refreshSession });
  backdrop.applyBackdrop();
  modes.evaluate();
  apply();
  // Doorbell and remote control need a household server with a live channel;
  // MYDAY itself has none, so only connect when one is set in Device.
  if (settings.values.serverUrl) realtime.start();
  sync.start();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[sw]', e));
  }

  // Expose for the existing app shell, debugging and integration tests.
  window.homeDisplay = { settings, library, slideshow, display, modes, cameras, realtime, sync, actions, dashboard, backdrop };
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend',
    `<p style="position:fixed;inset:auto 1rem 1rem;background:#1d2731;padding:1rem;border-radius:8px;z-index:99">
      The display couldn’t start: ${String(err.message).replace(/</g, '&lt;')}. It will try again in 30 seconds.</p>`);
  setTimeout(() => location.reload(), 30_000);
});
