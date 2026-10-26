// Sessions use estimated UTC intervals: Spotify timestamps mark playback ends.
// start/end are local display values; duration is elapsed UTC seconds, while
// ms sums listened time and can exceed duration when playback overlaps.

import { civilFromDays } from './derive.js';
import { trackKey } from './groups.js';
import { SESSION_GAP_MINUTES } from '../../defaults.js';

export function createSessionsAcc({ tz }) {
  const sessions = [];
  let current = null;
  let intraSessionsWithRepeats = 0;
  let intraRepeatedPlays = 0;

  function finalizeSession(s) {
    s.duration = s.endUtc - s.startUtc;
    let reps = 0;
    for (const c of s.tracks.values()) {
      if (c > 1) reps += c - 1;
    }
    if (reps > 0) intraSessionsWithRepeats++;
    intraRepeatedPlays += reps;
  }

  function mergeCounts(first, second) {
    const [target, source] = first.size >= second.size ? [first, second] : [second, first];
    for (const [key, count] of source) target.set(key, (target.get(key) || 0) + count);
    return target;
  }

  return {
    onEvent(ev) {
      const tk = trackKey(ev.tr, ev.ar);
      const startUtc = ev.t - ((ev.flags & 8) ? 0 : ev.ms / 1000);
      const start = startUtc + tz.offsetMinutes(startUtc) * 60;
      if (!current) {
        current = {
          start, end: ev.loc, startUtc, endUtc: ev.t,
          duration: 0, ms: ev.ms, plays: 1,
          artists: new Map([[ev.ar, 1]]),
          tracks: new Map([[tk, 1]])
        };
        return;
      }
      const gapMin = (startUtc - current.endUtc) / 60;
      if (gapMin > SESSION_GAP_MINUTES) {
        sessions.push(current);
        current = {
          start, end: ev.loc, startUtc, endUtc: ev.t,
          duration: 0, ms: ev.ms, plays: 1,
          artists: new Map([[ev.ar, 1]]),
          tracks: new Map([[tk, 1]])
        };
      } else {
        if (startUtc < current.startUtc) {
          current.startUtc = startUtc;
          current.start = start;
        }
        current.end = ev.loc;
        current.endUtc = ev.t;
        current.ms += ev.ms;
        current.plays++;
        current.artists.set(ev.ar, (current.artists.get(ev.ar) || 0) + 1);
        current.tracks.set(tk, (current.tracks.get(tk) || 0) + 1);
      }

      // End-time order can reveal a long interval after an earlier split.
      while (sessions.length && current.startUtc - sessions.at(-1).endUtc <= SESSION_GAP_MINUTES * 60) {
        const previous = sessions.pop();
        if (previous.startUtc < current.startUtc) {
          current.startUtc = previous.startUtc;
          current.start = previous.start;
        }
        current.ms += previous.ms;
        current.plays += previous.plays;
        current.artists = mergeCounts(current.artists, previous.artists);
        current.tracks = mergeCounts(current.tracks, previous.tracks);
      }
    },

    finalize() {
      if (current) sessions.push(current);
      for (const session of sessions) finalizeSession(session);

      const durations = sessions.map((s) => s.duration);
      const plays = sessions.map((s) => s.plays);
      const byMonth = new Map();
      const byWeekday = new Map();
      const byBlock = new Map();
      const startHour = new Map();
      for (const s of sessions) {
        const d = Math.floor(s.start / 86400);
        const c = civilFromDays(d);
        const month = c.y * 100 + c.m;
        const wd = ((d + 3) % 7 + 7) % 7; // lunes=0 (consistente con derive.js)
        const hr = ((Math.floor(s.start / 3600) % 24) + 24) % 24; // doble módulo (start pre-1970)
        byMonth.set(month, (byMonth.get(month) || 0) + 1);
        byWeekday.set(wd, (byWeekday.get(wd) || 0) + 1);
        byBlock.set(Math.floor(hr / 6), (byBlock.get(Math.floor(hr / 6)) || 0) + 1);
        startHour.set(hr, (startHour.get(hr) || 0) + 1);
      }

      const median = (arr) => {
        if (arr.length === 0) return 0;
        const s = [...arr].sort((a, b) => a - b);
        const mid = s.length >> 1;
        return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
      };

      const sessionsStats = {
        gapMinutes: SESSION_GAP_MINUTES,
        count: sessions.length,
        avgDuration: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
        medianDuration: median(durations),
        avgPlays: plays.length ? plays.reduce((a, b) => a + b, 0) / plays.length : 0,
        medianPlays: median(plays),
        byMonth, byWeekday, byBlock, startHour
      };

      return {
        sessions,
        sessionsStats,
        intraSession: { sessionsWithRepeats: intraSessionsWithRepeats, repeatedPlays: intraRepeatedPlays }
      };
    }
  };
}
