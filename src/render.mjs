import {
  eventSentence,
  shownEvents,
  sideRose,
  rangeVerb,
} from './events.mjs';
import { fmtMultiple } from './format.mjs';
import { OR_DOCS, tierOf } from './docs-links.mjs';
import { orModelUrl } from './links.mjs';
import { routineMoves } from './rules.mjs';
import { fmtWhen } from './when.mjs';

function siteEvents(events) {
  const raw = Array.isArray(events) ? events : [];
  return shownEvents(raw).filter(event => !(
    event.type === 'left'
    && event.replacedBy
    && raw.some(other => other.type === 'joined' && (
      other.replaces === event.tag || other.tag === event.replacedBy
    ))
  ));
}

// history.mjs LEFT_CONFIRM_MINUTES (same layer, so not imported).
const LEFT_CONFIRM_MS = 30 * 60 * 1000;

// A confirmed departure is confirmed at the model's first observation 30 minutes
// or more after `at`, the time it was first missed; the model's series holds every
// observation.
function confirmedAt(e, models) {
  if (e.type !== 'left' || e.confirmed !== true) return null;
  const missed = new Date(e.at).getTime();
  const point = (models?.[e.model]?.series || []).find(p =>
    new Date(p.takenAt).getTime() - missed >= LEFT_CONFIRM_MS);
  return point ? point.takenAt : null;
}

// The site lists a confirmed departure when it was confirmed (when Discord posts
// it), not when it was first missed; each row is { event, at }, newest first.
function siteRows(h) {
  return siteEvents(h?.events)
    .map(event => ({ event, at: confirmedAt(event, h?.models) ?? event.at }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at))
      || String(a.event.model).localeCompare(String(b.event.model)));
}

export const ROUTING_DOCS = OR_DOCS.providerRouting;
export const ARCHIVE_LABEL =
  'Wayback Machine copy of the model page, transcribed by hand';
export const ARCHIVE_BOTH =
  'both from Wayback Machine copies of the model page, transcribed by hand';

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function docLink(url, inner) {
  return `<a class="ext" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${inner}<span class="sr-only"> (opens OpenRouter in a new tab)</span></a>`;
}

function timeHtml(iso, style = 'datetime') {
  const text = fmtWhen(iso);
  const values = {
    datetime: text,
    date: text.replace(/, \d{2}:\d{2} UTC$/, ''),
    time: text.match(/\d{2}:\d{2} UTC$/)?.[0] || '',
    day: (() => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]
        + `, ${text.replace(/, \d{2}:\d{2} UTC$/, '')}`;
    })(),
  };
  const shown = values[style] ?? text;
  return `<time datetime="${escapeHtml(iso)}" data-local="${escapeHtml(style)}" title="${escapeHtml(text)}">${escapeHtml(shown)}</time>`;
}

function pill(tone, label) {
  return `<span class="pill pill-${tone}">${escapeHtml(label)}</span>`;
}

export function eventPill(e) {
  switch (e?.type) {
    case 'joined': {
      if (e.replaces) return pill('neutral', 'endpoint changed');
      if (e.expensive) {
        const values = [e.standing?.input?.vs, e.standing?.output?.vs]
          .filter(Number.isFinite);
        const largest = values.length ? Math.max(...values) : null;
        return pill('warning', largest === null ? 'joined' : `joined · ${fmtMultiple(largest)}`);
      }
      return pill('neutral', 'joined');
    }
    case 'left':
      if (e.replacedBy) return pill('neutral', 'endpoint changed');
      if (e.returned) return pill('neutral', 'briefly unlisted');
      if (e.confirmed === false) return pill('neutral', 'not listed · unconfirmed');
      if (e.providerStays) return pill('neutral', 'endpoint removed');
      return pill('neutral', 'left');
    case 'price-changed':
      if (e.direction === 'up') {
        return pill(
          sideRose(e, 0.25) ? 'negative' : 'warning',
          sideRose(e, 0.25) ? 'price increase · 25%+' : 'price increase',
        );
      }
      if (e.direction === 'down') return pill('positive', 'price decrease');
      return pill('warning', 'price change');
    case 'cheapest-changed':
      return pill('neutral', 'cheapest');
    case 'spread-crossed': {
      const verb = rangeVerb(e);
      const tone = !e.up
        ? 'positive'
        : e.cause === 'cheapest-fell'
          ? 'neutral'
          : 'negative';
      return pill(tone, `price range ${verb}`);
    }
    case 'quantization-changed':
      return pill('neutral', 'quantization');
    case 'pool-empty':
      return pill('negative', 'empty');
    case 'model-listed':
      return pill('info', 'listed');
    case 'model-delisted':
      return pill('warning', 'delisted');
    default:
      return pill('neutral', 'changed');
  }
}

