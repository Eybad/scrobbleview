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
  assert.deepEqual(m.totals.msDist.map((x) => x.label), ['<10s', '10-30s', '30s-1m', '1-3m', '3-5m', '>5m']);
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
  const a = aggregate(ds, { tz: fixedTz('tz', -240) });
  const b = aggregate(ds, { tz: offsetTable('tz', [[0, -240]]) });
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

test('DST fall-back: el orden local difiere del orden UTC (re-hora repetida)', () => {
  // America/New_York 2024-11-03 06:00 UTC: EDT(-240) → EST(-300).
  const tz = offsetTable('ny', [[0, -240], [1730613600, -300]]);
  const ds = buildDataset([
    { t: 1730613540, track: 'A', artist: 'X' }, // 05:59 UTC → 01:59 EDT
    { t: 1730613660, track: 'B', artist: 'Y' } // 06:01 UTC → 01:01 EST
  ]);
  const m = aggregate(ds, { tz });
  // Orden local: B (01:01 EST) antes que A (01:59 EDT), aunque UTC sea al revés.
  assert.equal(m.cols.t[0], 1730613660);
  assert.equal(m.cols.t[1], 1730613540);
  // firstTs/lastTs son LOCALES: B local = 1730595660, A local = 1730599140.
  assert.equal(m.meta.firstTs, 1730595660);
  assert.equal(m.meta.lastTs, 1730599140);
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