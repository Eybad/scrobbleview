// Navigation snapshots store serializable view state, never DOM nodes.

export function buildElementSelector(el) {
  if (!el || typeof el.getAttribute !== 'function') return null;
  if (el.id) return `#${el.id}`;
  if (el.dataset.metric) return `[data-metric="${el.dataset.metric}"]`;
  if (el.dataset.tab) return `[data-tab="${el.dataset.tab}"]`;
  if (el.dataset.topn) return `[data-topn="${el.dataset.topn}"]`;
  if (el.dataset.filterEntity) return `[data-filter-entity="${el.dataset.filterEntity}"]`;
  const href = el.getAttribute('href');
  if (href && href.startsWith('#')) return `a[href="${href}"]`;
  const name = el.getAttribute('name');
  if (name) return `[name="${name}"]`;
  return null;
}

export function captureHistoryState(windowObj = typeof window !== 'undefined' ? window : null, docObj = typeof document !== 'undefined' ? document : null) {
  if (!windowObj || !docObj) return null;
  const scrollX = windowObj.scrollX || 0;
  const scrollY = windowObj.scrollY || 0;
  const active = docObj.activeElement;
  const focusSelector = buildElementSelector(active);

  const tableScrolls = [];
  const scrolls = docObj.querySelectorAll ? docObj.querySelectorAll('.table-scroll, .chart-scroll') : [];
  for (let i = 0; i < scrolls.length; i++) {
    const s = scrolls[i];
    if (s.scrollLeft > 0 || s.scrollTop > 0) {
      const ariaLabel = typeof s.getAttribute === 'function' ? s.getAttribute('aria-label') : null;
      tableScrolls.push({
        index: i,
        selector: s.id ? `#${s.id}` : (ariaLabel ? `[aria-label="${ariaLabel}"]` : null),
        left: s.scrollLeft,
        top: s.scrollTop
      });
    }
  }

  return { scrollX, scrollY, focusSelector, tableScrolls };
}

export function restoreHistoryState(returnState, windowObj = typeof window !== 'undefined' ? window : null, docObj = typeof document !== 'undefined' ? document : null) {
  if (!returnState || !windowObj || !docObj) return false;

  if (typeof windowObj.scrollTo === 'function') {
    windowObj.scrollTo(returnState.scrollX || 0, returnState.scrollY || 0);
  }

  if (Array.isArray(returnState.tableScrolls) && docObj.querySelectorAll) {
    const scrolls = docObj.querySelectorAll('.table-scroll, .chart-scroll');
    for (const item of returnState.tableScrolls) {
      const target = item.selector ? docObj.querySelector(item.selector) : scrolls[item.index];
      if (target) {
        if (item.left != null) target.scrollLeft = item.left;
        if (item.top != null) target.scrollTop = item.top;
      }
    }
  }

  if (returnState.focusSelector && docObj.querySelector) {
    try {
      const el = docObj.querySelector(returnState.focusSelector);
      if (el && typeof el.focus === 'function') {
        el.focus({ preventScroll: true });
      }
    } catch (_) {}
  }

  return true;
}
