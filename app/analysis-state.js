import { filterParams } from './filter-ui.js';

// A response can replace visible statistics only while its requested state is
// still current. Reusing a result also avoids recalculation for table controls.
export function createAnalysisState(client) {
  let revision = 0, full = null, current = null, prev = null, appliedKey = null, albumDetail = null, detail = null, detailKey = null;
  function releaseAlbum() {
    if (albumDetail) albumDetail.trackStats = new Map();
    albumDetail = null;
  }
  return {
    initialize(model) { revision++; releaseAlbum(); full = model; current = model; prev = null; appliedKey = null; detail = null; detailKey = null; },
    clear() { revision++; releaseAlbum(); full = null; current = null; prev = null; appliedKey = null; detail = null; detailKey = null; },
    getConfirmed() { return { model: current, prev, key: appliedKey }; },
    cancelUpdate() {
      revision++;
      client.cancelUpdate?.();
      return { model: current, prev, key: appliedKey };
    },
    async update(state, { view, id, page = 1, pageSize = 25, onProgress } = {}) {
      const requestedRevision = ++revision;
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
        if (albumDetail !== album) releaseAlbum();
        if (album && album.trackStats.size === 0) {
          const detail = await client.request('album', { state, id }, { onProgress: progress });
          if (!isCurrent()) return null;
          if (detail) { album.trackStats = detail.trackStats; albumDetail = album; }
        }
        let nextDetail = null, nextDetailKey = null;
        if (view === 'day' || view === 'session' || view === 'track') {
          nextDetailKey = JSON.stringify([key, view, id, page, pageSize]);
          if (detailKey === nextDetailKey) nextDetail = detail;
          else {
            const type = view === 'day' ? 'dayDetail' : view === 'session' ? 'sessionDetail' : 'trackDetail';
            nextDetail = await client.request(type, { state, id, page, pageSize }, { onProgress: progress });
            if (!isCurrent()) return null;
          }
        }
        detail = nextDetail; detailKey = nextDetailKey;
        current = next; prev = nextPrev; appliedKey = key;
        return { model: current, prev, detail };
      } catch (error) {
        if (!isCurrent()) return null;
        throw error;
      }
    }
  };
}
