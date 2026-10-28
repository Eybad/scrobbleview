// Sessions use estimated UTC intervals: Spotify timestamps mark playback ends.
// start/end are local display values; duration is elapsed UTC seconds, while
// ms sums listened time and can exceed duration when playback overlaps.

import { civilFromDays } from './derive.js';
import { trackKey } from './groups.js';
import { SESSION_GAP_MINUTES } from '../../defaults.js';

export function createSessionsAcc({ tz, gapMinutes = SESSION_GAP_MINUTES, compact = false, membership = false }) {
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
    if (compact) { delete s.tracks; delete s.artists; }
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
          ...(membership ? { firstPosition: ev.k, lastPosition: ev.k } : {}),
          duration: 0, ms: ev.ms, plays: 1,
          artists: new Map([[ev.ar, 1]]),
          tracks: new Map([[tk, 1]])
        };
        return;
      }
      const gapMin = (startUtc - current.endUtc) / 60;
      if (gapMin > gapMinutes) {
        sessions.push(current);
        current = {
          start, end: ev.loc, startUtc, endUtc: ev.t,
          ...(membership ? { firstPosition: ev.k, lastPosition: ev.k } : {}),
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
        if (membership) current.lastPosition = ev.k;
        current.ms += ev.ms;
        current.plays++;
        current.artists.set(ev.ar, (current.artists.get(ev.ar) || 0) + 1);
        current.tracks.set(tk, (current.tracks.get(tk) || 0) + 1);
      }

      // End-time order can reveal a long interval after an earlier split.
      while (sessions.length && current.startUtc - sessions.at(-1).endUtc <= gapMinutes * 60) {
        const previous = sessions.pop();
        if (membership) current.firstPosition = previous.firstPosition;
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
      const sessionByPosition = membership ? new Uint32Array(sessions.reduce((sum, session) => sum + session.plays, 0)) : null;
      for (let i = 0; i < sessions.length; i++) {
        sessions[i].id = i;
        if (membership) {
          sessionByPosition.fill(i, sessions[i].firstPosition, sessions[i].lastPosition + 1);
          delete sessions[i].firstPosition;
          delete sessions[i].lastPosition;
        }
        finalizeSession(sessions[i]);
      }

      const durations = sessions.map((s) => s.duration);
      const plays = sessions.map((s) => s.plays);
      const byMonth = new Map();
      const byWeekday = new Map();
      const byBlock = new Map();
      const startHour = new Map();
      for (let h = 0; h < 24; h++) startHour.set(h, 0);
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
        gapMinutes,
        count: sessions.length,
        avgDuration: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
        medianDuration: median(durations),
        avgPlays: plays.length ? plays.reduce((a, b) => a + b, 0) / plays.length : 0,
        medianPlays: median(plays),
        byMonth, byWeekday, byBlock, startHour
      };

      return {
        sessions, sessionByPosition,
        sessionsStats,
        intraSession: { sessionsWithRepeats: intraSessionsWithRepeats, repeatedPlays: intraRepeatedPlays }
      };
    }
  };
}

export function originalSessionMembership(ds, derived, tz, gapMinutes = SESSION_GAP_MINUTES) {
  const accumulator = createSessionsAcc({ tz, gapMinutes, compact: true, membership: true });
  for (let k = 0; k < derived.order.length; k++) {
    const i = derived.order[k];
    accumulator.onEvent({ k, t: derived.t[k], loc: derived.loc[k], ms: ds.m[i], flags: ds.flags[i], tr: ds.tr[i], ar: ds.ar[i] });
  }
  return accumulator.finalize().sessionByPosition;
}
