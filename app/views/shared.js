import { esc, fmtPct } from '../../src/charts.js';
import { formatSemanticRoute } from '../routes.js';

export function card(title, body, cls = '', titleHtml = false, headingTag = 'h2') {
  const heading = title ? `<${headingTag}>${titleHtml ? title : esc(title)}</${headingTag}>` : '';
  return `<section class="card ${cls}">${heading}${body}</section>`;
}

export function kpis(items, layout = '') {
  return `<dl class="kpis${layout ? ` ${layout}` : ''}">${items.map((item) => {
    if (item.heading) return `<div class="kpi-group-heading" role="presentation"><span>${esc(item.heading)}</span></div>`;
    return `
    <div class="kpi${item.text ? ' kpi-text' : ''}${item.className ? ` ${esc(item.className)}` : ''}"><dt>${esc(item.label)}</dt><dd>${item.value}${item.sub ? `<span class="kpi-sub">${esc(item.sub)}</span>` : ''}</dd></div>`;
  }).join('')}</dl>`;
}

export function table(headers, rows, cls = '', colClasses = [], rowAttrs = null, caption = '', scrollCls = '', emptyNotice = '') {
  const th = (header, index) => `<th scope="col"${colClasses[index] ? ` class="${colClasses[index]}"` : ''}>${esc(header)}</th>`;
  const td = (cell, index) => `<td${colClasses[index] ? ` class="${colClasses[index]}"` : ''}>${cell}</td>`;
  const cap = caption ? `<caption class="visually-hidden">${esc(caption)}</caption>` : '';
  const wrapCls = scrollCls ? `table-scroll ${scrollCls}` : 'table-scroll';
  const emptyHTML = rows.length === 0 && emptyNotice ? `<p class="empty">${esc(emptyNotice)}</p>` : '';
  return `<div class="${wrapCls}"><table class="${cls}">${cap}<thead><tr>${headers.map(th).join('')}</tr></thead>
    <tbody>${rows.map((row, index) => `<tr${rowAttrs ? rowAttrs(row, index) : ''}>${row.map(td).join('')}</tr>`).join('')}</tbody></table>${emptyHTML}</div>`;
}

export function entityLinks(model, query = '') {
  function entity(type, id) {
    const group = type === 'artist' ? model.artists : type === 'track' ? model.tracks : model.albums;
    return group.byId.get(id);
  }
  function entityLink(type, id, name) {
    const item = entity(type, id);
    if (!item) return esc(name);
    const href = formatSemanticRoute(type, item, query);
    return `<a class="cell-name" href="${esc(href)}" title="${esc(name)}">${esc(name)}</a>`;
  }
  function trackSubLink(tk, name, artist) {
    const item = entity('track', tk);
    if (!item) return esc(name);
    const full = artist ? `${name} — ${artist}` : name;
    const href = formatSemanticRoute('track', item, query);
    return `<a class="cell-link" href="${esc(href)}" title="${esc(full)}"><span class="cell-name">${esc(name)}</span>${artist ? ` <span class="cell-sub">${esc(artist)}</span>` : ''}</a>`;
  }
  return { entityLink, trackSubLink };
}

export function topEntityInMap(map, ignoreZero = false) {
  let best = null;
  for (const entry of map.entries()) {
    if (ignoreZero && entry[0] === 0) continue;
    if (!best || entry[1] > best[1]) best = entry;
  }
  return best;
}

export function pctOf(part, total) {
  return total > 0 ? fmtPct(part / total) : '—';
}
