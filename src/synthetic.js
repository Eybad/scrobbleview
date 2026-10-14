// src/synthetic.js — generador determinista de datos sintéticos (demo + tests)
//
// Produce el MISMO tipo de datos que el parser consume (JSON crudo → ByteSource
// memory → analyze()). Patrones realistas: artistas con tracks propios, sesiones
// de escucha por la tarde/noche, duraciones 30s-4min, skips cortos, algo de
// shuffle/offline. Determinista por seed: la demo siempre muestra lo mismo.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REASONS_START = ['apptrack', 'clickrow', 'remote', 'autoplay'];
const REASONS_END = ['trackdone', 'endplay', 'logout', 'fwdbtn'];

// Distribución de hora local: picos 7-9h y 18-23h.
function pickHour(rnd) {
  const r = rnd();
  if (r < 0.12) return 7 + Math.floor(rnd() * 3); // mañana
  if (r < 0.75) return 18 + Math.floor(rnd() * 6); // tarde/noche
  return Math.floor(rnd() * 24);
}

export function generateSyntheticEvents(n, seed = 42) {
  const rnd = mulberry32(seed);
  const artists = [];
  const artistCount = 40;
  for (let a = 0; a < artistCount; a++) {
    const tracks = [];
    const trackCount = 2 + Math.floor(rnd() * 7);
    for (let t = 0; t < trackCount; t++) {
      tracks.push(`Canción ${t + 1} de ${a + 1}`);
    }
    artists.push({ name: `Artista ${a + 1}`, album: `Álbum ${a + 1}`, tracks });
  }

  const events = [];
  const base = Date.UTC(2024, 0, 1) / 1000; // 2024-01-01T00:00:00Z
  const span = 86400 * 365 * 2; // 2 años
  let cursor = base + Math.floor(rnd() * 86400 * 7); // arranca la primera semana
  for (let i = 0; i < n; i++) {
    // Sesiones: saltos de minutos a horas; a veces un mismo día, a veces días.
    const gap = rnd() < 0.6 ? Math.floor(rnd() * 3600) + 60 : Math.floor(rnd() * 86400 * 3) + 3600;
    cursor += gap;

    const a = artists[Math.floor(rnd() * artists.length)];
    const track = a.tracks[Math.floor(rnd() * a.tracks.length)];
    const ms = rnd() < 0.15 ? Math.floor(rnd() * 9000) : 30000 + Math.floor(rnd() * 210000);
    const skipped = ms < 10000;
    const shuffle = rnd() < 0.6;
    const offline = rnd() < 0.05;

    // La hora local se aproxima con UTC (la demo no depende de tz exacta).
    const d = new Date((cursor + pickHour(rnd) * 3600) * 1000);
    events.push({
      ts: d.toISOString(),
      ms_played: ms,
      master_metadata_track_name: track,
      master_metadata_album_artist_name: a.name,
      master_metadata_album_album_name: a.album,
      spotify_track_uri: `spotify:track:${(i + 1).toString(16).padStart(12, '0')}`,
      reason_start: REASONS_START[Math.floor(rnd() * REASONS_START.length)],
      reason_end: REASONS_END[Math.floor(rnd() * REASONS_END.length)],
      shuffle,
      skipped,
      offline
    });
  }
  return events;
}

export function syntheticJSON(n, seed = 42) {
  return JSON.stringify(generateSyntheticEvents(n, seed));
}