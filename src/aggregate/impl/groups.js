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
  const artists = new Map(); // ar -> {id, name, plays, ms, skips, days, months, years, firstTs, firstTrack, lastTs}
  const tracks = new Map(); // tk -> {id: tr, name, artist, plays, ms, skips, days, years, firstTs, lastTs}
  const albums = new Map(); // ak -> {id: ak, artist, name, plays, ms}

  return {
    onEvent(ev) {
      const year = Math.floor(ev.ymd / 10000);

      if (ev.ar > 0) {
        let a = artists.get(ev.ar);
        if (!a) {
          a = {
            id: ev.ar,
            name: ds.dicts.artists.get(ev.ar),
            plays: 0, ms: 0, skips: 0,
            days: new Set(), months: new Set(), years: new Set(),
            firstTs: ev.loc, firstTrack: '', lastTs: ev.loc
          };
          artists.set(ev.ar, a);
        }
        a.plays++;
        a.ms += ev.ms;
        if (ev.isSkipped) a.skips++;
        a.days.add(ev.day);
        a.months.add(Math.floor(ev.ymd / 100));
        a.years.add(year);
        a.lastTs = ev.loc;
        if (a.firstTrack === '') a.firstTrack = ds.dicts.tracks.get(ev.tr);
      }

      const tk = trackKey(ev.tr, ev.ar);
      let t = tracks.get(tk);
      if (!t) {
        t = {
          id: ev.tr,
          tk,
          ar: ev.ar,
          name: ds.dicts.tracks.get(ev.tr),
          artist: ev.ar > 0 ? ds.dicts.artists.get(ev.ar) : '(Desconocido)',
          plays: 0, ms: 0, skips: 0,
          days: new Set(), years: new Set(),
          firstTs: ev.loc, lastTs: ev.loc
        };
        tracks.set(tk, t);
      }
      t.plays++;
      t.ms += ev.ms;
      if (ev.isSkipped) t.skips++;
      t.days.add(ev.day);
      t.years.add(year);
      t.lastTs = ev.loc;

      if (ev.al > 0) {
        const ak = albumKey(ev.ar, ev.al);
        let al = albums.get(ak);
        if (!al) {
          al = {
            id: ak,
            artist: ev.ar > 0 ? ds.dicts.artists.get(ev.ar) : '(Desconocido)',
            name: ds.dicts.albums.get(ev.al),
            plays: 0, ms: 0
          };
          albums.set(ak, al);
        }
        al.plays++;
        al.ms += ev.ms;
      }
    },

    finalize() {
      return { artists, tracks, albums };
    }
  };
}