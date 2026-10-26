// aggregate.test.js — StatsModel: totales, determinismo, entidades, temporal,
// sesiones, behavior, concentración, transiciones, streak, DST.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from '../src/aggregate/aggregate.js';
import { fixedTz } from '../src/aggregate/adapters/fixed-tz.js';
import { offsetTable } from '../src/aggregate/adapters/offset-table.js';
import { buildDataset } from './fakes/dataset.js';

const UTC = fixedTz('utc', 0);
// 2024-01-01T00:00:00Z
const D0 = 1704067200;

test('totales: records, ms, flags, completitud, mediana, buckets', () => {
  const ds = buildDataset([
    { t: D0, m: 60000, track: 'A', artist: 'X', reasonEnd: 'trackdone' },
    { t: D0 + 60, m: 5000, track: 'B', artist: 'Y', reasonEnd: 'clicknext', flags: 2 },
    { t: D0 + 120, m: 120000, track: 'C', artist: 'Z', reasonEnd: 'endplay', flags: 1 },
    { t: D0 + 180, m: 0, track: 'D', artist: 'W', reasonEnd: 'logout', flags: 4 }
  ]);
  const m = aggregate(ds, { tz: UTC });
  assert.equal(m.totals.records, 4);
  assert.equal(m.totals.ms, 185000);
  assert.equal(m.totals.skipped, 1);
  assert.equal(m.totals.shuffle, 1);
  assert.equal(m.totals.offline, 1);
  assert.equal(m.totals.episodes, 0);
  assert.equal(m.totals.completed, 2);
  assert.equal(m.totals.interrupted, 2);
  assert.equal(m.totals.medianMs, 32500); // [0, 5000, 60000, 120000]
  assert.equal(m.totals.avgMs, 46250);
  assert.equal(m.totals.playsSignificant, 2); // ms >= 30000
  assert.equal(m.totals.playsSkipped, 2); // ms < 10000
  assert.deepEqual(m.totals.msDist.map((x) => x.count), [2, 0, 0, 2, 0, 0]);
  assert.deepEqual(m.totals.msDist.map((x) => x.label), ['<10 s', '10–30 s', '30–60 s', '1–3 min', '3–5 min', '>5 min']);
});

test('episodes se deriva de los warnings del parser', () => {
  const ds = buildDataset([{ t: D0, m: 1000, track: 'A', artist: 'X' }]);
  ds.meta.warnings.push({ code: 'EPISODE', index: 1 }, { code: 'EPISODE', index: 2 });
  const m = aggregate(ds, { tz: UTC });
  assert.equal(m.totals.episodes, 2);
});

test('determinismo: fixedTz vs offset-table producen el mismo modelo', () => {
  const events = [
    { t: D0, m: 60000, track: 'A', artist: 'X', reasonStart: 'clickrow', reasonEnd: 'trackdone' },
    { t: D0 + 3600, m: 30000, track: 'B', artist: 'Y', reasonEnd: 'endplay', flags: 2 },
    { t: D0 + 7200, m: 120000, track: 'A', artist: 'X', reasonEnd: 'trackdone', flags: 1 },
    { t: D0 + 90000, m: 5000, track: 'C', artist: 'Z', reasonEnd: 'logout' }
  ];
  const ds = buildDataset(events);
  // now fijo: sin él, generatedAt usa Date.now() y dos llamadas pueden cruzar
  // el límite de segundo bajo carga (test flaky; mismo caso que analyze.test.js).
  const a = aggregate(ds, { tz: fixedTz('tz', -240), now: 1704067200 });
  const b = aggregate(ds, { tz: offsetTable('tz', [[0, -240]]), now: 1704067200 });
  assert.deepStrictEqual(a, b);
});

test('lanza TypeError sin tz', () => {
  const ds = buildDataset([{ t: D0, track: 'A', artist: 'X' }]);
  assert.throws(() => aggregate(ds, {}), /tz/);
});

