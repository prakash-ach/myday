// Decides what the display shows. Priority (highest first):
//   1. Doorbell interrupt  – live camera for N seconds
//   2. Manual choice       – lasts until the next schedule boundary
//                            (so 9 PM night mode still takes over), or until
//                            "Return to schedule"
//   3. Schedule            – night view between nightStart and nightEnd,
//                            otherwise the configured day mode
// Mode changes never turn the screen off.

const toMinutes = (s) => { const [h, m] = String(s).split(':').map(Number); return (h || 0) * 60 + (m || 0); };

export class ModeManager extends EventTarget {
  constructor(settings, savedManual) {
    super();
    this.settings = settings;
    this.manual = savedManual && savedManual.until > Date.now() ? savedManual : null;
    this.interrupt = null;
    this.current = { mode: null };
    this.interruptTimer = null;
    settings.addEventListener('change', (e) => {
      // A new schedule changes when a manual choice should expire.
      const scheduleKeys = ['nightEnabled', 'nightStart', 'nightEnd'];
      if (this.manual && scheduleKeys.some((k) => k in e.detail)) {
        this.manual.until = this.nextBoundary();
        this.dispatchEvent(new Event('persist'));
      }
      this.evaluate();
    });
    setInterval(() => this.evaluate(), 10_000);
    document.addEventListener('visibilitychange', () => this.evaluate());
  }

  isNight(date = new Date()) {
    const s = this.settings.values;
    if (!s.nightEnabled) return false;
    const m = date.getHours() * 60 + date.getMinutes();
    const a = toMinutes(s.nightStart), b = toMinutes(s.nightEnd);
    if (a === b) return false;
    return a < b ? m >= a && m < b : m >= a || m < b;
  }

  scheduledMode(date = new Date()) {
    return this.isNight(date) ? 'night' : this.settings.values.dayMode;
  }

  /** Next time the schedule flips between day and night (ms), or Infinity. */
  nextBoundary(from = new Date()) {
    if (!this.settings.values.nightEnabled) return Infinity;
    const start = this.isNight(from);
    const d = new Date(from);
    d.setSeconds(0, 0);
    for (let i = 0; i < 2 * 24 * 60; i++) {
      d.setMinutes(d.getMinutes() + 1);
      if (this.isNight(d) !== start) return d.getTime();
    }
    return Infinity;
  }

  setManual(mode) {
    this.manual = mode === this.scheduledMode() ? null : { mode, until: this.nextBoundary() };
    this.interrupt = null;
    this.dispatchEvent(new Event('persist'));
    this.evaluate();
  }

  followSchedule() {
    this.manual = null;
    this.dispatchEvent(new Event('persist'));
    this.evaluate();
  }

  doorbell(cameraId) {
    const hold = Math.max(10, Number(this.settings.values.doorbellHoldSeconds) || 90);
    this.interrupt = { cameraId, until: Date.now() + hold * 1000 };
    clearTimeout(this.interruptTimer);
    this.interruptTimer = setTimeout(() => this.evaluate(), hold * 1000 + 50);
    this.evaluate();
  }

  endInterrupt() {
    if (!this.interrupt) return;
    this.interrupt = { ...this.interrupt, until: 0 };
    this.evaluate();
  }

  evaluate() {
    const now = Date.now();
    if (this.interrupt && now >= this.interrupt.until) {
      this.interrupt = null;
      this.dispatchEvent(new Event('interruptend'));
    }
    if (this.manual && now >= this.manual.until) {
      this.manual = null;
      this.dispatchEvent(new Event('persist'));
    }
    let next;
    if (this.interrupt) {
      next = { mode: this.isNight() ? 'night' : 'cameras', source: 'doorbell', focusCameraId: this.interrupt.cameraId };
    } else if (this.manual) {
      next = { mode: this.manual.mode, source: 'manual', until: this.manual.until };
    } else {
      next = { mode: this.scheduledMode(), source: 'schedule' };
    }
    if (JSON.stringify(next) !== JSON.stringify(this.current)) {
      this.current = next;
      this.dispatchEvent(new Event('change'));
    }
  }
}
