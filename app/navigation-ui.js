import { formatSemanticRoute } from './routes.js';

export const SECTION_NAMES = Object.freeze({
  dashboard: 'Resumen',
  explore: 'Explorar',
  compare: 'Comparar',
  hours: 'Horarios',
  habits: 'Hábitos',
  sessions: 'Sesiones',
  discovery: 'Descubrimiento',
  yearly: 'Años',
  calendar: 'Calendario',
  wrapped: 'Resumen del período'
});

const PRIMARY_VIEWS = ['dashboard', 'explore', 'compare'];
const NAV_GROUPS = [
  { id: 'patterns', label: 'Patrones', views: ['hours', 'habits', 'sessions', 'discovery'] },
  { id: 'periods', label: 'Períodos', views: ['yearly', 'calendar', 'wrapped'] }
];
const FAVORITE_GROUP = { id: 'favorites', label: 'Favoritos' };
const DETAIL_SECTIONS = {
  artist: 'explore',
  track: 'explore',
  album: 'explore',
  day: 'calendar',
  session: 'sessions'
};
const PRIMARY_SET = new Set(PRIMARY_VIEWS);
const KNOWN_VIEWS = new Set(Object.keys(SECTION_NAMES));

function sectionForView(view) {
  return DETAIL_SECTIONS[view] ?? view;
}

function isKnownView(view) {
  return KNOWN_VIEWS.has(view);
}

function groupForView(view) {
  return NAV_GROUPS.find((group) => group.views.includes(view))?.id ?? null;
}

function normalizeFavorites(favorites) {
  const values = favorites instanceof Set ? favorites : new Set(favorites ?? []);
  return [...values].filter((view) => isKnownView(view));
}

function queryForView(query, view) {
  if (typeof query === 'string') return query;
  if (!query || typeof query !== 'object') return '';
  return query[view] ?? query.default ?? '';
}

function createLink(documentObject, view, className) {
  const link = documentObject.createElement('a');
  link.className = className;
  link.dataset.navView = view;
  return link;
}

function createTrigger(documentObject, group, panelId) {
  const trigger = documentObject.createElement('button');
  trigger.type = 'button';
  trigger.className = 'app-nav__item app-nav__trigger';
  trigger.dataset.navGroup = group.id;
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', panelId);
  const label = documentObject.createElement('span');
  label.textContent = group.label;
  trigger.append(label);
  const caret = documentObject.createElement('span');
  caret.className = 'app-nav__caret';
  caret.setAttribute('aria-hidden', 'true');
  trigger.append(caret);
  return trigger;
}

function setAnchorState(anchor, view, currentView, query) {
  const label = SECTION_NAMES[view];
  const currentSection = sectionForView(currentView);
  const exact = currentView === view;
  const sectionCurrent = !exact && currentSection === view;
  anchor.dataset.navView = view;
  anchor.textContent = label;
  anchor.href = formatSemanticRoute(view, null, queryForView(query, view));
  anchor.classList.toggle('is-section-current', exact || sectionCurrent);
  if (exact) anchor.setAttribute('aria-current', 'page');
  else anchor.removeAttribute('aria-current');
  if (sectionCurrent) anchor.setAttribute('aria-label', `${label}, sección actual`);
  else anchor.removeAttribute('aria-label');
}

function reconcileLinks(container, views, documentObject, currentView, query, className) {
  const existing = new Map(
    [...container.querySelectorAll(':scope > a[data-nav-view]')]
      .map((link) => [link.dataset.navView, link])
  );
  const links = views.map((view) => {
    const link = existing.get(view) ?? createLink(documentObject, view, className);
    setAnchorState(link, view, currentView, query);
    existing.delete(view);
    return link;
  });
  for (const link of existing.values()) link.remove();
  for (const link of links) container.append(link);
}

function createPanelGroup(documentObject, group) {
  const section = documentObject.createElement('section');
  section.className = 'app-nav-panel__group';
  section.dataset.navPanelGroup = group.id;
  const heading = documentObject.createElement('h2');
  heading.className = 'app-nav-panel__heading';
  heading.textContent = group.label;
  section.append(heading);
  const links = documentObject.createElement('div');
  links.className = 'app-nav-panel__links';
  section.append(links);
  return section;
}