test('concentración: 1 artista → HHI 1, efectivos 1; N iguales → 1/N, gini 0', () => {
  const ds1 = buildDataset([{ t: D0, m: 100000, track: 'A', artist: 'X' }]);
  const m1 = aggregate(ds1, { tz: UTC });
  assert.equal(m1.concentration.artists.hhi, 1);
  assert.equal(m1.concentration.artists.effective, 1);
  assert.equal(m1.concentration.artists.entropy, 1); // convención n=1

  const ds3 = buildDataset([
    { t: D0, m: 100000, track: 'A', artist: 'X' },
    { t: D0 + 60, m: 100000, track: 'B', artist: 'Y' },
    { t: D0 + 120, m: 100000, track: 'C', artist: 'Z' }
  ]);
  const m3 = aggregate(ds3, { tz: UTC });
  assert.ok(Math.abs(m3.concentration.artists.hhi - 1 / 3) < 1e-9);
  assert.ok(Math.abs(m3.concentration.artists.gini) < 1e-9);
  assert.ok(Math.abs(m3.concentration.artists.entropy - 1) < 1e-9);
  assert.ok(Math.abs(m3.concentration.artists.effective - 3) < 1e-9);
});

test('gini [0,0,1] = 2/3', () => {
  const ds = buildDataset([
    { t: D0, m: 0, track: 'A', artist: 'X' },
    { t: D0 + 60, m: 0, track: 'B', artist: 'Y' },
    { t: D0 + 120, m: 100000, track: 'C', artist: 'Z' }
  ]);
  const m = aggregate(ds, { tz: UTC });
  assert.ok(Math.abs(m.concentration.artists.gini - 2 / 3) < 1e-9);
});

test('transiciones: X→Y→X→Y → 2 pares, sin auto; top vacío (count < 5)', () => {
  const ds = buildDataset([
    { t: D0, track: 'A', artist: 'X' },
    { t: D0 + 60, track: 'B', artist: 'Y' },
    { t: D0 + 120, track: 'C', artist: 'X' },
    { t: D0 + 180, track: 'D', artist: 'Y' }
  ]);
  const m = aggregate(ds, { tz: UTC });
  assert.equal(m.transitions.pairs.size, 2);
  assert.equal(m.transitions.auto, 0);
  assert.deepEqual(m.transitions.top, []);
});

test('transiciones: X→X cuenta auto y entra al top con count >= 5', () => {
  const events = [];
  for (let i = 0; i < 6; i++) {
    events.push({ t: D0 + i * 60, track: `T${i}`, artist: 'X' });
  }
  const m = aggregate(buildDataset(events), { tz: UTC });
  assert.equal(m.transitions.auto, 5);
  assert.equal(m.transitions.top.length, 1);
  assert.equal(m.transitions.top[0].fromName, 'X');
  assert.equal(m.transitions.top[0].toName, 'X');
  assert.equal(m.transitions.top[0].repeat, true);
  assert.equal(m.transitions.top[0].count, 5);
});

test('sesiones: gap <= 30 min → 1 sesión; gap > 30 min → 2', () => {
  const ds1 = buildDataset([
    { t: D0, track: 'A', artist: 'X' },
    { t: D0 + 60, track: 'B', artist: 'Y' }
  ]);
  const m1 = aggregate(ds1, { tz: UTC });
  assert.equal(m1.sessions.length, 1);
  assert.equal(m1.sessions[0].plays, 2);
  assert.equal(m1.sessions[0].duration, 60);
  assert.equal(m1.sessionsStats.count, 1);

  const ds2 = buildDataset([
    { t: D0, track: 'A', artist: 'X' },
    { t: D0 + 1980, track: 'B', artist: 'Y' } // 33 min
  ]);
  const m2 = aggregate(ds2, { tz: UTC });
  assert.equal(m2.sessions.length, 2);
  assert.equal(m2.sessionsStats.count, 2);
  assert.equal(m2.sessionsStats.medianDuration, 0);
});

test('sessions estimate a single play interval and keep listened time separate', () => {
  const model = aggregate(buildDataset([
    { t: D0 + 180, m: 180000, track: 'A', artist: 'X' }
  ]), { tz: UTC });
  const session = model.sessions[0];
  assert.equal(session.start, D0);
  assert.equal(session.end, D0 + 180);
  assert.equal(session.duration, 180);
  assert.equal(session.ms, 180000);
  assert.equal(model.sessionsStats.avgDuration, 180);
});

