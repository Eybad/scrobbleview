// impl/temporal.js — actividad temporal (port del v2 + monthly_behavior nuevo)
//
// Claves: year = y, monthIndex = y*100+m, day = días desde epoch local.
// artistsC/tracksC/albumsC de yearly y daily/blocks usan ar/tk/ak (incluyen
// ar=0 "(Desconocido)", como el v2); monthly_artist_* excluye ar=0.

import { trackKey, albumKey } from './groups.js';

export function createTemporalAcc(minMs = 0) {
  const yearly = new Map(); // year -> ver abajo
  const monthly = new Map(); // monthIndex -> {plays, ms}
  const monthlyDiscovery = new Map(); // monthIndex -> {plays, new, rep, unknown}
  const monthlyTrackMs = new Map(); // monthIndex -> Map<tk, ms>
  const monthlyTrackPlays = new Map(); // monthIndex -> Map<tk, plays>
  const monthlyArtistMs = new Map(); // monthIndex -> Map<ar, ms> (ar > 0)
  const monthlyArtistPlays = new Map(); // monthIndex -> Map<ar, plays> (ar > 0)
  const monthlyBehavior = new Map(); // monthIndex -> {skips, shuffle, offline}
  const weekday = Array.from({ length: 7 }, () => ({ plays: 0, ms: 0 }));
  const hour = Array.from({ length: 24 }, () => ({ plays: 0, ms: 0 }));
  const dayHour = new Int32Array(168);
  const dayHourMs = new Float64Array(168);
  const blocks = Array.from({ length: 4 }, () => ({ plays: 0, ms: 0, artists: new Map(), tracks: new Map() }));
  const daily = new Map(); // day -> {plays, ms, artists: Map, tracks: Map}
  const hourTracks = Array.from({ length: 24 }, () => new Map());
  const hourTracksMs = Array.from({ length: 24 }, () => new Map());
  const dayFirst = new Map(); // day -> tk
  const dayLast = new Map(); // day -> tk
  const seenTracks = new Set();
  const seenArtists = new Set();

  function yearlyEntry(year) {
    let y = yearly.get(year);
    if (!y) {
      y = {
        plays: 0, ms: 0, skips: 0, shuffle: 0, newTracks: 0, newArtists: 0,
        blocks: [0, 0, 0, 0], // franjas [madrugada, mañana, tarde, noche] del año
        blocksMs: [0, 0, 0, 0],
        artistsC: new Map(), tracksC: new Map(), albumsC: new Map(),
        artistsMs: new Map(), tracksMs: new Map(), albumsMs: new Map()
      };
      yearly.set(year, y);
    }
    return y;
  }

  function bump(map, key, by) {
    map.set(key, (map.get(key) || 0) + by);
  }

  return {
    onEvent(ev) {
      const year = Math.floor(ev.ymd / 10000);
      const month = Math.floor(ev.ymd / 100);
      const block = Math.floor(ev.hour / 6);
      const tk = trackKey(ev.tr, ev.ar);
      const ak = ev.al > 0 ? albumKey(ev.ar, ev.al) : 0;

      // yearly
      const y = yearlyEntry(year);
      y.plays++;
      y.ms += ev.ms;
      y.blocks[block]++;
      y.blocksMs[block] += ev.ms;
      if (ev.isSkipped) y.skips++;
      if (ev.flags & 1) y.shuffle++;
      bump(y.artistsC, ev.ar, 1);
      y.artistsMs.set(ev.ar, (y.artistsMs.get(ev.ar) || 0) + ev.ms);
      bump(y.tracksC, tk, 1);
      y.tracksMs.set(tk, (y.tracksMs.get(tk) || 0) + ev.ms);
      if (ev.al > 0) {
        bump(y.albumsC, ak, 1);
        y.albumsMs.set(ak, (y.albumsMs.get(ak) || 0) + ev.ms);
      }

      let mo = monthly.get(month);
      if (!mo) { mo = { plays: 0, ms: 0 }; monthly.set(month, mo); }
      mo.plays++;
      mo.ms += ev.ms;

      let disc = monthlyDiscovery.get(month);
      if (!disc) { disc = { plays: 0, new: 0, rep: 0, unknown: 0 }; monthlyDiscovery.set(month, disc); }
      disc.plays++;
      if (!seenTracks.has(tk)) {
        seenTracks.add(tk);
        disc.new++;
        y.newTracks++;
      } else {
        disc.rep++;
      }

      let mb = monthlyBehavior.get(month);
      if (!mb) { mb = { skips: 0, shuffle: 0, offline: 0 }; monthlyBehavior.set(month, mb); }
      if (ev.isSkipped) mb.skips++;
      if (ev.flags & 1) mb.shuffle++;
      if (ev.flags & 4) mb.offline++;

      let mtm = monthlyTrackMs.get(month);
      if (!mtm) { mtm = new Map(); monthlyTrackMs.set(month, mtm); }
      mtm.set(tk, (mtm.get(tk) || 0) + ev.ms);
      let mtp = monthlyTrackPlays.get(month);
      if (!mtp) { mtp = new Map(); monthlyTrackPlays.set(month, mtp); }
      mtp.set(tk, (mtp.get(tk) || 0) + 1);

      if (ev.ar > 0) {
        let mam = monthlyArtistMs.get(month);
        if (!mam) { mam = new Map(); monthlyArtistMs.set(month, mam); }
        mam.set(ev.ar, (mam.get(ev.ar) || 0) + ev.ms);
        let map_ = monthlyArtistPlays.get(month);
        if (!map_) { map_ = new Map(); monthlyArtistPlays.set(month, map_); }
        map_.set(ev.ar, (map_.get(ev.ar) || 0) + 1);
        if (!seenArtists.has(ev.ar)) {
          seenArtists.add(ev.ar);
          y.newArtists++;
        }
      }

      const wd = ev.dow;
      weekday[wd].plays++;
      weekday[wd].ms += ev.ms;
      hour[ev.hour].plays++;
      hour[ev.hour].ms += ev.ms;
      const dh = wd * 24 + ev.hour;
      dayHour[dh]++;
      dayHourMs[dh] += ev.ms;

      const b = blocks[block];
      b.plays++;
      b.ms += ev.ms;
      if (!(ev.flags & 8) && ev.ms >= minMs) {
        bump(b.artists, ev.ar, 1);
        bump(b.tracks, tk, 1);
      }

      let d = daily.get(ev.day);
      if (!d) { d = { plays: 0, ms: 0, artists: new Map(), tracks: new Map() }; daily.set(ev.day, d); }
      d.plays++;
      d.ms += ev.ms;
      bump(d.artists, ev.ar, 1);
      bump(d.tracks, tk, 1);

      if (!(ev.flags & 8) && ev.ms >= minMs) {
        const ht = hourTracks[ev.hour];
        ht.set(tk, (ht.get(tk) || 0) + 1);
        const htm = hourTracksMs[ev.hour];
        htm.set(tk, (htm.get(tk) || 0) + ev.ms);
      }

      if (!dayFirst.has(ev.day)) dayFirst.set(ev.day, tk);
      dayLast.set(ev.day, tk);
    },

    finalize() {
      // Días con cero actividad dentro del rango [primer día, último día].
      let firstDay = Infinity;
      let lastDay = -Infinity;
      for (const d of daily.keys()) {
        if (d < firstDay) firstDay = d;
        if (d > lastDay) lastDay = d;
      }
      const zeroDays = [];
      if (firstDay !== Infinity) {
        for (let d = firstDay; d <= lastDay; d++) {
          if (!daily.has(d)) zeroDays.push(d);
        }
      }
      return {
        yearly, monthly, monthlyDiscovery,
        monthlyTrackMs, monthlyTrackPlays, monthlyArtistMs, monthlyArtistPlays,
        monthlyBehavior, weekday, hour, dayHour, dayHourMs, blocks, daily,
        hourTracks, hourTracksMs, dayFirst, dayLast, zeroDays, firstDay, lastDay
      };
    }
  };
}