function reconcilePanelGroups(panel, groups, documentObject, currentView, query) {
  const existing = new Map(
    [...panel.querySelectorAll(':scope > [data-nav-panel-group]')]
      .map((group) => [group.dataset.navPanelGroup, group])
  );
  const elements = groups.map((group) => {
    const section = existing.get(group.id) ?? createPanelGroup(documentObject, group);
    existing.delete(group.id);
    const heading = section.querySelector('.app-nav-panel__heading');
    heading.textContent = group.label;
    reconcileLinks(
      section.querySelector('.app-nav-panel__links'),
      group.views,
      documentObject,
      currentView,
      query,
      'app-nav-panel__link'
    );
    return section;
  });
  for (const section of existing.values()) section.remove();
  for (const section of elements) panel.append(section);
}

export function mountNavigation(root) {
  const documentObject = root.ownerDocument;
  const windowObject = documentObject.defaultView;
  const panelId = 'app-nav-panel';
  const shell = documentObject.createElement('div');
  shell.className = 'app-nav-shell';
  const nav = documentObject.createElement('nav');
  nav.className = 'app-nav';
  nav.setAttribute('aria-label', 'Secciones');
  const panel = documentObject.createElement('div');
  panel.className = 'app-nav-panel';
  panel.id = panelId;
  panel.hidden = true;
  shell.append(nav, panel);
  root.replaceChildren(shell);

  let currentView = 'dashboard';
  let query = '';
  let favorites = [];
  let openGroup = null;
  let desktop = windowObject.matchMedia('(min-width: 48rem)').matches;
  let disposed = false;

  function groupForButton(id) {
    if (id === 'more') return { id, label: 'Más' };
    if (id === FAVORITE_GROUP.id) return FAVORITE_GROUP;
    return NAV_GROUPS.find((group) => group.id === id) ?? null;
  }

  function panelGroups(id) {
    if (id === 'more') {
      const groups = [];
      if (favorites.length) groups.push({ ...FAVORITE_GROUP, views: favorites });
      groups.push(...NAV_GROUPS);
      return groups;
    }
    if (id === FAVORITE_GROUP.id) return [{ ...FAVORITE_GROUP, views: favorites }];
    return NAV_GROUPS.filter((group) => group.id === id);
  }

  function syncAnchors() {
    for (const anchor of shell.querySelectorAll('a[data-nav-view]')) {
      setAnchorState(anchor, anchor.dataset.navView, currentView, query);
    }
  }

  function syncTriggers() {
    const currentSection = sectionForView(currentView);
    for (const trigger of nav.querySelectorAll('[data-nav-group]')) {
      const group = groupForButton(trigger.dataset.navGroup);
      const active = trigger.dataset.navGroup === 'more'
        ? !PRIMARY_SET.has(currentSection)
        : trigger.dataset.navGroup === 'favorites'
          ? favorites.includes(currentSection)
          : group?.views.includes(currentSection) ?? false;
      const baseLabel = trigger.dataset.navGroup === 'more' ? 'Más secciones' : group?.label;
      trigger.classList.toggle('is-section-current', active);
      trigger.setAttribute('aria-label', active ? `${baseLabel}, sección actual` : baseLabel);
      trigger.setAttribute('aria-expanded', String(openGroup === trigger.dataset.navGroup));
    }
  }

  function syncFavoriteTrigger() {
    if (!desktop) return;
    const trigger = nav.querySelector('[data-nav-group="favorites"]');
    if (favorites.length && !trigger) nav.append(createTrigger(documentObject, FAVORITE_GROUP, panelId));
    else if (!favorites.length && trigger) {
      if (openGroup === 'favorites') openGroup = null;
      trigger.remove();
    }
  }

  function updatePanel() {
    if (!openGroup) {
      panel.hidden = true;
      panel.replaceChildren();
      panel.removeAttribute('data-open-group');
      return;
    }
    if (openGroup === 'favorites' && !favorites.length) {
      openGroup = null;
      updatePanel();
      return;
    }
    panel.dataset.openGroup = openGroup;
    panel.hidden = false;
    reconcilePanelGroups(panel, panelGroups(openGroup), documentObject, currentView, query);
  }

  function setOpenGroup(groupId) {
    openGroup = groupId;
    syncTriggers();
    updatePanel();
  }

  function buildVariant(nextDesktop, focusHint = null) {
    desktop = nextDesktop;
    openGroup = null;
    nav.replaceChildren();
    for (const view of PRIMARY_VIEWS) {
      const link = createLink(documentObject, view, 'app-nav__item');
      nav.append(link);
    }
    if (desktop) {
      for (const group of NAV_GROUPS) nav.append(createTrigger(documentObject, group, panelId));
      if (favorites.length) nav.append(createTrigger(documentObject, FAVORITE_GROUP, panelId));
    } else {
      nav.append(createTrigger(documentObject, groupForButton('more'), panelId));
    }
    syncAnchors();
    syncTriggers();
    updatePanel();

    if (focusHint) {
      const section = sectionForView(focusHint.view ?? currentView);
      const target = PRIMARY_SET.has(section)
        ? nav.querySelector(`a[data-nav-view="${section}"]`)
        : nav.querySelector(`[data-nav-group="${desktop ? (focusHint.group === 'favorites' && favorites.includes(section) ? 'favorites' : groupForView(section)) : 'more'}"]`);
      target?.focus({ preventScroll: true });
    }
  }

  function onBreakpointChange(event) {
    if (event.matches === desktop || disposed) return;
    const active = documentObject.activeElement;
    const focusHint = shell.contains(active)
      ? { view: active?.dataset?.navView ?? currentView, group: active?.dataset?.navGroup ?? null }
      : null;
    if (focusHint && !focusHint.view && focusHint.group) {
      focusHint.view = sectionForView(currentView);
      if (focusHint.group === 'patterns') focusHint.view = 'hours';
      else if (focusHint.group === 'periods') focusHint.view = 'yearly';
      else if (focusHint.group === 'favorites') focusHint.view = favorites[0] ?? currentView;
    }
    buildVariant(event.matches, focusHint);
  }

  function onClick(event) {
    const trigger = event.target.closest?.('[data-nav-group]');
    if (trigger && nav.contains(trigger)) {
      event.preventDefault();
      const groupId = trigger.dataset.navGroup;
      setOpenGroup(openGroup === groupId ? null : groupId);
      return;
    }
    const link = event.target.closest?.('a[data-nav-view]');
    if (link && shell.contains(link)) setOpenGroup(null);
  }

  function onAuxClick(event) {
    if (event.button !== 1) return;
    const link = event.target.closest?.('a[data-nav-view]');
    if (link && shell.contains(link)) setOpenGroup(null);
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' || !openGroup) return;
    const groupId = openGroup;
    event.preventDefault();
    setOpenGroup(null);
    nav.querySelector(`[data-nav-group="${groupId}"]`)?.focus({ preventScroll: true });
  }

  function onDocumentClick(event) {
    if (openGroup && !shell.contains(event.target)) setOpenGroup(null);
  }

  const media = windowObject.matchMedia('(min-width: 48rem)');
  const onMediaChange = (event) => onBreakpointChange(event);
  if (media.addEventListener) media.addEventListener('change', onMediaChange);
  else media.addListener(onMediaChange);
  shell.addEventListener('click', onClick);
  shell.addEventListener('auxclick', onAuxClick);
  shell.addEventListener('keydown', onKeyDown);
  documentObject.addEventListener('click', onDocumentClick);
  buildVariant(desktop);

  function update(options = {}) {
    if (disposed) return;
    currentView = options.view ?? currentView;
    query = options.query ?? query;
    favorites = normalizeFavorites(options.favorites ?? favorites);
    syncFavoriteTrigger();
    syncAnchors();
    syncTriggers();
    updatePanel();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (media.removeEventListener) media.removeEventListener('change', onMediaChange);
    else media.removeListener(onMediaChange);
    shell.removeEventListener('click', onClick);
    shell.removeEventListener('auxclick', onAuxClick);
    shell.removeEventListener('keydown', onKeyDown);
    documentObject.removeEventListener('click', onDocumentClick);
    root.replaceChildren();
  }

  return { update, dispose };
}