export function termLink(e) {
  if (e?.type === 'quantization-changed') {
    return ` (${docLink(OR_DOCS.quantization, 'what quantization means')})`;
  }
  const tier = tierOf(e?.tag);
  if (tier) {
    return ` (${docLink(OR_DOCS.serviceTiers, `what the ${escapeHtml(tier)} tier is`)})`;
  }
  return '';
}

function windowNote(e) {
  const since = new Date(e?.since).getTime();
  const at = new Date(e?.at).getTime();
  const long = Number.isFinite(since) && Number.isFinite(at) && at - since > 36 * 60 * 60 * 1000;
  const archivedStart = e?.sources?.[0] === 'archived-model-page';
  const archivedEnd = e?.sources?.[1] === 'archived-model-page';

  if (!long && !archivedStart && !archivedEnd) return '';

  const start = fmtWhen(e.since).replace(/, \d{2}:\d{2} UTC$/, '');
  const end = fmtWhen(e.at).replace(/, \d{2}:\d{2} UTC$/, '');
  let note = '';

  if (archivedStart && archivedEnd) {
    note = `, ${ARCHIVE_BOTH}`;
  } else if (archivedStart) {
    note = `; ${start} is from a ${ARCHIVE_LABEL}`;
  } else if (archivedEnd) {
    note = `; ${end} is from a ${ARCHIVE_LABEL}`;
  }

  return ` <span class="window">between ${escapeHtml(start)} and ${escapeHtml(end)}${escapeHtml(note)}</span>`;
}

function firstMissedNote(e, at) {
  if (at === e.at) return '';
  const style = String(at).slice(0, 10) === String(e.at).slice(0, 10) ? 'time' : 'datetime';
  return ` <span class="window">· first missed ${timeHtml(e.at, style)}</span>`;
}

// `at` is the time the row is listed at: a confirmed departure's confirmation time.
export function eventRow(e, at = e.at) {
  const classes = [
    'event',
    e.type,
    e.major ? 'major' : '',
    e.expensive ? 'expensive' : '',
  ].filter(Boolean).join(' ');

  const model = escapeHtml(e.model);
  const href = escapeHtml(orModelUrl(e.model));
  const sentence = escapeHtml(eventSentence(e));

  return `<li class="${classes}">${timeHtml(at, 'time')} ${eventPill(e)}<span class="event-body"> <a class="model ext" href="${href}" target="_blank" rel="noopener noreferrer">${model}<span class="sr-only"> (opens OpenRouter in a new tab)</span></a> <span class="what">${sentence}</span>${termLink(e)}${firstMissedNote(e, at)}${windowNote(e)}</span></li>`;
}

function themeSwitch(className) {
  const light = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></g></svg>';
  const dark = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a.6.6 0 0 0-.8-.7A9.5 9.5 0 1 0 21.2 15.4a.6.6 0 0 0-.7-.8Z"/></svg>';
  const system = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M3 5.5A2.5 2.5 0 0 1 5.5 3h13A2.5 2.5 0 0 1 21 5.5v8a2.5 2.5 0 0 1-2.5 2.5h-4l.6 2.5H17a1 1 0 1 1 0 2H7a1 1 0 1 1 0-2h1.9l.6-2.5h-4A2.5 2.5 0 0 1 3 13.5v-8Zm2.5-.5a.5.5 0 0 0-.5.5V12h14V5.5a.5.5 0 0 0-.5-.5h-13Z"/></svg>';
  return `<div class="theme-switch ${className}" role="group" aria-label="Colour theme"><button type="button" data-theme-choice="light" aria-pressed="false" aria-label="Light" title="Light">${light}</button><button type="button" data-theme-choice="dark" aria-pressed="false" aria-label="Dark" title="Dark">${dark}</button><button type="button" data-theme-choice="system" aria-pressed="true" aria-label="System" title="System">${system}</button></div>`;
}