test('sessions merge earlier intervals when a long overlapping play connects them', () => {
  const model = aggregate(buildDataset([
    { t: D0 + 180, m: 180000, track: 'A', artist: 'X' },
    { t: D0 + 4200, m: 180000, track: 'A', artist: 'X' },
    { t: D0 + 4800, m: 4800000, track: 'A', artist: 'X' }
  ]), { tz: UTC });
  assert.equal(model.sessions.length, 1);
  assert.equal(model.sessions[0].startUtc, D0);
  assert.equal(model.sessions[0].endUtc, D0 + 4800);
  assert.equal(model.sessions[0].duration, 4800);
  assert.equal(model.sessions[0].ms, 5160000);
  assert.equal(model.sessions[0].plays, 3);
  assert.equal(model.intraSession.sessionsWithRepeats, 1);
  assert.equal(model.intraSession.repeatedPlays, 2);
});

test('sessions use pauses between estimated intervals, including the 30 minute boundary', () => {
  for (const [end, ms, count, duration] of [
    [2400, 2220000, 1, 2400],
    [2160, 180000, 1, 2160],
    [2161, 180000, 2, 180],
    [240, 360000, 1, 360]
  ]) {
    const model = aggregate(buildDataset([
      { t: D0 + 180, m: 180000, track: 'A', artist: 'X' },
      { t: D0 + end, m: ms, track: 'B', artist: 'Y' }
    ]), { tz: UTC });
    assert.equal(model.sessions.length, count, `end=${end}, ms=${ms}`);
    assert.equal(model.sessions[0].duration, duration);
    assert.equal(model.totals.ms, 180000 + ms);
  }
});

test('sessions localize their estimated starts using the offset at that instant', () => {
  const tz = offsetTable('ny', [[0, -240], [1730613600, -300]]);
  const model = aggregate(buildDataset([
    { t: 1730614200, m: 3600000, track: 'A', artist: 'X' }
  ]), { tz });
  const session = model.sessions[0];
  assert.equal(session.startUtc, 1730610600);
  assert.equal(session.start, 1730596200); // 01:10 EDT
  assert.equal(session.end, 1730596200); // 01:10 EST
  assert.equal(session.duration, 3600);
  assert.equal(model.sessionsStats.startHour.get(1), 1);

  const midnight = aggregate(buildDataset([
    { t: D0 + 60, m: 180000, track: 'A', artist: 'X' }
  ]), { tz: UTC });
  assert.equal(midnight.sessionsStats.byMonth.get(202312), 1);
  assert.equal(midnight.sessionsStats.startHour.get(23), 1);
});

test('sesiones: byWeekday usa lunes=0 (2024-01-01 lunes, 2024-01-07 domingo)', () => {
  // Ancla la convención de sessions.js:69 (misma fórmula que derive.js:52).
  const ds = buildDataset([
    { t: D0, track: 'A', artist: 'X' }, // 2024-01-01 lunes
    { t: D0 + 6 * 86400, track: 'B', artist: 'Y' } // 2024-01-07 domingo
  ]);
  const m = aggregate(ds, { tz: UTC });
  assert.equal(m.sessionsStats.byWeekday.get(0), 1, 'lunes');
  assert.equal(m.sessionsStats.byWeekday.get(6), 1, 'domingo');
});

test('intraSession: A,A,B en una sesión → 1 repetición', () => {
  const ds = buildDataset([
    { t: D0, track: 'A', artist: 'X' },
    { t: D0 + 60, track: 'A', artist: 'X' },
    { t: D0 + 120, track: 'B', artist: 'Y' }
  ]);
  const m = aggregate(ds, { tz: UTC });
  assert.equal(m.intraSession.sessionsWithRepeats, 1);
  assert.equal(m.intraSession.repeatedPlays, 1);

  const sameTitleDiffArtist = buildDataset([
    { t: D0, track: 'Intro', artist: 'X' },
    { t: D0 + 60, track: 'Intro', artist: 'Y' }
  ]);
  const mDiff = aggregate(sameTitleDiffArtist, { tz: UTC });
  assert.equal(mDiff.intraSession.sessionsWithRepeats, 0);
  assert.equal(mDiff.intraSession.repeatedPlays, 0);
});

test('streak: días 1,2,3,5 → racha 3 (19723→19725)', () => {
  const ds = buildDataset([
    { t: D0, track: 'A', artist: 'X' },
    { t: D0 + 86400, track: 'B', artist: 'Y' },
    { t: D0 + 172800, track: 'C', artist: 'Z' },
    { t: D0 + 345600, track: 'D', artist: 'W' } // salta el día 4
  ]);
  const m = aggregate(ds, { tz: UTC });
  assert.equal(m.streak.len, 3);
  assert.equal(m.streak.start, 19723);
  assert.equal(m.streak.end, 19725);
  assert.equal(m.yearlyStreaks.get(2024).len, 3);
});

