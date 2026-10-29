// src/query.js — Funciones puras de consulta sobre entidades y catálogo (Etapa 3)
//
// Responsabilidad única: filtrado de texto, ordenamiento determinista, desempates,
// cálculo de cuota global, rangos de resultados y paginación sobre entidades.
// Cero dependencias de DOM, renderizado o APIs del navegador.

export function normalizeSearchText(str) {
  if (!str) return '';
  return String(str)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function matchesQuery(item, normalizedQuery, searchFields = ['name', 'artist']) {
  if (!normalizedQuery) return true;
  for (const field of searchFields) {
    const val = typeof field === 'function' ? field(item) : item[field];
    if (val != null && normalizeSearchText(val).includes(normalizedQuery)) {
      return true;
    }
  }
  return false;
}

export function rankEntities(items, { metric = 'ms', totalMetric = 0 } = {}) {
  const list = Array.isArray(items) ? [...items] : [...items];
  const byMs = metric === 'ms';

  list.sort((a, b) => {
    if (byMs) {
      const dMs = (b.ms ?? 0) - (a.ms ?? 0);
      if (dMs !== 0) return dMs;
      const dPlays = (b.plays ?? 0) - (a.plays ?? 0);
      if (dPlays !== 0) return dPlays;
    } else {
      const dPlays = (b.plays ?? 0) - (a.plays ?? 0);
      if (dPlays !== 0) return dPlays;
      const dMs = (b.ms ?? 0) - (a.ms ?? 0);
      if (dMs !== 0) return dMs;
    }
    const nameDiff = String(a.name ?? '').localeCompare(String(b.name ?? ''));
    if (nameDiff !== 0) return nameDiff;
    const artistDiff = String(a.artist ?? '').localeCompare(String(b.artist ?? ''));
    if (artistDiff !== 0) return artistDiff;
    const aId = a.id ?? a.tk ?? 0;
    const bId = b.id ?? b.tk ?? 0;
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });

  const tot = totalMetric > 0 ? totalMetric : 0;
  return list.map((item, index) => {
    const val = byMs ? (item.ms ?? 0) : (item.plays ?? 0);
    const share = tot > 0 ? val / tot : 0;
    return {
      item,
      metricRank: index + 1,
      share
    };
  });
}

function getItemSortValue(entry, sortBy) {
  const it = entry.item;
  switch (sortBy) {
    case 'metric':
    case 'rank':
      return entry.metricRank;
    case 'name':
      return String(it.name ?? '').toLowerCase();
    case 'artist':
      return String(it.artist ?? '').toLowerCase();
    case 'plays':
      return it.plays ?? 0;
    case 'ms':
      return it.ms ?? 0;
    case 'days':
      return it.days?.size ?? it.days ?? 0;
    case 'months':
      return it.months?.size ?? it.months ?? 0;
    case 'firstTs':
      return it.firstTs ?? 0;
    case 'lastTs':
      return it.lastTs ?? 0;
    case 'intensity': {
      const days = it.days?.size ?? it.days ?? 0;
      return days > 0 ? (it.plays ?? 0) / days : 0;
    }
    case 'skipRate': {
      const known = it.skipKnown ?? 0;
      return known > 0 ? (it.skips ?? 0) / known : 0;
    }
    case 'lowSkipRate': {
      const known = it.skipKnown ?? 0;
      return known > 0 ? (it.skips ?? 0) / known : 1;
    }
    default:
      return it[sortBy] ?? 0;
  }
}

export function queryCatalog(items, {
  metric = 'ms',
  totalMetric = 0,
  query = '',
  searchFields = ['name', 'artist'],
  sortBy = 'metric',
  sortDir = null,
  page = 1,
  pageSize = 25,
  minPlays = null,
  minMonths = null,
  minKnownSkips = null,
  filterFn = null
} = {}) {
  const ranked = rankEntities(items, { metric, totalMetric });
  const totalItems = ranked.length;
  const normQuery = normalizeSearchText(query);

  let filtered = ranked.filter((entry) => {
    const it = entry.item;
    if (minPlays != null && (it.plays ?? 0) < minPlays) return false;
    if (minMonths != null && (it.months?.size ?? it.months ?? 0) < minMonths) return false;
    if (minKnownSkips != null && (it.skipKnown ?? 0) < minKnownSkips) return false;
    if (filterFn != null && !filterFn(it)) return false;
    if (normQuery && !matchesQuery(it, normQuery, searchFields)) return false;
    return true;
  });

  const totalMatches = filtered.length;

  // Criterio de dirección predeterminado si no se especifica
  let effectiveDir = sortDir;
  if (!effectiveDir) {
    if (sortBy === 'name' || sortBy === 'artist' || sortBy === 'rank' || sortBy === 'metric' || sortBy === 'lowSkipRate') {
      effectiveDir = 'asc';
    } else {
      effectiveDir = 'desc';
    }
  }

  filtered.sort((a, b) => {
    const valA = getItemSortValue(a, sortBy);
    const valB = getItemSortValue(b, sortBy);

    let cmp = 0;
    if (typeof valA === 'string' && typeof valB === 'string') {
      cmp = valA.localeCompare(valB);
    } else {
      cmp = (valA < valB) ? -1 : (valA > valB) ? 1 : 0;
    }

    if (effectiveDir === 'desc') cmp = -cmp;
    if (cmp !== 0) return cmp;

    // Desempates deterministas estables
    if (a.metricRank !== b.metricRank) return a.metricRank - b.metricRank;
    const aId = a.item.id ?? a.item.tk ?? 0;
    const bId = b.item.id ?? b.item.tk ?? 0;
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });

  const validPageSize = Math.max(1, Number(pageSize) || 25);
  const totalPages = Math.max(1, Math.ceil(totalMatches / validPageSize));
  const validPage = Math.max(1, Math.min(Number(page) || 1, totalPages));

  const start = totalMatches === 0 ? 0 : (validPage - 1) * validPageSize;
  const end = Math.min(start + validPageSize, totalMatches);

  const rows = [];
  for (let i = start; i < end; i++) {
    rows.push({
      item: filtered[i].item,
      metricRank: filtered[i].metricRank,
      share: filtered[i].share,
      resultRow: i + 1
    });
  }

  return {
    rows,
    totalItems,
    totalMatches,
    page: validPage,
    pageSize: validPageSize,
    effectiveDir,
    totalPages,
    startRow: totalMatches === 0 ? 0 : start + 1,
    endRow: end
  };
}
