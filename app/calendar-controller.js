import { calendarGridTargetDate, calendarMonthDaysHTML, calendarQuery } from './calendar-ui.js';
import { formatSemanticRoute } from './routes.js';
import { fmtMs, fmtNum } from '../src/charts.js';

const LIST_LAYOUT_MAX_WIDTH = 308;

export function mountCalendar(root, { readState, dispatch }) {
  const view = root.ownerDocument.defaultView;
  let observedWrap = null;
  let disposed = false;
  const resizeObserver = view?.ResizeObserver ? new view.ResizeObserver(() => refreshLayout()) : null;

  function getSnapshot() {
    const snapshot = readState();
    if (disposed || snapshot?.route?.view !== 'calendar' || !snapshot.context?.calendarMonthOptions) return null;
    return snapshot;
  }

  function syncDaySelection(snapshot) {
    const selectedDate = snapshot.state.calDate ?? null;
    const selectedDay = selectedDate == null ? null : Math.floor(Date.parse(`${selectedDate}T00:00:00Z`) / 86400000);
    for (const day of root.querySelectorAll('[data-day]')) {
      day.classList.toggle('is-selected', selectedDay != null && Number(day.dataset.day) === selectedDay);
    }

    const wrap = root.querySelector('.calendar-month__grid-wrap');
    const days = [...(wrap?.querySelectorAll('[data-date]') ?? [])];
    const selected = days.find((day) => day.dataset.date === selectedDate) ?? null;
    const tabStop = selected ?? days[0] ?? null;
    for (const day of days) {
      const isSelected = day === selected;
      day.tabIndex = day === tabStop ? 0 : -1;
      if (day.parentElement?.matches('[role="gridcell"]')) {
        day.parentElement.setAttribute('aria-selected', String(isSelected));
      }
      if (day.hasAttribute('aria-pressed')) day.setAttribute('aria-pressed', String(isSelected));
    }
  }

  function syncInspector(snapshot) {
    const state = snapshot.state;
    const context = snapshot.context;
    const model = snapshot.model;
    const dateOutput = root.querySelector('#cal-selected-date');
    if (!dateOutput) return;
    const fromInput = root.querySelector('#cal-range-from');
    const toInput = root.querySelector('#cal-range-to');
    if (fromInput) fromInput.value = state.calRangeFrom ?? '';
    if (toInput) toInput.value = state.calRangeTo ?? '';
    const selectedDate = state.calDate ?? null;
    if (!selectedDate) {
      dateOutput.textContent = 'Ningún día seleccionado';
      root.querySelector('#cal-selected-value')?.replaceChildren();
      root.querySelector('#btn-cal-filter-day')?.setAttribute('disabled', '');
      root.querySelector('#btn-cal-set-start')?.setAttribute('disabled', '');
      root.querySelector('#btn-cal-set-end')?.setAttribute('disabled', '');
      root.querySelector('#cal-day-detail')?.setAttribute('hidden', '');
      syncDaySelection(snapshot);
      return;
    }

    const day = Math.floor(Date.parse(`${selectedDate}T00:00:00Z`) / 86400000);
    const matches = [...root.querySelectorAll('[data-day]')]
      .filter((cell) => Number(cell.dataset.day) === day);
    const title = matches[0]?.dataset.label || matches[0]?.querySelector('title')?.textContent;
    const record = model?.daily?.get(day);
    const firstDay = model?.meta?.firstTs == null ? null : Math.floor(model.meta.firstTs / 86400);
    const lastDay = model?.meta?.lastTs == null ? null : Math.floor(model.meta.lastTs / 86400);
    const isOutOfData = firstDay == null || day < firstDay || day > lastDay;
    const byMs = context.metric === 'ms';
    const value = record?.[byMs ? 'ms' : 'plays'] ?? 0;
    const label = title || (isOutOfData ? 'sin datos' : (value > 0 ? (byMs ? fmtMs(value) : fmtNum(value)) : 'sin actividad'));
    dateOutput.textContent = selectedDate;
    const valueOutput = root.querySelector('#cal-selected-value');
    if (valueOutput) valueOutput.textContent = `· ${label}`;
    root.querySelector('#btn-cal-filter-day')?.removeAttribute('disabled');
    root.querySelector('#btn-cal-set-start')?.removeAttribute('disabled');
    root.querySelector('#btn-cal-set-end')?.removeAttribute('disabled');
    const detailLink = root.querySelector('#cal-day-detail');
    if (detailLink) {
      const query = calendarQuery(context.query, state.calMonth, state.normalizeYears, {
        date: selectedDate,
        rangeFrom: state.calRangeFrom,
        rangeTo: state.calRangeTo
      });
      detailLink.href = formatSemanticRoute('day', selectedDate, query);
      detailLink.removeAttribute('hidden');
    }
    syncDaySelection(snapshot);
  }

  function refreshLayout(snapshot = getSnapshot()) {
    if (!snapshot) return;
    const wrap = root.querySelector('.calendar-month__grid-wrap');
    if (!wrap) return;
    if (resizeObserver && observedWrap !== wrap) {
      resizeObserver.disconnect();
      resizeObserver.observe(wrap);
      observedWrap = wrap;
    }
    const nextLayout = wrap.clientWidth < LIST_LAYOUT_MAX_WIDTH ? 'list' : 'grid';
    if (wrap.dataset.layout !== nextLayout) {
      const activeDay = wrap.contains(root.ownerDocument.activeElement)
        ? root.ownerDocument.activeElement.closest('[data-date]')?.dataset.date
        : null;
      wrap.innerHTML = calendarMonthDaysHTML({ ...snapshot.context.calendarMonthOptions, layout: nextLayout });
      wrap.dataset.layout = nextLayout;
      syncDaySelection(snapshot);
      if (activeDay) wrap.querySelector(`[data-date="${activeDay}"]`)?.focus({ preventScroll: true });
      return;
    }
    syncDaySelection(snapshot);
  }

  function refresh() {
    const snapshot = getSnapshot();
    if (!snapshot) {
      resizeObserver?.disconnect();
      observedWrap = null;
      return;
    }
    syncInspector(snapshot);
    refreshLayout(snapshot);
  }

  function handleClick(event) {
    const snapshot = getSnapshot();
    if (!snapshot) return;
    const dayElement = event.target.closest?.('[data-day]');
    if (dayElement && root.contains(dayElement)) {
      const day = Number(dayElement.dataset.day);
      if (!Number.isFinite(day)) return;
      const date = dayElement.dataset.date || new Date(day * 86400000).toISOString().slice(0, 10);
      const fromInput = root.querySelector('#cal-range-from');
      const toInput = root.querySelector('#cal-range-to');
      dispatch({
        type: 'select-day',
        date,
        day,
        label: dayElement.dataset.label || dayElement.querySelector('title')?.textContent || dayElement.getAttribute('aria-label') || '',
        rangeFrom: fromInput?.value || null,
        rangeTo: toInput?.value || null,
        shiftKey: event.shiftKey
      });
      if (!event.shiftKey) refresh();
      return;
    }

    const action = event.target.closest?.('[data-cal-action]');
    if (action && root.contains(action)) {
      const date = snapshot.state.calDate;
      const type = action.dataset.calAction;
      if (type === 'filter-day' && date) dispatch({ type: 'filter-day', date });
      else if ((type === 'set-start' || type === 'set-end') && date) {
        dispatch({ type: 'set-range-bound', field: type === 'set-start' ? 'calRangeFrom' : 'calRangeTo', date });
        refresh();
      } else if (type === 'apply-range') {
        dispatch({
          type: 'apply-range',
          from: root.querySelector('#cal-range-from')?.value,
          to: root.querySelector('#cal-range-to')?.value
        });
      }
      return;
    }

    const navigation = event.target.closest?.('[data-cal-nav]');
    if (navigation && root.contains(navigation)) {
      dispatch({
        type: 'navigate-month',
        navigation: navigation.dataset.calNav,
        year: Number(navigation.dataset.calYear),
        month: Number(navigation.dataset.calMonth)
      });
      return;
    }

    const scaleToggle = event.target.closest?.('[data-action="toggle-cal-scale"]');
    if (scaleToggle && root.contains(scaleToggle)) {
      dispatch({ type: 'toggle-scale', normalizeYears: scaleToggle.dataset.normalize === 'true' });
    }
  }

  function handleKeyDown(event) {
    const dayElement = event.target.closest?.('.calendar-month__grid-wrap [data-date]');
    if (!dayElement || !root.contains(dayElement)) return;
    const wrap = dayElement.closest('.calendar-month__grid-wrap');
    const days = [...wrap.querySelectorAll('[data-date]')];
    let targetDate;
    if (wrap.dataset.layout === 'list' && (event.key === 'Home' || event.key === 'End')) {
      targetDate = days[event.key === 'Home' ? 0 : days.length - 1]?.dataset.date;
    } else if (wrap.dataset.layout === 'list' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      targetDate = calendarGridTargetDate(dayElement.dataset.date, event.key === 'ArrowUp' ? 'ArrowLeft' : 'ArrowRight');
    } else if (wrap.dataset.layout !== 'list') {
      targetDate = calendarGridTargetDate(dayElement.dataset.date, event.key);
    }
    if (!targetDate) return;
    event.preventDefault();
    if (targetDate === dayElement.dataset.date) return;
    const target = wrap.querySelector(`[data-date="${targetDate}"]`);
    if (target) {
      target.focus({ preventScroll: true });
      target.click();
      return;
    }
    dispatch({ type: 'navigate-date', date: targetDate });
  }

  function handleChange(event) {
    if (event.target.id === 'cal-range-from') {
      dispatch({ type: 'change-range', field: 'calRangeFrom', value: event.target.value });
    } else if (event.target.id === 'cal-range-to') {
      dispatch({ type: 'change-range', field: 'calRangeTo', value: event.target.value });
    } else return;
    refresh();
  }

  root.addEventListener('click', handleClick);
  root.addEventListener('keydown', handleKeyDown);
  root.addEventListener('change', handleChange);
  view?.addEventListener('resize', refresh, { passive: true });
  refresh();

  return {
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      resizeObserver?.disconnect();
      view?.removeEventListener('resize', refresh);
      root.removeEventListener('click', handleClick);
      root.removeEventListener('keydown', handleKeyDown);
      root.removeEventListener('change', handleChange);
      observedWrap = null;
    }
  };
}