test('binge: A,A,B,A → max_run A=2, B=1; tabla binge top A', () => {
  const ds = buildDataset([
    { t: D0, track: 'A', artist: 'X' },
    { t: D0 + 60, track: 'A', artist: 'X' },
    { t: D0 + 120, track: 'B', artist: 'Y' },
    { t: D0 + 180, track: 'A', artist: 'X' }
  ]);
  const m = aggregate(ds, { tz: UTC });
  assert.equal(m.maxRun.size, 2);
  assert.equal(m.tables.binge[0].run, 2);
  assert.equal(m.tables.binge[0].track.name, 'A');
});

test('monthly_discovery: primera vez en enero (new), repetición en febrero (rep)', () => {
  const ds = buildDataset([
    { t: D0, track: 'A', artist: 'X' }, // 2024-01-01
    { t: D0 + 31 * 86400, track: 'A', artist: 'X' } // 2024-02-01
  ]);
  const m = aggregate(ds, { tz: UTC });
  const jan = m.monthlyDiscovery.get(202401);
  const feb = m.monthlyDiscovery.get(202402);
  assert.deepEqual({ plays: jan.plays, new: jan.new, rep: jan.rep }, { plays: 1, new: 1, rep: 0 });
  assert.deepEqual({ plays: feb.plays, new: feb.new, rep: feb.rep }, { plays: 1, new: 0, rep: 1 });
  assert.equal(m.yearly.get(2024).newTracks, 1);
});

test('zeroDays: días 1 y 3 activos → [día 2]', () => {
  const ds = buildDataset([
    { t: D0, track: 'A', artist: 'X' },
    { t: D0 + 172800, track: 'B', artist: 'Y' }
  ]);
  const m = aggregate(ds, { tz: UTC });
  assert.deepEqual(m.zeroDays, [19724]);
});

test('artista ausente: track con "(Desconocido)", no entra al mapa de artistas', () => {
  const ds = buildDataset([{ t: D0, track: 'A' }]);
  const m = aggregate(ds, { tz: UTC });
  assert.equal(m.artists.byId.size, 0);
  assert.equal(m.tracks.byId.size, 1);
  const t = [...m.tracks.byId.values()][0];
  assert.equal(t.artist, '(Desconocido)');
  assert.equal(m.totals.records, 1);
});

test('clave compuesta: mismo nombre de canción, artistas distintos → 2 tracks', () => {
  const ds = buildDataset([
    { t: D0, track: 'A', artist: 'X' },
    { t: D0 + 60, track: 'A', artist: 'Y' }
  ]);
  const m = aggregate(ds, { tz: UTC });
  assert.equal(m.tracks.byId.size, 2);
});

test('meta: firstTs/lastTs locales, tzId, records', () => {
  const ds = buildDataset([
    { t: D0, track: 'A', artist: 'X' },
    { t: D0 + 60, track: 'B', artist: 'Y' }
  ]);
  const m = aggregate(ds, { tz: UTC });
  assert.equal(m.meta.records, 2);
  assert.equal(m.meta.firstTs, D0);
  assert.equal(m.meta.lastTs, D0 + 60);
  assert.equal(m.meta.tzId, 'utc');
  assert.equal(m.meta.datedEvents, 2);
});

test('DST fall-back keeps UTC chronology and local range bounds separate', () => {
  // America/New_York 2024-11-03 06:00 UTC: EDT(-240) → EST(-300).
  const tz = offsetTable('ny', [[0, -240], [1730613600, -300]]);
  const ds = buildDataset([
    { t: 1730613540, track: 'A', artist: 'X' }, // 05:59 UTC → 01:59 EDT
    { t: 1730613660, track: 'B', artist: 'Y' } // 06:01 UTC → 01:01 EST
  ]);
  const m = aggregate(ds, { tz });
  assert.deepEqual([...m.cols.t], [1730613540, 1730613660]);
  assert.deepEqual([...m.cols.loc], [1730599140, 1730595660]);
  // Local bounds still cover both occurrences of the repeated hour.
  assert.equal(m.meta.firstTs, 1730595660);
  assert.equal(m.meta.lastTs, 1730599140);
  assert.equal(m.sessions.length, 1);
  assert.equal(m.sessions[0].duration, 120);
  assert.equal([...m.dayFirst.values()][0], 4294967297);
  assert.equal([...m.dayLast.values()][0], 8589934594);
});

