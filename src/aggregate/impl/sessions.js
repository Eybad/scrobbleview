// impl/sessions.js — sesiones (gap > 30 min inicia otra) + intraSession
//
// Port del v2: start/end en local, duration en segundos, artists/tracks como
// contadores. Nuevo: intraSession = repeticiones de canciones dentro de una
// misma sesión (repeatedPlays = plays extra de tracks repetidos;
// sessionsWithRepeats = sesiones con al menos una repetición).

import { civilFromDays } from './derive.js';
import { trackKey } from './groups.js';

const SESSION_GAP_MINUTES = 30;

export function createSessionsAcc() {
  const sessions = [];
  let current = null;
  let intraSessionsWithRepeats = 0;
  let intraRepeatedPlays = 0;

  function closeSession(s) {
    s.duration = s.end - s.start;
    let reps = 0;
    for (const c of s.tracks.values()) {
      if (c > 1) reps += c - 1;
    }
    if (reps > 0) intraSessionsWithRepeats++;
    intraRepeatedPlays += reps;
    sessions.push(s);
  }

  return {
    onEvent(ev) {
      const tk = trackKey(ev.tr, ev.ar);
      if (!current) {
        current = {
          start: ev.loc, end: ev.loc, duration: 0, ms: ev.ms, plays: 1,
          artists: new Map([[ev.ar, 1]]),
          tracks: new Map([[tk, 1]])
        };
        return;
      }
      const gapMin = (ev.loc - current.end) / 60;
      if (gapMin > SESSION_GAP_MINUTES) {
        closeSession(current);
        current = {
          start: ev.loc, end: ev.loc, duration: 0, ms: ev.ms, plays: 1,
          artists: new Map([[ev.ar, 1]]),
          tracks: new Map([[tk, 1]])
        };
      } else {
        current.end = ev.loc;
        current.ms += ev.ms;
        current.plays++;
        current.artists.set(ev.ar, (current.artists.get(ev.ar) || 0) + 1);
        current.tracks.set(tk, (current.tracks.get(tk) || 0) + 1);
      }
    },

    finalize() {
      if (current) closeSession(current);

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