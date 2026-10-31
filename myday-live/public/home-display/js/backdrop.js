// Light / dark theme and the soft background behind the glass.
// Auto theme: light between sunrise and sunset (from the weather widget, or
// 7 AM to 7 PM Eastern until it has loaded), dark otherwise and always dark
// in night mode. "Photos" background shows one of your photos, heavily
// blurred, changing every ten minutes.
import { minutesNow } from './tz.js';
import { loadBlob } from './blobstore.js';

const toMin = (iso) => { const m = /T(\d\d):(\d\d)/.exec(iso || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

export class Backdrop {
  constructor(settings, library, getMode) {
    this.settings = settings;
    this.library = library;
    this.getMode = getMode;
    this.sun = { rise: 7 * 60, set: 19 * 60 };
    this.photoEl = document.getElementById('backdrop-photo');
    this.photoTimer = null;
    this.url = null;
    this.active = true;
    window.addEventListener('homedisplay:sun', (e) => {
      const rise = toMin(e.detail.sunrise), set = toMin(e.detail.sunset);
      if (rise != null && set != null) { this.sun = { rise, set }; this.applyTheme(); }
    });
    settings.addEventListener('change', (e) => {
      if ('theme' in e.detail) this.applyTheme();
      if ('backdrop' in e.detail) this.applyBackdrop();
    });
    setInterval(() => this.applyTheme(), 60_000);
  }

  applyTheme() {
    const pref = this.settings.values.theme;
    const m = minutesNow();
    const night = this.getMode() === 'night';
    const theme = night ? 'dark' : pref === 'light' || pref === 'dark' ? pref : (m >= this.sun.rise && m < this.sun.set ? 'light' : 'dark');
    if (document.documentElement.dataset.theme !== theme) {
      document.documentElement.dataset.theme = theme;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#dfe7ef' : '#151a2c');
    }
  }

  setActive(on) {
    if (on === this.active) return;
    this.active = on;
    this.applyBackdrop();
  }

  applyBackdrop() {
    const usePhotos = this.settings.values.backdrop === 'photos';
    document.body.classList.toggle('backdrop-photos', usePhotos);
    clearTimeout(this.photoTimer);
    if (usePhotos && this.active) this.#nextPhoto();
  }

  async #nextPhoto() {
    clearTimeout(this.photoTimer);
    const ids = this.library.eligibleIds();
    if (ids.length) {
      const id = ids[Math.floor(Math.random() * ids.length)];
      try {
        const url = URL.createObjectURL(await loadBlob(this.library.photos.get(id), 'thumb'));
        const img = new Image();
        img.src = url;
        await img.decode();
        const old = this.url;
        this.url = url;
        this.photoEl.style.backgroundImage = `url("${url}")`;
        if (old) setTimeout(() => URL.revokeObjectURL(old), 3000);
      } catch { /* skip a photo that won't load */ }
    }
    this.photoTimer = setTimeout(() => this.#nextPhoto(), 10 * 60_000);
  }
}
