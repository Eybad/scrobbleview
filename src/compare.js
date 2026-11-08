import { civilFromDays } from './aggregate/impl/derive.js';
import { fmtNum, fmtMs } from './charts.js';

function validRange(range) {
  return range && Number.isSafeInteger(range.from) && Number.isSafeInteger(range.to) && range.from <= range.to;
}

function previousYearDay(day) {
  const civil = civilFromDays(day);
  const year = civil.y - 1;
  if (year < 100) return null;
  const daysInMonth = new Date(Date.UTC(year, civil.m, 0)).getUTCDate();
  const clampedDay = Math.min(civil.d, daysInMonth);
  return Math.floor(Date.UTC(year, civil.m - 1, clampedDay) / 86400000);
}

export function calculateCompareRange(preset, rangeA, dataRange = null, manualRangeB = null) {
  if (!validRange(rangeA)) throw new RangeError('El período A no es válido.');
  const fromA = rangeA.from;
  const toA = rangeA.to;
  const durationSec = Math.max(1, toA - fromA + 1);

  let fromB = 0;
  let toB = 0;

  if (preset === 'equal_previous') {
    toB = fromA - 1;
    fromB = toB - durationSec + 1;
  } else if (preset === 'same_period_last_year') {
    const dayFromA = Math.floor(fromA / 86400);
    const dayToA = Math.floor(toA / 86400);
    const fromDayB = previousYearDay(dayFromA);
    const toDayB = previousYearDay(dayToA);
    if (fromDayB == null || toDayB == null) throw new RangeError('No hay un año anterior válido para comparar.');
    fromB = fromDayB * 86400;
    toB = toDayB * 86400 + 86399;
  } else if (preset === 'manual') {
    if (!validRange(manualRangeB)) throw new RangeError('El período B manual no es válido.');
    fromB = manualRangeB.from;
    toB = manualRangeB.to;
  } else {
    throw new TypeError(`Preset de comparación desconocido: ${preset}`);
  }

  const rangeB = { from: fromB, to: toB };

  let isOutOfRange = false;
  let warning = '';

  if (dataRange != null && dataRange.minSec != null && dataRange.maxSec != null) {
    const hasOutOfRangeWindow = [rangeA, rangeB].some((range) => range.from < dataRange.minSec || range.to > dataRange.maxSec);
    if (hasOutOfRangeWindow) {
      isOutOfRange = true;
      const minIso = new Date(dataRange.minSec * 1000).toISOString().slice(0, 10);
      const maxIso = new Date(dataRange.maxSec * 1000).toISOString().slice(0, 10);
      warning = `Una o ambas ventanas exceden el intervalo observado en los archivos (${minIso} a ${maxIso}); la presencia de eventos no garantiza cobertura completa.`;
    }
  }

  return {
    preset,
    rangeA,
    rangeB,
    durationSec,
    isOutOfRange,
    warning
  };
}

export function computeMetricDelta(valA, valB, format = fmtNum) {
  const diff = valA - valB;
  let pctLabel = '';

  if (valB === 0) {
    pctLabel = valA === 0 ? '0,0%' : 'nuevo';
  } else {
    const pct = ((valA - valB) / valB) * 100;
    const sign = pct > 0 ? '+' : '';
    pctLabel = `${sign}${pct.toFixed(1).replace('.', ',')}%`;
  }

  return {
    valA,
    valB,
    diff,
    diffFormatted: (diff > 0 ? '+' : '') + format(diff),
    pctLabel,
    isFinite: true
  };
}

export function compareAverages(totals, range, activeDays) {
  const durationSec = Math.max(1, range.to - range.from + 1);
  const totalDays = Math.max(1, Math.round(durationSec / 86400));
  const safeActiveDays = Math.max(0, activeDays);

  const plays = totals.plays ?? totals.records ?? 0;
  const ms = totals.ms ?? 0;

  return {
    totalDays,
    activeDays: safeActiveDays,
    playsPerRangeDay: plays / totalDays,
    msPerRangeDay: ms / totalDays,
    playsPerActiveDay: safeActiveDays > 0 ? plays / safeActiveDays : 0,
    msPerActiveDay: safeActiveDays > 0 ? ms / safeActiveDays : 0,
    rangeDayLabel: `Promedio por día del rango (${totalDays} días del intervalo)`,
    activeDayLabel: `Promedio por día activo (${safeActiveDays} días con actividad)`
  };
}

