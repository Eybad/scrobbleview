import { filterParams } from './filter-ui.js';
import { resolveAlbumOrigin } from './routes.js';

function copyState(state) {
  return {
    ...state,
    range: state.range ? { ...state.range } : null,
    calMonth: state.calMonth ? { ...state.calMonth } : state.calMonth,
    ...Object.fromEntries(['years', 'months', 'hours', 'dows'].map(key => [key, state[key] ? new Set(state[key]) : null]))
  };
}

function copyContext(context) {
  return context ? { ...context, state: copyState(context.state) } : null;
}

// A response can replace visible statistics only while its requested state is
// still current. Reusing a result also avoids recalculation for table controls.
export function createAnalysisState(client) {
  let revision = 0, full = null, current = null, prev = null, appliedKey = null, albumDetail = null, detail = null, detailKey = null;
  let confirmedContext = null, pendingContext = null, failedContext = null;
  function releaseAlbum() {
    if (albumDetail) albumDetail.trackStats = new Map();
    albumDetail = null;
  }
  return {
    initialize(model) { revision++; releaseAlbum(); full = model; current = model; prev = null; appliedKey = null; detail = null; detailKey = null; confirmedContext = pendingContext = failedContext = null; },
    clear() { revision++; releaseAlbum(); full = null; current = null; prev = null; appliedKey = null; detail = null; detailKey = null; confirmedContext = pendingContext = failedContext = null; },
    getConfirmed() { return { model: current, prev, detail, key: appliedKey, context: copyContext(confirmedContext) }; },
    getFailed() { return copyContext(failedContext); },
    updatePresentation(context) {
      if (confirmedContext && !pendingContext) confirmedContext = { ...confirmedContext, ...context };
    },
    cancelUpdate() {
      revision++;
      failedContext = pendingContext;
      pendingContext = null;
      client.cancelUpdate?.();
      return { model: current, prev, detail, key: appliedKey, context: copyContext(confirmedContext) };
    },
    async update(state, { view, id, page = 1, pageSize = 25, originQuery = '', context = {}, onProgress } = {}) {
      const requestedRevision = ++revision;
      state = copyState(state);
      const requestedContext = { ...context, state, view, id, page, pageSize, originQuery };
      pendingContext = requestedContext;
      const isCurrent = () => revision === requestedRevision;
      const progress = (fraction, label) => { if (isCurrent()) onProgress?.(fraction, label); };
      try {
        if (!full) return null;
        const key = filterParams(state);
        let next = current, nextPrev = prev;
        if (key !== appliedKey) {
          const result = await client.request('filter', { state }, { onProgress: progress });
          if (!isCurrent() || !result) return null;
          next = result.model ?? full;
          nextPrev = result.prev;
        }
        const album = view === 'album' ? next.albums.byId.get(Number(id)) : null;
        let loadedAlbum = null;
        if (album && album.trackStats.size === 0) {
          loadedAlbum = await client.request('album', { state, id }, { onProgress: progress });
          if (!isCurrent()) return null;
        }
        let nextDetail = null, nextDetailKey = null;
        if (view === 'day' || view === 'session' || view === 'track') {
          const origin = view === 'track' ? resolveAlbumOrigin(originQuery, next) : null;
          nextDetailKey = JSON.stringify([key, view, id, page, pageSize, origin?.id ?? null]);
          if (detailKey === nextDetailKey) nextDetail = detail;
          else {
            const type = view === 'day' ? 'dayDetail' : view === 'session' ? 'sessionDetail' : 'trackDetail';
            nextDetail = await client.request(type, { state, id, page, pageSize, originId: origin?.id ?? null }, { onProgress: progress });
            if (!isCurrent()) return null;
          }
        }
        if (albumDetail !== album) releaseAlbum();
        if (album && loadedAlbum) { album.trackStats = loadedAlbum.trackStats; albumDetail = album; }
        detail = nextDetail; detailKey = nextDetailKey;
        current = next; prev = nextPrev; appliedKey = key;
        confirmedContext = requestedContext; pendingContext = null; failedContext = null;
        return { model: current, prev, detail };
      } catch (error) {
        if (!isCurrent()) return null;
        failedContext = requestedContext; pendingContext = null;
        throw error;
      }
    }
  };
}