test('DST changes preserve real session gaps, transitions and consecutive track runs', () => {
  for (const [transition, before, after] of [
    [1730613600, -240, -300],
    [1710054000, -300, -240]
  ]) {
    const tz = offsetTable('ny', [[0, before], [transition, after]]);
    const model = aggregate(buildDataset([
      { t: transition - 600, m: 180000, track: 'A', artist: 'X' },
      { t: transition + 600, m: 180000, track: 'B', artist: 'Y' },
      { t: transition + 1200, m: 180000, track: 'A', artist: 'X' }
    ]), { tz });
    assert.equal(model.sessions.length, 1);
    assert.equal(model.sessions[0].duration, 1980);
    assert.equal(model.maxRun.get(4294967297), 1);
    assert.equal(model.transitions.auto, 0);
    assert.equal(model.transitions.pairs.get(4294967298), 1);
    assert.equal(model.transitions.pairs.get(8589934593), 1);
    assert.equal([...model.dayFirst.values()][0], 4294967297);
  }
});

test('tables: tops por plays y ms, skip rate con mínimo, constancia, longevidad', () => {
  const events = [];
  // 3 artistas: X (3 plays, 300s), Y (2 plays, 200s), Z (1 play, 100s)
  for (let i = 0; i < 3; i++) events.push({ t: D0 + i * 60, m: 100000, track: `A${i}`, artist: 'X' });
  for (let i = 0; i < 2; i++) events.push({ t: D0 + 1000 + i * 60, m: 100000, track: `B${i}`, artist: 'Y' });
  events.push({ t: D0 + 2000, m: 100000, track: 'C', artist: 'Z' });
  const m = aggregate(buildDataset(events), { tz: UTC });
  assert.equal(m.tables.artists.byPlays[0].name, 'X');
  assert.equal(m.tables.artists.byPlays[0].plays, 3);
  assert.equal(m.tables.artists.byMs[0].name, 'X');
  assert.equal(m.tables.tracks.byPlays.length, 6);
  assert.equal(m.tables.albums.byPlays.length, 0); // sin álbumes
  assert.equal(m.tables.constancy.length, 0); // 1 mes activo < 6
  assert.equal(m.tables.longevity[0].name, 'X');
});

// Un local anterior a 1970 (p. ej. 1970-01-01T00:00:00Z en UTC-4 → local
// negativo) daba hora negativa; al storear en Uint8Array se convertía en
// 252 y temporal.js lanzaba TypeError en hour[252]. Con doble módulo da 20.
test('hora local pre-1970 (offset negativo) → hora 20, sin TypeError', () => {
  const ds = buildDataset([{ t: 0, m: 1000, track: 'A', artist: 'X' }]);
  const m = aggregate(ds, { tz: fixedTz('w4', -240) });
  assert.equal(m.cols.hour[0], 20);
  assert.equal(m.hour[20].plays, 1);
  assert.equal(m.sessionsStats.startHour.get(19), 1); // Estimated start: 19:59:59, end: 20:00.
  assert.equal(m.sessionsStats.byBlock.get(3), 1); // 20h → franja Noche
});

// La constancia es meses_activos / meses_del_intervalo. El intervalo se
// calculaba restando índices YYYYMM (202403 − 202310 + 1 = 94 en vez de 6),
// subestimando el coverage de toda carrera multianual. Con meses absolutos
// (y*12+m-1), 6 meses activos en oct-2023→mar-2024 dan coverage 1.
test('constancia interanual: oct-2023→mar-2024 activo da coverage 1', () => {
  const ds = buildDataset([
    { t: 1697371200, m: 1000, track: 'A', artist: 'X' }, // oct-2023
    { t: 1700049600, m: 1000, track: 'B', artist: 'X' }, // nov-2023
    { t: 1702641600, m: 1000, track: 'C', artist: 'X' }, // dic-2023
    { t: 1705320000, m: 1000, track: 'D', artist: 'X' }, // ene-2024
    { t: 1707998400, m: 1000, track: 'E', artist: 'X' }, // feb-2024
    { t: 1710504000, m: 1000, track: 'F', artist: 'X' } // mar-2024
  ]);
  const m = aggregate(ds, { tz: UTC });
  assert.equal(m.tables.constancy.length, 1);
  assert.equal(m.tables.constancy[0].name, 'X');
  assert.equal(m.tables.constancy[0].coverage, 1);
});

