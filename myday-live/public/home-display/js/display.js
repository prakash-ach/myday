// Screen power and wake management.
//
// What a plain browser can do:
//   • Hold a Screen Wake Lock while the page is visible (and re-acquire it
//     after the browser drops it on tab switch, minimise, or lock).
//   • Show an app-level blackout (screen stays powered, shows black).
//   • Dim in software with a black overlay.
// What it cannot do: override OS sleep settings, physically turn the panel
// off or on, or set hardware brightness. Those come from the Android wrapper
// (android/), which exposes window.HomeDisplayNative.
//
// The app itself never blanks or sleeps the screen because of inactivity.

function readNativeCaps(native) {
  if (!native) return {};
  try { return JSON.parse(native.capabilities()); } catch { return {}; }
}

export class DisplayController extends EventTarget {
  constructor(settings) {
    super();
    this.settings = settings;
    this.native = window.HomeDisplayNative || null;
    this.caps = readNativeCaps(this.native);
    this.sentinel = null;
    this.requesting = false;
    this.wake = { state: 'idle', detail: '' };
    this.blackout = false;
    this.hardwareOff = false;
    this.dimmer = document.getElementById('dimmer');
    this.blackEl = document.getElementById('blackout');
  }

  get wakeLockSupported() { return 'wakeLock' in navigator; }
  get hasNativeScreenPower() { return !!this.caps.screenOff; }
  get hasHardwareBrightness() { return !!this.caps.brightness; }

  async init(runtime = {}) {
    this.blackout = !!runtime.blackout;
    this.#renderBlackout();
    this.applyBrightness(this.settings.values.brightness);

    const retry = () => this.ensureWakeLock();
    document.addEventListener('visibilitychange', retry);
    window.addEventListener('focus', retry);
    window.addEventListener('pageshow', retry);
    // Some browsers only grant the lock after a user gesture.
    document.addEventListener('pointerdown', retry, { passive: true });
    setInterval(retry, 30_000);

    this.blackEl.addEventListener('click', () => this.wakeUp('user'));
    this.settings.addEventListener('change', (e) => {
      if ('alwaysOn' in e.detail) this.ensureWakeLock();
      if ('brightness' in e.detail) this.applyBrightness(this.settings.values.brightness);
    });
    await this.ensureWakeLock();
  }

  #setWake(state, detail = '') {
    if (this.wake.state === state && this.wake.detail === detail) return;
    this.wake = { state, detail };
    this.dispatchEvent(new Event('change'));
  }

  async ensureWakeLock() {
    const want = this.settings.values.alwaysOn;
    this.native?.setKeepScreenOn?.(want);
    if (!want) {
      await this.#releaseWakeLock();
      return this.#setWake('off');
    }
    if (!this.wakeLockSupported) return this.#setWake(this.native ? 'native' : 'unsupported');
    if (document.visibilityState !== 'visible') return this.#setWake('waiting');
    if (this.sentinel && !this.sentinel.released) return this.#setWake('active');
    if (this.requesting) return;
    this.requesting = true;
    try {
      const s = await navigator.wakeLock.request('screen');
      this.sentinel = s;
      s.addEventListener('release', () => {
        if (this.sentinel === s) this.sentinel = null;
        this.#setWake(this.settings.values.alwaysOn ? 'released' : 'off');
        // Re-acquire as soon as the browser permits.
        setTimeout(() => this.ensureWakeLock(), 1000);
      });
      this.#setWake('active');
    } catch (err) {
      this.#setWake('error', err?.message || String(err));
    } finally {
      this.requesting = false;
    }
  }

  async #releaseWakeLock() {
    const s = this.sentinel;
    this.sentinel = null;
    if (s && !s.released) { try { await s.release(); } catch { /* already gone */ } }
  }

  wakeStatusText() {
    const { state, detail } = this.wake;
    const nativeNote = this.native ? ' The Android app is also holding the screen on.' : '';
    switch (state) {
      case 'active': return `Screen is being kept on.${nativeNote}`;
      case 'native': return 'Screen is kept on by the Android app.';
      case 'waiting': return 'Will keep the screen on as soon as this page is in front.';
      case 'released': return 'The browser released the screen lock. Reacquiring…';
      case 'unsupported': return 'This browser can’t keep the screen on. Set the device’s screen timeout to “Never” (see Device tab), or use the Android app.';
      case 'error': return `The browser refused to keep the screen on (${detail}). Tap the screen once, or set the device’s screen timeout to “Never”.`;
      case 'off': return 'Keep screen on is switched off. The device’s own sleep settings apply.';
      default: return 'Checking…';
    }
  }

  // ---- blackout (app-level, screen stays powered) ------------------------
  setBlackout(on) {
    this.blackout = on;
    this.#renderBlackout();
    this.dispatchEvent(new Event('change'));
  }

  #renderBlackout() {
    this.blackEl.hidden = !this.blackout;
    document.body.classList.toggle('is-blackout', this.blackout);
  }

  // ---- hardware screen power (Android wrapper only) -----------------------
  screenOffHardware() {
    if (this.native?.screenOff?.()) {
      this.hardwareOff = true;
      this.dispatchEvent(new Event('change'));
      return true;
    }
    return false;
  }

  /** Turns the screen back on (hardware if possible) and clears blackout. */
  wakeUp(reason = 'user') {
    if (this.hardwareOff || reason !== 'user') this.native?.screenOn?.();
    this.hardwareOff = false;
    if (this.blackout) this.setBlackout(false);
    else this.dispatchEvent(new Event('change'));
    this.ensureWakeLock();
  }

  // ---- brightness -----------------------------------------------------------
  applyBrightness(v) {
    const value = Math.min(1, Math.max(0.05, Number(v) || 1));
    if (this.hasHardwareBrightness) {
      this.native.setBrightness(value);
      this.dimmer.style.opacity = '0';
    } else {
      this.dimmer.style.opacity = ((1 - value) * 0.9).toFixed(3);
    }
  }
}