export function page({ title, prefix, body, description, current = '' }) {
  const path = prefix || '';
  const nav = (name, file, label) => {
    const active = current === name ? ' active' : '';
    const aria = current === name ? ' aria-current="page"' : '';
    return `<a class="btn btn-ghost${active}" href="${path}${file}"${aria}>${label}</a>`;
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#03080a">
<script>try{var t=localStorage.getItem('ph.theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@200..800&amp;family=Geist+Mono:wght@100..900&amp;display=swap">
<link rel="alternate" type="application/rss+xml" title="Pool changes" href="${path}feed.xml">
<link rel="stylesheet" href="${path}style.css">
<script src="${path}theme.js" defer></script>
<script src="${path}localtime.js" type="module"></script>
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header class="topnav"><div class="topnav-inner">
<a class="brand" href="${path}index.html"><span class="brand-mark" aria-hidden="true"></span><span class="brand-or">OpenRouter </span>pool history</a>
<nav class="topnav-links" aria-label="Site">${nav('events', 'events.html', 'All changes')}${nav('feed', 'feed.html', 'Feed')}<a class="btn btn-ghost" href="${path}data/index.json">JSON</a></nav>
${themeSwitch('theme-nav')}
</div></header>
<main id="content">
${body}
</main>
<footer class="site-footer"><div class="footer-inner"><p>Built from the public OpenRouter API (no key, no test requests), reading every model's endpoints listing every 15 minutes, keeping a snapshot when something changed and one full snapshot a day; changes are also published as an <a href="${path}feed.xml">RSS feed</a>. For live prices, latency and each provider's full price history, use the model's page on OpenRouter. Prices are USD per million tokens as the listing quotes them, after any provider discount. <span class="archive">Wayback Machine copy</span> marks points transcribed by hand from Wayback Machine copies of the model page.</p><p class="faint">An independent record; not affiliated with OpenRouter.</p>${themeSwitch('theme-footer')}</div></footer>
</body>
</html>`;
}

// The rows as listed: a provider's routine price moves of one UTC day fold into one
// row at the newest of them, `{ at, rows }`; a lone routine move stays a plain row.
function listedRows(rows, routine) {
  const listed = [];
  const folds = new Map();
  for (const row of rows) {
    if (!routine.has(row.event)) {
      listed.push(row);
      continue;
    }
    const key = `${String(row.at).slice(0, 10)}|${row.event.provider}`;
    if (folds.has(key)) {
      folds.get(key).rows.push(row);
      continue;
    }
    const fold = { at: row.at, rows: [row] };
    folds.set(key, fold);
    listed.push(fold);
  }
  return listed.map(row => (row.rows?.length === 1 ? row.rows[0] : row));
}

function foldRow({ at, rows }) {
  const models = new Set(rows.map(row => row.event.model)).size;
  const text = `${rows[0].event.provider} changed prices ${rows.length} times across ${models} model${models === 1 ? '' : 's'}`;
  return `<li class="fold"><details><summary class="event">${timeHtml(at, 'time')} ${pill('neutral', 'frequent repricing')}<span class="event-body"> <span class="what">${escapeHtml(text)}</span></span></summary>\n<ul class="events">\n${rows.map(row => eventRow(row.event, row.at)).join('\n')}\n</ul></details></li>`;
}

function eventList(rows) {
  if (!rows.length) return '';
  const groups = [];
  for (const row of rows) {
    const key = String(row.at).slice(0, 10);
    const group = groups.at(-1);
    if (!group || group.key !== key) groups.push({ key, at: row.at, rows: [row] });
    else group.rows.push(row);
  }

  return `<div class="card event-card">${groups.map(group =>
    `<h3 class="day">${timeHtml(group.at, 'day')}</h3>\n<ul class="events">\n${group.rows.map(row => (row.rows ? foldRow(row) : eventRow(row.event, row.at))).join('\n')}\n</ul>`,
  ).join('\n')}</div>`;
}

function protections() {
  return `<aside class="card fixes" aria-label="OpenRouter's own protections">
<p class="fixes-title">Protect your traffic with OpenRouter's own settings first</p>
<ul>
<li>${docLink(OR_DOCS.maxPrice, '<code>max_price</code>')} on the request (or in a preset) is a hard cap: no endpoint above it is used.</li>
<li>${docLink(OR_DOCS.floor, '<code>:floor</code>')} on the model id, or <code>sort: "price"</code>, tries the cheapest input price first (seen on real requests; it can cost more when a request has much output). A throughput or latency preference only moves slower endpoints to the back, so with a price sort a fast, expensive newcomer can still come first.</li>
<li>The served provider of every request is on the Logs page, in the response, or in full with the router metadata header.</li>
</ul>
<p class="faint">This record tells you when to look at those settings again. <a class="ext" href="${ROUTING_DOCS}" target="_blank" rel="noopener noreferrer">OpenRouter's provider routing docs</a></p>
</aside>`;
}

export function renderEvents(h) {
  const rows = siteRows(h);
  const models = new Set(rows.map(row => row.event.model)).size;
  const latest = h?.takenAt ? timeHtml(h.takenAt) : '';
  const body = `<header class="page-header">
<h1 class="page-title">All changes</h1>
<p class="subtitle">${rows.length} events across ${models} models, newest first; last snapshot ${latest}.</p>
<p class="meta"><a class="arrow-link" href="feed.xml" type="application/rss+xml">RSS feed of these changes <span aria-hidden="true">→</span></a> One item per model per snapshot, in the same shape as OpenRouter's new-models feed, so an RSS bot can post it to Discord.</p>
</header>
${rows.length ? eventList(listedRows(rows, routineMoves(h?.events))) : '<div class="card empty"><p>No changes recorded yet.</p></div>'}`;

  return page({
    title: 'All changes · OpenRouter pool history',
    prefix: '',
    description: 'Every recorded provider change on OpenRouter models: joins with their price against the cheapest, departures and price moves.',
    current: 'events',
    body,
  });
}

export function renderIndex(h) {
  const all = siteRows(h);
  const newest = new Date(h?.takenAt || 0).getTime();
  const week = all.filter(row => new Date(row.at).getTime() >= newest - 7 * 24 * 60 * 60 * 1000);
  // The cut counts rows as listed (a fold is one); "See all" counts every change.
  const listed = listedRows(week, routineMoves(h?.events));
  const shown = listed.slice(0, 20);
  // The newest full snapshot's count, so a newer partial does not move it.
  const newestFull = (h?.snapshots || []).findLast(s => s.partial === false);
  const modelCount = newestFull?.modelCount ?? Object.keys(h?.models || {}).length;
  const multi = Object.values(h?.models || {}).filter(m => m.everMulti).length;
  const snapshots = h?.snapshots?.length ?? 0;

  const body = `<header class="page-header">
<h1 class="page-title">OpenRouter pool history</h1>
<p class="subtitle">Each OpenRouter model is served by one or more providers. OpenRouter&#39;s model pages show each provider&#39;s current price and its price history. What they do not do is tell you when the providers change: a provider joining at many times the cheapest price, a price going up, a provider leaving. This site checks every model&#39;s providers every 15 minutes and keeps those changes as a dated record anyone can link to, including providers that have left, which OpenRouter&#39;s own history no longer shows. <a href="feed.xml">RSS feed</a>.</p>
<p class="meta">Last snapshot ${timeHtml(h?.takenAt)} · ${modelCount} models · ${multi} with more than one endpoint · ${snapshots} snapshots</p>
<p class="meta">A snapshot is one reading of every model's providers and prices.</p>
</header>
${protections()}
<section id="week">
<div class="section-head"><h2 class="section-title">Recent changes</h2><a class="arrow-link" href="events.html">All changes <span aria-hidden="true">→</span></a></div>
<p class="section-intro key">Each change is labelled in words: "joined · 12x" is a newcomer at 3x the cheapest or more; "price increase · 25%+" is an input or output price up 25% or more. Input and output prices are each compared with the cheapest on that side, per million tokens.</p>
${shown.length ? eventList(shown) : '<div class="card empty"><p>No changes in the last seven days.</p></div>'}
${listed.length > 20 ? `<p class="more"><a class="arrow-link" href="events.html">See all ${week.length} changes this week <span aria-hidden="true">→</span></a></p>` : ''}
</section>`;

  return page({
    title: 'OpenRouter pool history',
    prefix: '',
    description: 'Which providers joined, left or changed price on each OpenRouter model, kept as a dated record and an RSS feed.',
    current: 'index',
    body,
  });
}
