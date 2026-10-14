// columns.js — column builders (layout 23 B/evento)
//
// t     Int32Array   segundos relativos a meta.tsMin (granularidad de segundo, exacto)
// m     Uint32Array  ms reproducidos (máx 86,4M ms, exacto)
// tr    Uint32Array  índice a dicts.tracks   (Uint16 desborda a 65.535: con 1M
// ar    Uint32Array  índice a dicts.artists   eventos hay 50-70K tracks únicos)
// al    Uint32Array  índice a dicts.albums
// rs    Uint8Array   índice a dicts.reasons (set pequeño y cerrado)
// re    Uint8Array   índice a dicts.reasons
// flags Uint8Array   bit-packed: 1 shuffle, 2 skipped, 4 offline, 8 ms_unknown

const INITIAL_CAP = 1024;

export function createColumns() {
  let cap = INITIAL_CAP;
  let t = new Int32Array(cap);
  let m = new Uint32Array(cap);
  let tr = new Uint32Array(cap);
  let ar = new Uint32Array(cap);
  let al = new Uint32Array(cap);
  let rs = new Uint8Array(cap);
  let re = new Uint8Array(cap);
  let flags = new Uint8Array(cap);
  let len = 0;

  function ensure() {
    if (len >= cap) {
      cap *= 2;
      const nt = new Int32Array(cap); nt.set(t); t = nt;
      const nm = new Uint32Array(cap); nm.set(m); m = nm;
      const ntr = new Uint32Array(cap); ntr.set(tr); tr = ntr;
      const nar = new Uint32Array(cap); nar.set(ar); ar = nar;
      const nal = new Uint32Array(cap); nal.set(al); al = nal;
      const nrs = new Uint8Array(cap); nrs.set(rs); rs = nrs;
      const nre = new Uint8Array(cap); nre.set(re); re = nre;
      const nf = new Uint8Array(cap); nf.set(flags); flags = nf;
    }
  }

  return {
    get length() {
      return len;
    },
    push(tv, mv, trv, arv, alv, rsv, rev, fv) {
      ensure();
      t[len] = tv;
      m[len] = mv;
      tr[len] = trv;
      ar[len] = arv;
      al[len] = alv;
      rs[len] = rsv;
      re[len] = rev;
      flags[len] = fv;
      len++;
    },
    finish(tsMin, meta) {
      for (let i = 0; i < len; i++) t[i] -= tsMin;
      return {
        t: t.slice(0, len),
        m: m.slice(0, len),
        tr: tr.slice(0, len),
        ar: ar.slice(0, len),
        al: al.slice(0, len),
        rs: rs.slice(0, len),
        re: re.slice(0, len),
        flags: flags.slice(0, len),
        dicts: {
          tracks: meta.tracks,
          artists: meta.artists,
          albums: meta.albums,
          reasons: meta.reasons
        },
        meta: {
          tsMin,
          count: len,
          sources: meta.sources,
          warnings: meta.warnings,
          bytesRead: meta.bytesRead
        }
      };
    }
  };
}