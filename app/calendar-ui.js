import { esc, fmtNum, fmtMs, DOW_SHORT, NO_DATA } from '../src/charts.js';

export const MONTHS_LONG = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

export function parseCalendarState(query) {
  const params = new URLSearchParams((query ?? '').replace(/^\?/, ''));
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(params.get('cm') ?? '');
  const year = match ? Number(match[1]) : null;
  return {
    calMonth: match && year >= 100 ? { year, month: Number(match[2]) } : null,
    normalizeYears: params.get('cn') === '1'
  };
}

function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 100 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : null;
}

export function parseCalendarSelection(query) {
  const params = new URLSearchParams((query ?? '').replace(/^\?/, ''));
  return {
    calDate: validCalendarDate(params.get('cd')),
    calRangeFrom: validCalendarDate(params.get('cf')),
    calRangeTo: validCalendarDate(params.get('ct'))
  };
}

export function calendarQuery(query, calMonth, normalizeYears, selection = {}) {
  const params = new URLSearchParams((query ?? '').replace(/^\?/, ''));
  if (calMonth && Number.isInteger(calMonth.year) && calMonth.year >= 100 && calMonth.year <= 9999 && Number.isInteger(calMonth.month) && calMonth.month >= 1 && calMonth.month <= 12) {
    params.set('cm', `${String(calMonth.year).padStart(4, '0')}-${String(calMonth.month).padStart(2, '0')}`);
  } else params.delete('cm');
  if (normalizeYears) params.set('cn', '1');
  else params.delete('cn');
  const selectedDate = validCalendarDate(selection.date);
  const rangeFrom = validCalendarDate(selection.rangeFrom);
  const rangeTo = validCalendarDate(selection.rangeTo);
  if (selectedDate) params.set('cd', selectedDate);
  else params.delete('cd');
  if (rangeFrom) params.set('cf', rangeFrom);
  else params.delete('cf');
  if (rangeTo) params.set('ct', rangeTo);
  else params.delete('ct');
  return params.toString();
}

export function calendarInspectorHTML({ year = null, byMs = true } = {}) {
  const metricName = byMs ? 'tiempo escuchado' : 'reproducciones';
  return `<section class="calendar-inspector card" id="calendar-inspector" role="region" aria-label="Inspector de día y selector de rango">
    <div class="calendar-inspector__head">
      <h2>Inspector de día y selección de rango</h2>
      <p class="calendar-inspector__hint">Tocá cualquier celda para consultar ${esc(metricName)}. Podés filtrar el día o armar un rango con inicio y fin sin usar atajos de teclado.</p>
    </div>
    <div class="calendar-inspector__body">
      <div class="calendar-inspector__selection" id="cal-inspector-selection" aria-live="polite">
        <span class="cal-inspector-date" id="cal-selected-date">Ningún día seleccionado</span>
        <span class="cal-inspector-value" id="cal-selected-value"></span>
      </div>
      <div class="calendar-inspector__actions">
        <a class="btn btn-secondary btn-sm" id="cal-day-detail" hidden>Ver detalle del día</a>
        <button type="button" class="btn btn-secondary btn-sm" data-cal-action="filter-day" id="btn-cal-filter-day" disabled>Filtrar este día</button>
        <button type="button" class="btn btn-secondary btn-sm" data-cal-action="set-start" id="btn-cal-set-start" disabled>Fijar como inicio</button>
        <button type="button" class="btn btn-secondary btn-sm" data-cal-action="set-end" id="btn-cal-set-end" disabled>Fijar como fin</button>
      </div>
      <div class="calendar-inspector__range-form">
        <div class="calendar-inspector__range-fields">
          <label class="calendar-inspector__field">
            <span>Desde</span>
            <input type="date" id="cal-range-from" name="cal-range-from">
          </label>
          <label class="calendar-inspector__field">
            <span>Hasta</span>
            <input type="date" id="cal-range-to" name="cal-range-to">
          </label>
        </div>
        <button type="button" class="btn btn-primary btn-sm" data-cal-action="apply-range" id="btn-cal-apply-range">Aplicar rango</button>
      </div>
    </div>
  </section>`;
}