export function compareEntityRankings(mapA, mapB, totalA, totalB, topN = 50) {
  const sortedA = [...mapA.entries()]
    .map(([key, data]) => ({ key, name: data.name ?? key, value: data.value ?? data.ms ?? data.plays ?? 0 }))
    .sort((a, b) => b.value - a.value || String(a.name).localeCompare(String(b.name), 'es') || String(a.key).localeCompare(String(b.key)));

  const sortedB = [...mapB.entries()]
    .map(([key, data]) => ({ key, name: data.name ?? key, value: data.value ?? data.ms ?? data.plays ?? 0 }))
    .sort((a, b) => b.value - a.value || String(a.name).localeCompare(String(b.name), 'es') || String(a.key).localeCompare(String(b.key)));

  const rankMapA = new Map();
  sortedA.forEach((item, idx) => rankMapA.set(item.key, { rank: idx + 1, item }));

  const rankMapB = new Map();
  sortedB.forEach((item, idx) => rankMapB.set(item.key, { rank: idx + 1, item }));

  const allKeys = new Set([...rankMapA.keys(), ...rankMapB.keys()]);
  const rows = [];

  for (const key of allKeys) {
    const entryA = rankMapA.get(key);
    const entryB = rankMapB.get(key);

    const valA = entryA ? entryA.item.value : 0;
    const valB = entryB ? entryB.item.value : 0;
    const rankA = entryA ? entryA.rank : null;
    const rankB = entryB ? entryB.rank : null;
    const name = entryA ? entryA.item.name : (entryB ? entryB.item.name : key);

    let status = 'Mantiene';
    let rankDelta = null;

    if (rankA != null && rankB == null) {
      status = 'Entrada';
    } else if (rankA == null && rankB != null) {
      status = 'Salida';
    } else if (rankA != null && rankB != null) {
      rankDelta = rankB - rankA;
      status = rankDelta > 0 ? `▲ ${rankDelta}` : (rankDelta < 0 ? `▼ ${Math.abs(rankDelta)}` : '=');
    }

    const shareA = totalA > 0 ? (valA / totalA) * 100 : null;
    const shareB = totalB > 0 ? (valB / totalB) * 100 : null;
    const shareDiff = shareA != null && shareB != null ? shareA - shareB : null;

    rows.push({
      key,
      name,
      valA,
      valB,
      diff: valA - valB,
      rankA,
      rankB,
      rankDelta,
      status,
      shareA,
      shareB,
      shareDiff,
      shareDiffLabel: shareDiff == null ? 'sin base' : `${shareDiff >= 0 ? '+' : ''}${shareDiff.toFixed(1).replace('.', ',')} pp`
    });
  }

  rows.sort((a, b) => {
    if (a.rankA != null && b.rankA != null) return a.rankA - b.rankA;
    if (a.rankA != null) return -1;
    if (b.rankA != null) return 1;
    return (a.rankB ?? 0) - (b.rankB ?? 0);
  });

  return rows.slice(0, topN);
}

export function formatDeltaNotice(delta, unit = '') {
  const sign = delta.diff > 0 ? '+' : '';
  return `${sign}${delta.diff} ${unit} (${delta.pctLabel})`;
}

export function buildCompareSeries(dailyMap, range, granularity = 'daily', byMs = false) {
  const startDay = Math.floor(range.from / 86400);
  const endDay = Math.floor(range.to / 86400);

  if (startDay > endDay) return [];

  if (granularity === 'daily') {
    const list = [];
    for (let d = startDay; d <= endDay; d++) {
      const entry = dailyMap.get(d);
      const val = entry ? (byMs ? (entry.ms ?? 0) : (entry.plays ?? 0)) : 0;
      const c = civilFromDays(d);
      const label = `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
      list.push({ key: d, label, value: val, isPartial: false });
    }
    return list;
  }

  if (granularity === 'weekly') {
    const weeks = [];
    let curWeek = null;

    for (let d = startDay; d <= endDay; d++) {
      const dow = ((d + 3) % 7 + 7) % 7;
      if (!curWeek || dow === 0) {
        if (curWeek) weeks.push(curWeek);
        const c = civilFromDays(d);
        curWeek = {
          key: `W-${c.y}-${c.m}-${c.d}`,
          startDay: d,
          endDay: d,
          startDow: dow,
          endDow: dow,
          label: `Semana ${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`,
          value: 0,
          isPartial: dow !== 0
        };
      }
      const entry = dailyMap.get(d);
      const val = entry ? (byMs ? (entry.ms ?? 0) : (entry.plays ?? 0)) : 0;
      curWeek.value += val;
      curWeek.endDay = d;
      curWeek.endDow = dow;
    }

    if (curWeek) {
      if (curWeek.endDow !== 6) curWeek.isPartial = true;
      weeks.push(curWeek);
    }

    return weeks;
  }

  if (granularity === 'monthly') {
    const months = [];
    let curMonth = null;

    for (let d = startDay; d <= endDay; d++) {
      const c = civilFromDays(d);
      const monthCode = c.y * 100 + c.m;

      if (!curMonth || curMonth.monthCode !== monthCode) {
        if (curMonth) months.push(curMonth);
        const daysInMonth = new Date(Date.UTC(c.y, c.m, 0)).getUTCDate();
        curMonth = {
          key: `M-${monthCode}`,
          monthCode,
          year: c.y,
          month: c.m,
          startDayOfM: c.d,
          endDayOfM: c.d,
          daysInMonth,
          label: `${String(c.m).padStart(2, '0')}/${c.y}`,
          value: 0,
          isPartial: c.d !== 1
        };
      }
      const entry = dailyMap.get(d);
      const val = entry ? (byMs ? (entry.ms ?? 0) : (entry.plays ?? 0)) : 0;
      curMonth.value += val;
      curMonth.endDayOfM = c.d;
    }

    if (curMonth) {
      if (curMonth.endDayOfM !== curMonth.daysInMonth) curMonth.isPartial = true;
      months.push(curMonth);
    }

    return months;
  }

  return [];
}
