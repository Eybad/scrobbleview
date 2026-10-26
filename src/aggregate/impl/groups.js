// impl/groups.js — entidades (artistas/canciones/álbumes)
//
// Claves compuestas (port del v2):
//   track_key = (nombre, artista)  → tk = tr * 2^32 + ar   (tr > 0 siempre)
//   album_key = (artista, álbum)   → ak = ar * 2^32 + al   (solo si al > 0)
//   artist    = ar                 → solo si ar > 0 (v2: artist_name truthy)
// El id 0 de dict = vacío: ar=0 → "(Desconocido)" en el label de la canción,
// pero el artista "(Desconocido)" NO entra al mapa de artistas (como el v2).

export function trackKey(tr, ar) {
  return tr * 4294967296 + ar;
}

export function albumKey(ar, al) {
  return ar * 4294967296 + al;
}

export function createGroupsAcc(ds) {
  const artists = new Map(); // ar -> {id, name, plays, ms, skips, days, months, years, firstTs, firstTrack, lastTs, albums, clock}
  const tracks = new Map(); // tk -> {id: tr, tk, ak, ar, name, artist, plays, ms, skips, days, years, firstTs, lastTs}
  const albums = new Map(); // ak -> {id: ak, artist, name, plays, ms, firstTs, lastTs, days, tracks}

  function addMonthly(monthly, month, ms) {
    let entry = monthly.get(month);
    if (!entry) { entry = { plays: 0, ms: 0 }; monthly.set(month, entry); }
    entry.plays++;
    entry.ms += ms;
  }

  return {
    onEvent(ev) {
      const year = Math.floor(ev.ymd / 10000);
      const month = Math.floor(ev.ymd / 100);
      const tk = trackKey(ev.tr, ev.ar);
      const ak = ev.al > 0 ? albumKey(ev.ar, ev.al) : 0;

      if (ev.ar > 0) {
        let a = artists.get(ev.ar);
        if (!a) {
          a = {
            id: ev.ar,
            name: ds.dicts.artists.get(ev.ar),
            plays: 0, ms: 0, durationKnown: 0, skips: 0, skipKnown: 0,
            days: new Set(), months: new Set(), years: new Set(),
            albums: new Set(), // ak de los álbumes del artista
            tracks: new Set(),
            clock: new Int32Array(168), // plays por dow*24+hour (reloj del artista)
            clockMs: new Float64Array(168),
            firstTs: ev.loc, firstUtc: ev.t, firstTrack: '', firstTrackTk: 0,
            lastTs: ev.loc, lastUtc: ev.t
          };
          artists.set(ev.ar, a);
        }
        a.plays++;
        a.ms += ev.ms;
        if (!(ev.flags & 8)) a.durationKnown++;
        if (!(ev.flags & 32)) a.skipKnown++;
        if (ev.isSkipped) a.skips++;
        a.days.add(ev.day);
        a.months.add(Math.floor(ev.ymd / 100));
        a.years.add(year);
        a.tracks.add(tk);
        const slot = ev.dow * 24 + ev.hour;
        a.clock[slot]++;
        a.clockMs[slot] += ev.ms;
        if (ev.al > 0) a.albums.add(ak);
        a.lastTs = ev.loc;
        a.lastUtc = ev.t;
        if (a.firstTrack === '') {
          a.firstTrack = ds.dicts.tracks.get(ev.tr);
          a.firstTrackTk = tk;
        }
      }

      let t = tracks.get(tk);
      if (!t) {
        t = {
          id: ev.tr,
          tk,
          ak, // Unique attribution only; 0 also represents multiple albums.
          albums: new Set(),
          ar: ev.ar,
          name: ds.dicts.tracks.get(ev.tr),
          artist: ev.ar > 0 ? ds.dicts.artists.get(ev.ar) : '(Desconocido)',
          plays: 0, ms: 0, durationKnown: 0, skips: 0, skipKnown: 0,
          days: new Set(), months: new Set(), years: new Set(),
          firstTs: ev.loc, lastTs: ev.loc, firstUtc: ev.t, lastUtc: ev.t
        };
        tracks.set(tk, t);
      }
      t.plays++;
      if (t.ak !== ak) t.ak = 0;
      if (ak > 0) t.albums.add(ak);
      t.ms += ev.ms;
      if (!(ev.flags & 8)) t.durationKnown++;
      if (!(ev.flags & 32)) t.skipKnown++;
      if (ev.isSkipped) t.skips++;
      t.days.add(ev.day);
      t.months.add(Math.floor(ev.ymd / 100));
      t.years.add(year);
      t.lastTs = ev.loc;
      t.lastUtc = ev.t;

      if (ev.al > 0) {
        let al = albums.get(ak);
        if (!al) {
          al = {
            id: ak,
            artist: ev.ar > 0 ? ds.dicts.artists.get(ev.ar) : '(Desconocido)',
            name: ds.dicts.albums.get(ev.al),
            plays: 0, ms: 0,
            firstTs: ev.loc, lastTs: ev.loc, firstUtc: ev.t, lastUtc: ev.t,
            days: new Set(), // días con escucha del álbum
            tracks: new Set(), // tk de las canciones del álbum
            trackStats: new Map(),
            monthly: new Map()
          };
          albums.set(ak, al);
        }
        al.plays++;
        al.ms += ev.ms;
        al.lastTs = ev.loc;
        al.lastUtc = ev.t;
        al.days.add(ev.day);
        al.tracks.add(tk);
        addMonthly(al.monthly, month, ev.ms);

        let albumTrack = al.trackStats.get(tk);
        if (!albumTrack) {
          albumTrack = {
            tk, plays: 0, ms: 0, durationKnown: 0, skips: 0, skipKnown: 0, days: new Set(), monthly: new Map(),
            firstTs: ev.loc, lastTs: ev.loc, firstUtc: ev.t, lastUtc: ev.t
          };
          al.trackStats.set(tk, albumTrack);
        }
        albumTrack.plays++;
        albumTrack.ms += ev.ms;
        if (!(ev.flags & 8)) albumTrack.durationKnown++;
        if (!(ev.flags & 32)) albumTrack.skipKnown++;
        if (ev.isSkipped) albumTrack.skips++;
        albumTrack.days.add(ev.day);
        albumTrack.lastTs = ev.loc;
        albumTrack.lastUtc = ev.t;
        addMonthly(albumTrack.monthly, month, ev.ms);
      }
    },

    finalize() {
      return { artists, tracks, albums };
    }
  };
}
