// Home Display keeps Eastern time (EST/EDT) whatever the tablet is set to.
export const TZ = 'America/New_York';
const parts = (d, opts) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts })
  .formatToParts(d).map((p) => [p.type, p.value]));

export function eastern(d = new Date()) {
  const p = parts(d, { hour: 'numeric', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'long',
    month: 'long', day: 'numeric', year: 'numeric', timeZoneName: 'short' });
  return {
    h: Number(p.hour) % 24, m: Number(p.minute), s: Number(p.second),
    weekday: p.weekday, month: p.month, day: Number(p.day), year: Number(p.year), zone: p.timeZoneName,
  };
}
export const minutesNow = (d = new Date()) => { const e = eastern(d); return e.h * 60 + e.m; };
export function easternDay(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function fmtTime(d, { seconds = false, h24 = false } = {}) {
  return d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: seconds ? '2-digit' : undefined, hourCycle: h24 ? 'h23' : 'h12' });
}
// "14:30" (a task's wall-clock time) → "2:30 PM"
export function fmtClock(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (!Number.isFinite(h)) return '';
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