export function calendarMonthViewHTML({
  year,
  month,
  daysMap,
  colorScale,
  byMs = true,
  dataRange = null
}) {
  const m = Math.max(1, Math.min(12, month));
  const valFmt = byMs ? fmtMs : fmtNum;
  const firstDate = new Date(Date.UTC(year, m - 1, 1));
  const firstDow = (firstDate.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, m, 0)).getUTCDate();

  const prevMonthYear = m === 1 ? year - 1 : year;
  const prevMonth = m === 1 ? 12 : m - 1;
  const nextMonthYear = m === 12 ? year + 1 : year;
  const nextMonth = m === 12 ? 1 : m + 1;

  let headersHtml = '';
  for (const dow of DOW_SHORT) {
    headersHtml += `<th scope="col" class="cal-month-head-col">${esc(dow)}</th>`;
  }

  let cellsHtml = '';
  let dayOfWeek = firstDow;

  if (firstDow > 0) {
    cellsHtml += `<td colspan="${firstDow}" class="cal-month-empty" aria-hidden="true"></td>`;
  }

  const dailyList = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const epochDay = Math.floor(Date.UTC(year, m - 1, d) / 86400000);
    const outOfData = dataRange != null && (epochDay < dataRange.from || epochDay > dataRange.to);

    const record = daysMap.get(iso);
    const val = record ? (byMs ? (record.ms ?? record.value ?? 0) : (record.plays ?? record.value ?? 0)) : 0;
    const fill = outOfData ? NO_DATA : colorScale(val);
    const valLabel = outOfData ? 'sin datos' : (val > 0 ? valFmt(val) : 'sin actividad');

    dailyList.push({ iso, val, valLabel });

    cellsHtml += `<td class="cal-month-day-cell">
      <button type="button" class="cal-month-cell" data-day="${epochDay}" data-date="${iso}" data-val="${val}" data-label="${esc(valLabel)}" style="background-color: ${fill}" aria-label="${iso}: ${esc(valLabel)}">
        <span class="cal-month-cell__day">${d}</span>
      </button>
    </td>`;

    dayOfWeek = (dayOfWeek + 1) % 7;
    if (dayOfWeek === 0 && d < daysInMonth) {
      cellsHtml += '</tr><tr>';
    }
  }

  if (dayOfWeek > 0) {
    cellsHtml += `<td colspan="${7 - dayOfWeek}" class="cal-month-empty" aria-hidden="true"></td>`;
  }

  const listRows = dailyList.map((item) => `<tr>
    <th scope="row">${esc(item.iso)}</th>
    <td class="n">${esc(item.valLabel)}</td>
  </tr>`).join('');

  return `<section class="calendar-month card" role="region" aria-label="Vista mensual interactiva de ${esc(MONTHS_LONG[m - 1])} ${year}">
    <div class="calendar-month__header">
      <div class="calendar-month__nav">
        <button type="button" class="btn-step" data-cal-nav="prev-month" data-cal-year="${prevMonthYear}" data-cal-month="${prevMonth}" aria-label="Mes anterior (a ${esc(MONTHS_LONG[prevMonth - 1])})">‹</button>
        <h3 class="calendar-month__title">${esc(MONTHS_LONG[m - 1])} ${year}</h3>
        <button type="button" class="btn-step" data-cal-nav="next-month" data-cal-year="${nextMonthYear}" data-cal-month="${nextMonth}" aria-label="Mes siguiente (a ${esc(MONTHS_LONG[nextMonth - 1])})">›</button>
      </div>
    </div>
    <div class="calendar-month__grid-wrap">
      <table class="calendar-month__table" role="grid" aria-label="Días de ${esc(MONTHS_LONG[m - 1])} ${year}">
        <thead>
          <tr>${headersHtml}</tr>
        </thead>
        <tbody>
          <tr>${cellsHtml}</tr>
        </tbody>
      </table>
    </div>
    <details class="table-fallback">
      <summary>Ver lista diaria de ${esc(MONTHS_LONG[m - 1])}</summary>
      <div class="table-scroll">
        <table>
          <caption>Actividad diaria en ${esc(MONTHS_LONG[m - 1])} ${year}</caption>
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col" class="n">Valor</th>
            </tr>
          </thead>
          <tbody>
            ${listRows}
          </tbody>
        </table>
      </div>
    </details>
  </section>`;
}

export function calendarScaleToggleHTML({ normalizeYears = false, maxValFormatted = '' } = {}) {
  if (!normalizeYears) {
    return `<div class="calendar-scale-toggle card-subtle">
      <div class="scale-info">
        <strong>Escala compartida:</strong> igual color equivale a igual valor entre todos los años mostrados${maxValFormatted ? ` (máximo global: ${esc(maxValFormatted)})` : ''}.
      </div>
      <button type="button" class="btn btn-secondary btn-sm" data-action="toggle-cal-scale" data-normalize="true">Normalizar cada año</button>
    </div>`;
  }

  return `<div class="calendar-scale-toggle card-subtle">
    <div class="scale-info">
      <strong>Escala normalizada:</strong> cada año satura con su propio máximo. Los colores no representan la misma cifra entre años.
    </div>
    <button type="button" class="btn btn-secondary btn-sm" data-action="toggle-cal-scale" data-normalize="false">Usar escala compartida</button>
  </div>`;
}