// Los álbumes guardan firstTs/lastTs/days/tracks (la ficha del álbum los
// necesita); cada track guarda su ak (enlace canción→álbum, 0 si no hay
// álbum); cada artista guarda sus ak (álbumes del artista) y su reloj
// día×hora (listeningClock por artista, índice dow*24+hour como dayHour).
test('album tracks retain their own totals and monthly history across shared titles', () => {
  const model = aggregate(buildDataset([
    { t: D0, m: 180000, track: 'Shared', artist: 'X', album: 'A' },
    { t: D0 + 31 * 86400, m: 180000, track: 'Shared', artist: 'X', album: 'B' },
    { t: D0 + 31 * 86400 + 180, m: 60000, track: 'Shared', artist: 'X', album: 'B', flags: 2 }
  ]), { tz: UTC });
  const track = [...model.tracks.byId.values()][0];
  assert.equal(model.tracks.byId.size, 1);
  assert.equal(track.plays, 3);
  const [first, second] = [...model.albums.byId.values()];
  const firstTrack = first.trackStats.get(track.tk);
  const secondTrack = second.trackStats.get(track.tk);
  assert.deepEqual([firstTrack.plays, firstTrack.ms, firstTrack.skips], [1, 180000, 0]);
  assert.deepEqual([secondTrack.plays, secondTrack.ms, secondTrack.skips], [2, 240000, 1]);
  assert.deepEqual([...firstTrack.monthly], [[202401, { plays: 1, ms: 180000 }]]);
  assert.deepEqual([...secondTrack.monthly], [[202402, { plays: 2, ms: 240000 }]]);
  assert.deepEqual([...first.monthly], [[202401, { plays: 1, ms: 180000 }]]);
  assert.deepEqual([...second.monthly], [[202402, { plays: 2, ms: 240000 }]]);
  assert.equal(track.ak, 0);
  assert.deepEqual([...track.albums], [first.id, second.id]);
});

test('groups: álbumes con tracks/fechas, tracks con ak, artistas con albums+clock', () => {
  const ds = buildDataset([
    { t: D0, m: 1000, track: 'A1', artist: 'X', album: 'L' },
    { t: D0 + 86400, m: 1000, track: 'A2', artist: 'X', album: 'L' },
    { t: D0 + 2 * 86400, m: 1000, track: 'B1', artist: 'X', album: 'M' },
    { t: D0 + 3 * 86400, m: 1000, track: 'A1', artist: 'Y', album: 'L' },
    { t: D0 + 4 * 86400, m: 1000, track: 'S', artist: 'X' } // sin álbum
  ]);
  const m = aggregate(ds, { tz: UTC });
  const album = (artist, name) => [...m.albums.byId.values()].find((a) => a.artist === artist && a.name === name);
  const track = (artist, name) => [...m.tracks.byId.values()].find((t) => t.artist === artist && t.name === name);
  const artist = (name) => [...m.artists.byId.values()].find((a) => a.name === name);

  const xl = album('X', 'L');
  assert.equal(xl.plays, 2);
  assert.equal(xl.tracks.size, 2);
  assert.equal(xl.days.size, 2);
  assert.equal(xl.firstTs, D0);
  assert.equal(xl.lastTs, D0 + 86400);
  assert.equal(album('X', 'M').tracks.size, 1);
  assert.notEqual(album('Y', 'L').id, xl.id); // mismo nombre, otro artista → otro ak

  assert.equal(track('X', 'A1').ak, xl.id);
  assert.equal(track('X', 'A1').months.size, 1);
  assert.ok(track('X', 'A1').months.has(202401));
  assert.equal(track('X', 'S').ak, 0); // sin álbum

  const x = artist('X');
  assert.equal(x.albums.size, 2); // L y M
  assert.ok(x.albums.has(xl.id));
  // D0 = lunes 2024-01-01 00:00Z → idx 0, 24, 48 (mar/mié 00:00), resto 0.
  assert.equal(x.clock[0], 1);
  assert.equal(x.clock[24], 1);
  assert.equal(x.clock[48], 1);
  let sum = 0;
  for (let i = 0; i < 168; i++) sum += x.clock[i];
  assert.equal(sum, x.plays);
});

