import { kv } from './db.js';

export const DEFAULTS = {
  // Device
  profile: 'livingRoom',
  deviceName: 'Living room display',
  serverUrl: '',            // empty = same origin as this page
  defaultScope: 'device',   // 'device' | 'household' for newly imported photos
  syncEnabled: false,

  // What to show
  dayMode: 'photos',        // 'photos' | 'cameras' | 'dashboard'
  nightEnabled: true,
  nightStart: '21:00',
  nightEnd: '06:00',
  nightView: 'cameras',     // 'cameras' (surveillance) | 'clock'
  nightGrayscale: true,

  // Slideshow
  slideSeconds: 12,
  transitionSeconds: 2.5,
  effect: 'random',
  shuffle: true,

  // Screen
  alwaysOn: true,
  brightness: 1,

  // Doorbell & cameras
  doorbellHoldSeconds: 90,
  wakeOnDoorbell: true,
  cameraFallbackToPhotos: true,

  // Long-running safety valve: reload the page once a day to return any
  // memory the browser engine itself leaks. State is restored on reload.
  dailyRefresh: true,
  dailyRefreshAt: '03:30',
};

export const PROFILES = {
  livingRoom: {
    label: 'Living room display',
    values: { deviceName: 'Living room display', dayMode: 'photos', nightEnabled: true,
      nightView: 'cameras', alwaysOn: true, defaultScope: 'household' },
  },
  bedroom: {
    label: 'Bedroom display',
    values: { deviceName: 'Bedroom display', dayMode: 'photos', nightEnabled: true,
      nightView: 'clock', alwaysOn: true, defaultScope: 'device' },
  },
  phone: {
    label: 'Phone (remote control)',
    values: { deviceName: 'Phone', dayMode: 'cameras', nightEnabled: false,
      alwaysOn: false, defaultScope: 'device' },
  },
};

class Settings extends EventTarget {
  values = { ...DEFAULTS };

  async load() {
    const saved = await kv.get('settings');
    if (saved) Object.assign(this.values, saved);
  }

  async set(patch) {
    Object.assign(this.values, patch);
    await kv.set('settings', { ...this.values });
    this.dispatchEvent(new CustomEvent('change', { detail: patch }));
  }

  applyProfile(name) {
    const p = PROFILES[name];
    if (p) return this.set({ profile: name, ...p.values });
  }
}

export const settings = new Settings();
