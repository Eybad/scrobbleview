import { patchExploreQuery } from './catalog-query.js';

function findExploreControl(root, event, selector) {
  const control = event.target?.closest?.(selector);
  return control && root.contains(control) && control.closest('#explore-card') ? control : null;
}

function measureExploreTable(card) {
  const wrap = card.querySelector('.table-scroll--tall');
  if (!wrap) return;
  const tenthRow = wrap.querySelector('tbody')?.rows?.[9];
  if (!tenthRow) {
    wrap.style.removeProperty('max-height');
    return;
  }
  const horizontalScrollbar = Math.max(0, wrap.offsetHeight - wrap.clientHeight);
  wrap.style.maxHeight = `${tenthRow.offsetTop + tenthRow.offsetHeight + horizontalScrollbar}px`;
}

function updateCatalogScrollHint(card) {
  const wrap = card.querySelector('.catalog-table-wrap');
  const hint = card.querySelector('[data-catalog-scroll-hint]');
  if (!wrap || !hint) return;
  hint.hidden = wrap.scrollWidth <= wrap.clientWidth;
  wrap.classList.toggle('catalog-table-wrap--no-sticky', wrap.clientWidth < 288);
}

export function mountExplore(root, { readSnapshot, commitQuery, savePreference, exportTable }) {
  const windowObject = root.ownerDocument.defaultView;
  const composingInputs = new WeakSet();
  let searchTimer = 0;

  function clearSearchTimer() {
    clearTimeout(searchTimer);
    searchTimer = 0;
  }

  function captureReturnState(card, focusSelector, selection) {
    const tableScroll = card.querySelector('.table-scroll');
    return {
      focusSelector,
      selection,
      scrollLeft: tableScroll?.scrollLeft ?? 0,
      scrollTop: tableScroll?.scrollTop ?? 0,
      columnsOpen: card.querySelector('.col-picker')?.open ?? false
    };
  }

  function commit(patch, focusSelector = null, selection = null) {
    clearSearchTimer();
    const snapshot = readSnapshot();
    if (!snapshot || snapshot.route.view !== 'explore') return;
    const card = root.querySelector('#explore-card');
    if (!card) return;
    const nextQuery = patchExploreQuery(snapshot.route.query, patch);
    commitQuery(nextQuery, captureReturnState(card, focusSelector, selection));
  }

  function scheduleSearch(input) {
    clearSearchTimer();
    searchTimer = setTimeout(() => {
      searchTimer = 0;
      if (!input.isConnected || !root.contains(input)) return;
      const focused = root.ownerDocument.activeElement === input;
      const selection = {
        start: input.selectionStart,
        end: input.selectionEnd,
        direction: input.selectionDirection
      };
      commit(
        { q: input.value || null, page: null },
        focused ? '[data-explore-search]' : null,
        focused && selection.start != null && selection.end != null ? selection : null
      );
    }, 200);
  }

  function handleClick(event) {
    const tab = findExploreControl(root, event, '[data-explore-tab]');
    if (tab) {
      const id = tab.dataset.exploreTab;
      commit({
        tab: id,
        page: null,
        sort: null,
        dir: null,
        minPlays: null,
        minMonths: null,
        minKnownSkips: null
      }, `[data-explore-tab="${id}"]`);
      return;
    }

    const clearSearch = findExploreControl(root, event, '[data-clear-search]');
    if (clearSearch) {
      commit({ q: null, page: null }, '[data-explore-search]');
      return;
    }

    const sort = findExploreControl(root, event, '.btn-sort');
    if (sort) {
      commit({ sort: sort.dataset.sort, dir: sort.dataset.dir, page: null }, `[data-sort="${sort.dataset.sort}"]`);
      return;
    }

    const page = findExploreControl(root, event, '[data-page]');
    if (page) {
      if (page.disabled) return;
      const value = Number(page.dataset.page);
      if (!Number.isSafeInteger(value) || value < 1) return;
      commit({ page: value }, `[data-page-action="${page.dataset.pageAction}"]`);
      return;
    }

    const density = findExploreControl(root, event, '[data-density]');
    if (density) {
      savePreference('scrobbleview:density', density.dataset.density);
      commit({}, `[data-density="${density.dataset.density}"]`);
      return;
    }

    const resetColumns = findExploreControl(root, event, '[data-reset-cols]');
    if (resetColumns) {
      const snapshot = readSnapshot();
      if (!snapshot || snapshot.route.view !== 'explore') return;
      savePreference(`scrobbleview:cols:${snapshot.context.exploreState.tab}`, null);
      commit({}, '[data-reset-cols]');
      return;
    }

    const expandName = findExploreControl(root, event, '[data-expand-name]');
    if (expandName) {
      event.preventDefault();
      const identity = expandName.closest('.cell-entity');
      if (!identity) return;
      const expanded = identity.classList.toggle('is-expanded');
      const label = expanded ? 'Contraer nombre' : 'Expandir nombre';
      expandName.classList.toggle('is-expanded', expanded);
      expandName.setAttribute('aria-expanded', String(expanded));
      expandName.setAttribute('aria-label', label);
      expandName.title = label;
      return;
    }

    if (findExploreControl(root, event, '[data-action="export-table"]')) exportTable();
  }

  function handleKeydown(event) {
    const tab = findExploreControl(root, event, '[data-explore-tab]');
    if (!tab || !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    const tablist = tab.closest('[role="tablist"][aria-label="Explorar catálogo"]');
    if (!tablist) return;
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(tab);
    if (index < 0) return;
    const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length]
      : event.key === 'ArrowLeft' ? tabs[(index - 1 + tabs.length) % tabs.length]
        : event.key === 'Home' ? tabs[0] : tabs.at(-1);
    event.preventDefault();
    next.click();
  }

  function handleInput(event) {
    const input = findExploreControl(root, event, '[data-explore-search]');
    if (!input || event.isComposing || composingInputs.has(input)) return;
    scheduleSearch(input);
  }

  function handleCompositionStart(event) {
    const input = findExploreControl(root, event, '[data-explore-search]');
    if (!input) return;
    composingInputs.add(input);
    clearSearchTimer();
  }

  function handleCompositionEnd(event) {
    const input = findExploreControl(root, event, '[data-explore-search]');
    if (!input) return;
    composingInputs.delete(input);
    scheduleSearch(input);
  }

  function handleChange(event) {
    const pageSize = findExploreControl(root, event, '[data-page-size]');
    if (pageSize) {
      commit({ pageSize: pageSize.value, page: null }, '[data-page-size]');
      return;
    }

    const column = findExploreControl(root, event, '[data-col-toggle]');
    if (column) {
      const snapshot = readSnapshot();
      if (!snapshot || snapshot.route.view !== 'explore') return;
      const card = root.querySelector('#explore-card');
      const columns = [...card.querySelectorAll('[data-col-toggle]:checked')].map(input => input.dataset.colToggle);
      savePreference(`scrobbleview:cols:${snapshot.context.exploreState.tab}`, JSON.stringify(columns));
      commit({}, `[data-col-toggle="${column.dataset.colToggle}"]`);
      return;
    }

    const minPlays = findExploreControl(root, event, '[data-min-plays]');
    if (minPlays) {
      const value = Math.max(1, Math.min(10000, Number(minPlays.value) || 1));
      const sort = readSnapshot()?.context?.exploreState?.sort;
      const key = sort === 'skipRate' || sort === 'lowSkipRate' ? 'minKnownSkips' : 'minPlays';
      commit({ [key]: value, page: null }, '[data-min-plays]');
      return;
    }

    const minMonths = findExploreControl(root, event, '[data-min-months]');
    if (minMonths) {
      const value = Math.max(1, Math.min(120, Number(minMonths.value) || 1));
      commit({ minMonths: value, page: null }, '[data-min-months]');
    }
  }

  function refresh(returnState = null) {
    const snapshot = readSnapshot();
    if (!snapshot || snapshot.route.view !== 'explore') {
      clearSearchTimer();
      return;
    }
    const card = root.querySelector('#explore-card');
    if (!card) return;
    measureExploreTable(card);
    updateCatalogScrollHint(card);
    if (!returnState) return;

    const tableScroll = card.querySelector('.table-scroll');
    if (tableScroll) {
      tableScroll.scrollLeft = returnState.scrollLeft;
      tableScroll.scrollTop = returnState.scrollTop;
    }
    const columns = card.querySelector('.col-picker');
    if (columns) columns.open = returnState.columnsOpen;
    const target = returnState.focusSelector && root.querySelector(returnState.focusSelector);
    const focusTarget = !returnState.focusSelector ? null : target && !target.disabled ? target : card.querySelector('[data-explore-search]');
    focusTarget?.focus({ preventScroll: true });
    if (returnState.selection && target && typeof target.setSelectionRange === 'function') {
      target.setSelectionRange(returnState.selection.start, returnState.selection.end, returnState.selection.direction);
    }
  }

  function handleResize() {
    const snapshot = readSnapshot();
    if (snapshot?.route.view === 'explore') {
      const card = root.querySelector('#explore-card');
      if (card) {
        measureExploreTable(card);
        updateCatalogScrollHint(card);
      }
    }
  }

  root.addEventListener('click', handleClick);
  root.addEventListener('keydown', handleKeydown);
  root.addEventListener('input', handleInput);
  root.addEventListener('change', handleChange);
  root.addEventListener('compositionstart', handleCompositionStart);
  root.addEventListener('compositionend', handleCompositionEnd);
  windowObject.addEventListener('resize', handleResize, { passive: true });

  return {
    refresh,
    dispose() {
      clearSearchTimer();
      root.removeEventListener('click', handleClick);
      root.removeEventListener('keydown', handleKeydown);
      root.removeEventListener('input', handleInput);
      root.removeEventListener('change', handleChange);
      root.removeEventListener('compositionstart', handleCompositionStart);
      root.removeEventListener('compositionend', handleCompositionEnd);
      windowObject.removeEventListener('resize', handleResize);
    }
  };
}
