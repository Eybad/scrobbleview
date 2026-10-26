import { filterParams } from './filter-ui.js';

// A response can replace visible statistics only while its requested state is
// still current. Reusing a result also avoids recalculation for table controls.
export function createAnalysisState(client) {
  let revision = 0, full = null, current = null, prev = null, appliedKey = null, albumDetail = null;
  function releaseAlbum() {
    if (albumDetail) albumDetail.trackStats = new Map();
    albumDetail = null;
  }
  return {
    initialize(model) { revision++; releaseAlbum(); full = model; current = model; prev = null; appliedKey = null; },
    clear() { revision++; releaseAlbum(); full = null; current = null; prev = null; appliedKey = null; },
    async update(state, { view, id, onProgress } = {}) {
      const requestedRevision = ++revision;
      const isCurrent = () => revision === requestedRevision;
      const progress = (fraction, label) => { if (isCurrent()) onProgress?.(fraction, label); };
      try {
        if (!full) return null;
        const key = filterParams(state);
        let next = current, nextPrev = prev;
        if (key !== appliedKey) {
          const result = await client.request('filter', { state }, { onProgress: progress });
          if (!isCurrent()) return null;
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
        current = next; prev = nextPrev; appliedKey = key;
        return { model: current, prev };
      } catch (error) {
        if (!isCurrent()) return null;
        throw error;
      }
    }
  };
}
