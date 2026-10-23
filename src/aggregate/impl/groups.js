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

  return {
    onEvent(ev) {
      const year = Math.floor(ev.ymd / 10000);
      const tk = trackKey(ev.tr, ev.ar);
      const ak = ev.al > 0 ? albumKey(ev.ar, ev.al) : 0;

      if (ev.ar > 0) {
        let a = artists.get(ev.ar);
        if (!a) {
          a = {
            id: ev.ar,
            name: ds.dicts.artists.get(ev.ar),
            plays: 0, ms: 0, skips: 0,
            days: new Set(), months: new Set(), years: new Set(),
            albums: new Set(), // ak de los álbumes del artista
            tracks: new Set(),
            clock: new Int32Array(168), // plays por dow*24+hour (reloj del artista)
            clockMs: new Float64Array(168),
            firstTs: ev.loc, firstTrack: '', firstTrackTk: 0, lastTs: ev.loc
          };
          artists.set(ev.ar, a);
        }
        a.plays++;
        a.ms += ev.ms;
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
          ak, // clave del álbum (0 si no hay); habilita el enlace canción→álbum
          ar: ev.ar,
          name: ds.dicts.tracks.get(ev.tr),
          artist: ev.ar > 0 ? ds.dicts.artists.get(ev.ar) : '(Desconocido)',
          plays: 0, ms: 0, skips: 0,
          days: new Set(), months: new Set(), years: new Set(),
          firstTs: ev.loc, lastTs: ev.loc
        };
        tracks.set(tk, t);
      }
      t.plays++;
      t.ms += ev.ms;
      if (ev.isSkipped) t.skips++;
      t.days.add(ev.day);
      t.months.add(Math.floor(ev.ymd / 100));
      t.years.add(year);
      t.lastTs = ev.loc;

      if (ev.al > 0) {
        let al = albums.get(ak);
        if (!al) {
          al = {
            id: ak,
            artist: ev.ar > 0 ? ds.dicts.artists.get(ev.ar) : '(Desconocido)',
            name: ds.dicts.albums.get(ev.al),
            plays: 0, ms: 0,
            firstTs: ev.loc, lastTs: ev.loc,
            days: new Set(), // días con escucha del álbum
            tracks: new Set() // tk de las canciones del álbum
          };
          albums.set(ak, al);
        }
        al.plays++;
        al.ms += ev.ms;
        al.lastTs = ev.loc;
        al.days.add(ev.day);
        al.tracks.add(tk);
      }
    },

    finalize() {
      return { artists, tracks, albums };
    }
  };
}