// Cada entrada de yearly desglosa sus 4 franjas horarias: el stackedBar anual
// debe alimentarse del año, no del acumulado global (que supera el 100% del
// total del año cuando el historial abarca más de uno).
test('yearly desglosa franjas horarias por año (blocks)', () => {
  const ds = buildDataset([
    { t: 1685584800, m: 1000, track: 'A', artist: 'X' }, // 2023, 02:00 → madrugada
    { t: 1685584900, m: 2500, track: 'B', artist: 'Y' }, // 2023, 02:00 → madrugada
    { t: 1717250400, m: 4000, track: 'C', artist: 'Z' } // 2024, 14:00 → tarde
  ]);
  const m = aggregate(ds, { tz: UTC });
  assert.deepEqual([...m.yearly.get(2023).blocks], [2, 0, 0, 0]);
  assert.deepEqual([...m.yearly.get(2023).blocksMs], [3500, 0, 0, 0]);
  assert.deepEqual([...m.yearly.get(2024).blocks], [0, 0, 1, 0]);
  assert.deepEqual([...m.yearly.get(2024).blocksMs], [0, 0, 4000, 0]);
  assert.equal(m.blocks[0].plays, 2); // el global sigue intacto
});

test('tables: cap 100, lowSkipRate, oneHitWonders, deepCatalog, forgotten, and artist clockMs/tracks', () => {
  const events = [];
  for (let i = 0; i < 65; i++) {
    events.push({ t: D0 + i * 60, m: 30000, track: `T${i}`, artist: `Art${i}` });
  }
  for (let i = 0; i < 20; i++) {
    events.push({ t: D0 + 5000 + i * 60, m: 60000, track: 'Hit', artist: 'OneHit' });
  }
  for (let i = 0; i < 20; i++) {
    events.push({
      t: D0 + 86400 * 10 + i * 60,
      m: 45000,
      track: `DeepSong${i % 5}`,
      artist: 'Deep',
      flags: i < 10 ? 2 : 0
    });
  }
  const model = aggregate(buildDataset(events), { tz: UTC });
  assert.equal(model.tables.artists.byPlays.length, 67);

  const oneHitArtist = [...model.artists.byId.values()].find((artist) => artist.name === 'OneHit');
  assert.equal(oneHitArtist.tracks.size, 1);
  assert.equal(oneHitArtist.firstTrack, 'Hit');
  assert.ok(oneHitArtist.firstTrackTk > 0);
  let sumClockMs = 0;
  for (let i = 0; i < 168; i++) sumClockMs += oneHitArtist.clockMs[i];
  assert.equal(sumClockMs, oneHitArtist.ms);

  assert.equal(model.tables.lowSkipRate.artists[0].name, 'OneHit');
  assert.equal(model.tables.lowSkipRate.artists[0].skips, 0);
  assert.equal(model.tables.oneHitWonders[0].name, 'OneHit');
  assert.equal(model.tables.oneHitWonders[0].share, 1);
  assert.equal(model.tables.oneHitWonders[0].topTrack.name, 'Hit');
  assert.equal(model.tables.deepCatalog[0].name, 'Deep');
  assert.equal(model.tables.deepCatalog[0].tracks.size, 5);
  assert.equal(model.tables.forgotten.artists[0].name, 'OneHit');
});

test('hourTracks and blocks top entities count only valid listens (ms >= minMs)', () => {
  const ds = buildDataset([
    { t: D0 + 3600, m: 2000, track: 'SkippedSong', artist: 'X' },
    { t: D0 + 3610, m: 2000, track: 'SkippedSong', artist: 'X' },
    { t: D0 + 3620, m: 2000, track: 'SkippedSong', artist: 'X' },
    { t: D0 + 3700, m: 180000, track: 'RealSong', artist: 'Y' },
    { t: D0 + 3900, m: 180000, track: 'RealSong', artist: 'Y' }
  ]);
  const model = aggregate(ds, { tz: UTC });
  assert.equal(model.hour[1].plays, 5);
  assert.equal(model.hourTracks[1].size, 1);
  const [[topTk, topPlays]] = [...model.hourTracks[1].entries()];
  assert.equal(model.tracks.byId.get(topTk).name, 'RealSong');
  assert.equal(topPlays, 2);
});
