import {
  shownEvents,
  eventSentence,
  cheapestNow,
  rangeSides,
  standingText,
  tiedText,
  listedPrices,
} from './events.mjs';
import { fmtUsdPerM, fmtUsd, PRICE_UNITS, asListed } from './format.mjs';
import { orModelUrl } from './links.mjs';
import { page, eventPill, termLink } from './render.mjs';
import { fmtWhen, whenHtml } from './when.mjs';
import { modelTypeLabel, perTokenPriced, listedPriceKind } from './model-types.mjs';
import {
  DYNAMIC_WINDOW_MS,
  repricingIndex,
  dynamicProviders,
  pushedRange,
  routineMove,
} from './rules.mjs';

export { DYNAMIC_MIN_CHECKS, DYNAMIC_SHARE, DYNAMIC_WINDOW_MS } from './rules.mjs';

const FEED_TITLE = 'OpenRouter pool history - Pool changes';
const FEED_DESC =
  'Providers joining and leaving OpenRouter models, and their price changes, checked every 15 minutes in the public endpoints API. Independent; not affiliated with OpenRouter.';

function escapeXml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function cdata(str) {
  return `<![CDATA[${String(str || '').replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
}

function normalizeSiteUrl(url) {
  if (!url) return null;
  const s = String(url).trim();
  if (!s) return null;
  return s.replace(/\/+$/, '') + '/';
}

function rfc822(iso) {
  if (!iso) return 'Thu, 01 Jan 1970 00:00:00 GMT';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Thu, 01 Jan 1970 00:00:00 GMT' : d.toUTCString();
}

function eventRank(e) {
  switch (e?.type) {
    case 'joined':
      return 0;
    case 'left':
      return 1;
    case 'model-listed':
    case 'model-delisted':
    case 'pool-empty':
      return 2;
    case 'price-changed':
      return e.direction === 'down' ? 5 : 3;
    case 'spread-crossed':
      return 4;
    case 'quantization-changed':
      return 6;
    case 'cheapest-changed':
      return 7;
    default:
      return 8;
  }
}

function eventSize(e) {
  if (typeof e?.change === 'number' && Number.isFinite(e.change)) {
    return Math.abs(e.change);
  }
  if (typeof e?.ratio === 'number' && Number.isFinite(e.ratio)) {
    return e.ratio;
  }
  return 0;
}

function shortDate(iso) {
  const text = fmtWhen(iso);
  return text ? text.split(',')[0] : '';
}

function whenText(since, at, sources) {
  const isArchived = (s) => s === 'archived-model-page';
  const aArchived = isArchived(sources?.[0]);
  const bArchived = isArchived(sources?.[1]);

  const sinceText = fmtWhen(since);
  const atText = fmtWhen(at);
  const sinceShort = shortDate(since);
  const atShort = shortDate(at);

  if (aArchived && bArchived) {
    return `Between ${sinceShort} and ${atShort}, both from Wayback Machine copies of the model page, transcribed by hand.`;
  }
  if (aArchived) {
    return `Between ${sinceShort} and ${atShort}; ${sinceShort} is from a Wayback Machine copy of the model page, transcribed by hand.`;
  }
  if (bArchived) {
    return `Between ${sinceShort} and ${atShort}; ${atShort} is from a Wayback Machine copy of the model page, transcribed by hand.`;
  }

  const startMs = new Date(since).getTime();
  const endMs = new Date(at).getTime();
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs - startMs > 36 * 3_600_000) {
    return `Between ${sinceShort} and ${atShort} (no snapshot in between).`;
  }

  return `Between the snapshots of ${sinceText} and ${atText}.`;
}

function whenHtmlForPage(since, at, sources) {
  const isArchived = (s) => s === 'archived-model-page';
  const aArchived = isArchived(sources?.[0]);
  const bArchived = isArchived(sources?.[1]);

  if (aArchived || bArchived) {
    return escapeHtml(whenText(since, at, sources));
  }

  const startMs = new Date(since).getTime();
  const endMs = new Date(at).getTime();
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs - startMs > 36 * 3_600_000) {
    return `Between ${whenHtml(since, 'date')} and ${whenHtml(at, 'date')} (no snapshot in between).`;
  }

  return `Between the snapshots of ${whenHtml(since, 'datetime')} and ${whenHtml(at, 'datetime')}.`;
}

function modelLabel(name, modelId) {
  let cleaned = String(name || modelId || '').trim();
  const colonIdx = cleaned.indexOf(':');
  if (colonIdx > 0 && colonIdx <= 40) {
    cleaned = cleaned.slice(colonIdx + 1).trim();
  }
  return `${cleaned} (${modelId})`;
}

function whoForTitle(provider, tag, sharedProviders, events) {
  const provEvents = (events || []).filter((e) => e.provider === provider);
  const needsTag = (sharedProviders || []).includes(provider) || provEvents.length > 1;
  return needsTag && tag ? `${provider} (${tag})` : provider;
}

function tieChangeKind(side) {
  if (!side?.from || !side?.to) return null;
  const fromSet = new Set(side.from);
  const toSet = new Set(side.to);
  const oldInNew = side.from.every((t) => toSet.has(t));
  const newInOld = side.to.every((t) => fromSet.has(t));
  if (oldInNew && toSet.size > fromSet.size) return 'tied';
  if (newInOld && fromSet.size > toSet.size) return 'untied';
  return null;
}

function eventKind(e) {
  switch (e?.type) {
    case 'model-delisted':
      return 'Model delisted';
    case 'pool-empty':
      return 'No providers left';
    case 'joined':
      return e.replaces ? 'Endpoint changed' : 'New provider';
    case 'left':
      if (e.returned) return 'Provider briefly unlisted';
      if (e.confirmed === false) return 'Provider missing';
      return e.providerStays ? 'Endpoint removed' : 'Provider removed';
    case 'price-changed':
      if (e.direction === 'up') return 'Price increase';
      if (e.direction === 'down') return 'Price decrease';
      return 'Price change';
    case 'cheapest-changed': {
      const kinds = [tieChangeKind(e.input), tieChangeKind(e.output)];
      if (kinds.includes('tied')) return 'Cheapest now tied';
      if (kinds.includes('untied')) return 'Cheapest no longer tied';
      return 'New cheapest provider';
    }
    case 'spread-crossed':
      return e.up ? 'Price range widened' : 'Price range narrowed';
    case 'quantization-changed':
      return 'Quantization changed';
    case 'model-listed':
      return 'Model listed';
    default:
      return 'Change';
  }
}

function priceSidePhrase(name, side) {
  if (!side) return null;
  if (side.from === 0 && side.to > 0) {
    return `${name} free to ${fmtUsdPerM(side.to)}`;
  }
  if (side.from > 0 && side.to === 0) {
    return `${name} ${fmtUsdPerM(side.from)} to free`;
  }
  const pct = Math.round(side.change * 100);
  const sign = pct >= 0 ? '+' : '';
  return `${name} ${sign}${pct}%`;
}

// A listed price move in a title: `per second with audio (4K) +25%`; a key with no known unit
// keeps its numbers as listed: `prompt 0 to 0.00000002`; a price the list starts or stops
// giving: `per million input tokens now listed`.
function movePhrase(move) {
  const known = Object.hasOwn(PRICE_UNITS, move.unit);
  const name = known
    ? `${PRICE_UNITS[move.unit]}${move.detail ? ` (${move.detail})` : ''}`
    : move.key;
  if (move.from === null) return `${name} now listed`;
  if (move.to === null) return `${name} no longer listed`;
  if (!Number.isFinite(move.change)) {
    return known
      ? `${name} ${fmtUsd(move.from)} to ${fmtUsd(move.to)}`
      : `${name} ${asListed(move.from)} to ${asListed(move.to)}`;
  }
  const pct = Math.round(move.change * 100);
  return `${name} ${pct >= 0 ? '+' : ''}${pct}%`;
}

function priceDetail(e) {
  const parts = [];
  const pStr = priceSidePhrase('input', e.prompt);
  if (pStr) parts.push(pStr);
  const cStr = priceSidePhrase('output', e.completion);
  if (cStr) parts.push(cStr);
  for (const move of e.moves || []) parts.push(movePhrase(move));
  return parts.join(', ');
}

// The tied text for the cheapest side; a provider with
// several endpoints across the two observations is named with its endpoint id.
function cheapestNames(side, sharedProviders) {
  const several = new Set(side.toProviders).size > 1;
  const items = side.to.map((tag, i) => {
    const provider = side.toProviders[i];
    const label = several && sharedProviders.includes(provider) ? `${provider} (${tag})` : provider;
    return { tag, provider, label };
  });
  return tiedText(items, items.length > 1 ? fmtUsdPerM(side.toPrice) : null);
}

function cheapestShortPhrase(e, sharedProviders) {
  const inKind = tieChangeKind(e.input);
  const outKind = tieChangeKind(e.output);
  if (inKind === 'tied' || outKind === 'tied') {
    return 'cheapest now tied';
  }
  if (inKind === 'untied' || outKind === 'untied') {
    return 'cheapest no longer tied';
  }

  const inSameAsOut =
    e.input &&
    e.output &&
    e.input.to.join(',') === e.output.to.join(',') &&
    e.input.toProviders.join(',') === e.output.toProviders.join(',');

  if (inSameAsOut) {
    return `cheapest now ${cheapestNames(e.input, sharedProviders)}`;
  }

  if (e.input && e.output) {
    const inNames = cheapestNames(e.input, sharedProviders);
    const outNames = cheapestNames(e.output, sharedProviders);
    return `cheapest input now ${inNames}, output now ${outNames}`;
  }

  if (e.input) {
    return `cheapest input now ${cheapestNames(e.input, sharedProviders)}`;
  }

  if (e.output) {
    return `cheapest output now ${cheapestNames(e.output, sharedProviders)}`;
  }

  return 'cheapest changed';
}

function spreadShortPhrase(e) {
  const sides = rangeSides(e);
  const widened = sides.filter(([, s]) => s.up);
  const narrowed = sides.filter(([, s]) => !s.up);
  const parts = [];

  if (widened.length > 0) {
    const sideNames = widened.map(([name]) => name).join(' and ');
    const allCheapestFell = widened.every(([, s]) => s.cause === 'cheapest-fell');
    const suffix = allCheapestFell ? ' as the cheapest fell' : '';
    parts.push(`${sideNames} price range above 3x${suffix}`);
  }

  if (narrowed.length > 0) {
    const sideNames = narrowed.map(([name]) => name).join(' and ');
    parts.push(`${sideNames} price range back under 3x`);
  }

  return parts.join(', ');
}

function eventShortPhrase(e, sharedProviders, events) {
  switch (e.type) {
    case 'joined': {
      if (e.replaces) {
        const who = whoForTitle(e.provider, e.tag, sharedProviders, events);
        return `${who} endpoint changed: ${e.replaces} to ${e.tag}`;
      }
      const who = whoForTitle(e.provider, e.tag, sharedProviders, events);
      const st = standingText(e.standing);
      return st ? `${who} joined, ${st}` : `${who} joined`;
    }
    case 'left': {
      const who = whoForTitle(e.provider, e.tag, sharedProviders, events);
      if (e.returned) return `${who} briefly unlisted`;
      if (e.confirmed === false) return `${who} missing at the last check`;
      if (e.providerStays) return `${who} endpoint removed`;
      return `${who} left`;
    }
    case 'price-changed': {
      const who = e.provider
        ? whoForTitle(e.provider, e.tag, sharedProviders, events)
        : 'model price';
      const detail = priceDetail(e);
      return detail ? `${who} ${detail}` : `${who} price changed`;
    }
    case 'quantization-changed': {
      const who = whoForTitle(e.provider, e.tag, sharedProviders, events);
      return `${who} quantization ${e.from} to ${e.to}`;
    }
    case 'spread-crossed':
      return spreadShortPhrase(e);
    case 'cheapest-changed':
      return cheapestShortPhrase(e, sharedProviders);
    case 'model-listed':
      return `listed with ${e.endpoints} endpoint${e.endpoints === 1 ? '' : 's'}`;
    case 'model-delisted':
      return 'delisted';
    case 'pool-empty':
      return 'no endpoints left';
    default:
      return 'change';
  }
}

function isEventSaidByJoin(e, events) {
  if (e.type === 'left' && e.replacedBy) {
    return events.some((o) => o.type === 'joined' && o.replaces === e.tag);
  }
  if (e.type === 'cheapest-changed') {
    const joins = events.filter((o) => o.type === 'joined' && !o.rejoined);
    if (joins.length !== 1) return false;
    const newcomer = joins[0];
    const changedSides = [e.input, e.output].filter(Boolean);
    if (changedSides.length === 0) return false;

    for (const side of changedSides) {
      if (!side.to.includes(newcomer.tag)) return false;
      if (side.to.length !== 1) return false;
    }
    return true;
  }
  return false;
}

function buildTitle(typeLabel, events, modelId, modelName, sharedProviders) {
  const leadCandidate = events.find((e) => !isEventSaidByJoin(e, events)) || events[0];
  const leadIdx = events.indexOf(leadCandidate);
  const remainingEvents = events.filter(
    (e, idx) => idx !== leadIdx && !isEventSaidByJoin(e, events)
  );

  const kind = eventKind(leadCandidate);
  const label = modelLabel(modelName, modelId);
  const hasProvider = Boolean(leadCandidate.provider);
  const who = hasProvider
    ? whoForTitle(leadCandidate.provider, leadCandidate.tag, sharedProviders, events)
    : null;
  const subject = who ? `${who} on ${label}` : label;

  let detail = null;
  switch (leadCandidate.type) {
    case 'joined':
      detail = leadCandidate.replaces
        ? `${leadCandidate.replaces} to ${leadCandidate.tag}`
        : standingText(leadCandidate.standing);
      break;
    case 'left':
      if (leadCandidate.returned) detail = 'came back';
      else if (leadCandidate.confirmed === false) detail = 'may come back';
      break;
    case 'price-changed':
      detail = priceDetail(leadCandidate);
      break;
    case 'quantization-changed':
      detail = `quantization ${leadCandidate.from} to ${leadCandidate.to}`;
      break;
    case 'model-listed':
      detail = `${leadCandidate.endpoints} endpoint${leadCandidate.endpoints === 1 ? '' : 's'}`;
      break;
    case 'spread-crossed':
      detail = spreadShortPhrase(leadCandidate);
      break;
    case 'cheapest-changed':
      detail = cheapestShortPhrase(leadCandidate, sharedProviders);
      break;
  }

  let lead = `${kind}: ${subject}`;
  if (detail) {
    lead += ` · ${detail}`;
  }

  let title = typeLabel ? `${typeLabel} · ${lead}` : lead;

  const morePhrases = remainingEvents.map((e) =>
    eventShortPhrase(e, sharedProviders, events)
  );

  let i = 0;
  while (i < morePhrases.length) {
    const phrase = morePhrases[i];
    const remainingAfter = morePhrases.length - (i + 1);
    const reserveSuffix =
      remainingAfter > 0
        ? ` · +${remainingAfter} more change${remainingAfter === 1 ? '' : 's'}`
        : '';
    const tentative = `${title} · ${phrase}${reserveSuffix}`;

    if (tentative.length <= 120) {
      title = `${title} · ${phrase}`;
      i++;
    } else {
      break;
    }
  }

  const leftOut = morePhrases.length - i;
  if (leftOut > 0) {
    title += ` · +${leftOut} more change${leftOut === 1 ? '' : 's'}`;
  }

  return title;
}

function findSharedProviders(modelHistory, at) {
  if (!modelHistory) return [];
  const series = modelHistory.series || [];
  const currentIdx = series.findIndex((pt) => pt.takenAt === at);
  const currentPt = currentIdx >= 0 ? series[currentIdx] : null;
  const prevPt = currentIdx > 0 ? series[currentIdx - 1] : null;

  const provTags = new Map();
  function addPt(pt) {
    if (!pt?.prices) return;
    for (const [tag, rec] of Object.entries(pt.prices)) {
      if (!rec?.provider) continue;
      if (!provTags.has(rec.provider)) provTags.set(rec.provider, new Set());
      provTags.get(rec.provider).add(tag);
    }
  }

  addPt(prevPt);
  addPt(currentPt);

  const shared = [];
  for (const [prov, tags] of provTags.entries()) {
    if (tags.size > 1) {
      shared.push(prov);
    }
  }
  return shared.sort();
}

function poolAt(modelHistory, at) {
  if (!modelHistory) return [];
  if (modelHistory.latest?.takenAt === at) {
    return modelHistory.latest.endpoints || [];
  }
  const pt = (modelHistory.series || []).find((s) => s.takenAt === at);
  if (!pt?.prices) return [];
  return Object.entries(pt.prices).map(([tag, rec]) => ({
    tag,
    provider: rec.provider,
    prompt: rec.prompt,
    completion: rec.completion,
    discount: rec.discount,
    quantization: rec.quantization,
    ...(rec.listed ? { prices: rec.listed } : {}),
  }));
}

// What a model priced other than per token lists at `at`: the model's own prices (a video
// model's) and each endpoint's (an image, speech, transcription, embeddings, rerank or decision
// model's), an endpoint with none shown left out; null for every other model.
function listedAt(modelHistory, at, pool) {
  if (!listedPriceKind(modelHistory?.outputModalities)) return null;
  const modelPrices = modelHistory.latest?.takenAt === at
    ? modelHistory.latest.modelPrices
    : (modelHistory.series || []).find((s) => s.takenAt === at)?.modelPrices;
  return {
    model: listedPrices(modelPrices),
    endpoints: pool
      .map((e) => ({ tag: e.tag, provider: e.provider, prices: listedPrices(e.prices) }))
      .filter((e) => e.prices.length > 0),
  };
}

export function dynamicCheapest(item) {
  if (!item?.dynamic?.length || !item?.events?.length) return false;
  const dynamicProviders = new Set(item.dynamic.map((d) => d.provider));
  return item.events.some((e) => {
    if (e.type !== 'cheapest-changed') return false;
    const providers = [
      ...(e.input?.toProviders || []),
      ...(e.input?.fromProviders || []),
      ...(e.output?.toProviders || []),
      ...(e.output?.fromProviders || []),
    ];
    return providers.some((p) => dynamicProviders.has(p));
  });
}

// A range side crossed above 3x because a dynamic provider's new price became its low or high.
function dynamicRange(item) {
  const dynamicProviders = new Set(item.dynamic.map((d) => d.provider));
  const moves = item.events.filter(
    (e) => e.type === 'price-changed' && dynamicProviders.has(e.provider)
  );
  return item.events.some(
    (e) => e.type === 'spread-crossed' && moves.some((m) => pushedRange(m, e))
  );
}

// An item whose every event is a routine move by a dynamic provider is left out of
// the feeds; the history and the site's JSON keep it.
function publishedItems(h, { siteUrl, limit }) {
  return feedItems(h, { siteUrl, limit: Infinity })
    .filter((item) => {
      const dynamic = new Set(item.dynamic.map((d) => d.provider));
      return !item.events.every((e) => routineMove(e, item.events, dynamic));
    })
    .slice(0, limit);
}

export function feedItems(h, { siteUrl = null, limit = 200 } = {}) {
  const normSite = normalizeSiteUrl(siteUrl);
  const ownPageUrl = normSite ? `${normSite}events.html` : null;

  const rawEvents = h?.events || [];
  const repricing = repricingIndex(rawEvents);

  const groups = new Map();
  for (const e of rawEvents) {
    const key = `${e.model}|${e.at}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const items = [];

  for (const [key, evList] of groups.entries()) {
    const shown = shownEvents(evList);
    if (shown.length === 0) continue;

    const [modelId, at] = key.split('|');
    const modelHist = h?.models?.[modelId] || null;
    const modelName = String(modelHist?.name || modelId).trim();
    const outputModalities = modelHist?.outputModalities || null;

    const sortedEvents = [...shown].sort((a, b) => {
      const ra = eventRank(a);
      const rb = eventRank(b);
      if (ra !== rb) return ra - rb;
      const sa = eventSize(a);
      const sb = eventSize(b);
      if (sa !== sb) return sb - sa;
      return shown.indexOf(a) - shown.indexOf(b);
    });

    const firstEv = sortedEvents[0];
    const since = firstEv.since;
    const sources = firstEv.sources || ['openrouter-api', 'openrouter-api'];
    const watcherOff = Boolean(firstEv.watcherOff);
    const archived = sources.some((s) => s === 'archived-model-page');
    const when = whenText(since, at, sources);

    const typeLabel = modelTypeLabel(outputModalities);
    const perToken = perTokenPriced(outputModalities);
    const openrouterUrl = orModelUrl(modelId);
    const sharedProviders = findSharedProviders(modelHist, at);

    const title = buildTitle(typeLabel, sortedEvents, modelId, modelName, sharedProviders);

    const liItems = sortedEvents
      .map((e) => `<li>${escapeHtml(eventSentence(e))}</li>`)
      .join('');
    let descriptionHtml = `<ul>${liItems}</ul><p>${escapeHtml(when)}</p><p><a href="${openrouterUrl}">${escapeHtml(modelName)} on OpenRouter</a>`;
    if (normSite) {
      descriptionHtml += ` · <a href="${normSite}events.html">Pool history</a>`;
    }
    descriptionHtml += `</p>`;

    const pool = poolAt(modelHist, at);
    const cheapest = cheapestNow(pool);
    const listed = listedAt(modelHist, at, pool);

    const repricedProviders = [
      ...new Set(
        sortedEvents
          .filter((e) => e.type === 'price-changed' && e.provider)
          .map((e) => e.provider)
      ),
    ];
    const dynamic = dynamicProviders(repricing, at, repricedProviders, modelHist?.series);

    items.push({
      model: modelId,
      at,
      guid: `${modelId}-${at}`,
      title,
      description: descriptionHtml,
      link: openrouterUrl,
      pubDate: rfc822(at),
      name: modelName,
      since,
      sources,
      watcherOff,
      when,
      archived,
      openrouterUrl,
      ownPage: ownPageUrl,
      events: sortedEvents,
      sharedProviders,
      cheapest,
      modelType: typeLabel,
      outputModalities,
      perToken,
      dynamic,
      ...(listed ? { listedPrices: listed } : {}),
    });
  }

  items.sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? 1 : -1;
    return a.model.localeCompare(b.model);
  });

  const byModel = new Map();
  for (const item of items) {
    if (!byModel.has(item.model)) byModel.set(item.model, []);
    byModel.get(item.model).push(item);
  }

  for (const modelItems of byModel.values()) {
    const chrono = [...modelItems].sort((a, b) => (a.at > b.at ? 1 : -1));
    let lastDynamicCheapestTime = -Infinity;
    let lastDynamicRangeTime = -Infinity;

    for (const item of chrono) {
      if (dynamicRange(item)) {
        const itemTime = new Date(item.at).getTime();
        if (Number.isFinite(itemTime) && itemTime - lastDynamicRangeTime < DYNAMIC_WINDOW_MS) {
          item.repeatDynamicRange = true;
        } else {
          item.repeatDynamicRange = false;
          lastDynamicRangeTime = itemTime;
        }
      }
      if (dynamicCheapest(item)) {
        const itemTime = new Date(item.at).getTime();
        if (Number.isFinite(itemTime) && itemTime - lastDynamicCheapestTime < DYNAMIC_WINDOW_MS) {
          item.repeatDynamicCheapest = true;
        } else {
          item.repeatDynamicCheapest = false;
          lastDynamicCheapestTime = itemTime;
        }
      }
    }
  }

  return limit === Infinity ? items : items.slice(0, limit);
}

export function renderFeed(h, { siteUrl = null, limit = 200 } = {}) {
  const normSite = normalizeSiteUrl(siteUrl);
  const items = publishedItems(h, { siteUrl: normSite, limit });

  const channelLink = normSite || 'https://openrouter.ai';
  const selfLinkTag = normSite
    ? `\n<atom:link href="${normSite}feed.xml" rel="self" type="application/rss+xml"/>`
    : '';

  const lastBuildDate = rfc822(h?.takenAt);

  let itemsXml = '';
  if (items.length === 0) {
    itemsXml = '\n';
  } else {
    itemsXml = items
      .map(
        (it) =>
          `<item>\n<title>${cdata(it.title)}</title>\n<description>${cdata(
            it.description
          )}</description>\n<link>${escapeXml(it.link)}</link>\n<guid isPermaLink="false">${escapeXml(
            it.guid
          )}</guid>\n<pubDate>${it.pubDate}</pubDate>\n</item>`
      )
      .join('\n') + '\n';
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${FEED_TITLE}</title>
<description>${FEED_DESC}</description>
<link>${channelLink}</link>${selfLinkTag}
<lastBuildDate>${lastBuildDate}</lastBuildDate>
<language>en-us</language>
<generator>openrouter-pool-history</generator>
${itemsXml}</channel>
</rss>
`;
}

export function renderJsonFeed(h, { siteUrl = null, limit = 200 } = {}) {
  const normSite = normalizeSiteUrl(siteUrl);
  const items = publishedItems(h, { siteUrl: normSite, limit });

  const jsonFeed = {
    version: 'https://jsonfeed.org/version/1.1',
    title: FEED_TITLE,
    description: FEED_DESC,
    home_page_url: normSite || 'https://openrouter.ai',
    ...(normSite ? { feed_url: `${normSite}feed.json` } : {}),
    language: 'en-US',
    items: items.map((it) => {
      const itemEvents = it.events.map((e) => {
        const { model, at, since, sources, ...own } = e;
        return {
          ...own,
          sentence: eventSentence(e),
        };
      });

      const poolHistory = {
        model: it.model,
        model_name: it.name,
        model_type: it.modelType,
        output_modalities: it.outputModalities,
        observed_at: it.at,
        previous_at: it.since,
        sources: it.sources,
        archived: it.archived,
        when: it.when,
        openrouter_url: it.openrouterUrl,
        ...(it.ownPage ? { page_url: it.ownPage } : {}),
        events: itemEvents,
      };

      return {
        id: it.guid,
        url: it.link,
        title: it.title,
        content_html: it.description,
        date_published: it.at,
        _pool_history: poolHistory,
      };
    }),
  };

  return JSON.stringify(jsonFeed, null, 1) + '\n';
}

export function renderFeedPage(h) {
  const items = publishedItems(h, { siteUrl: null, limit: 200 });

  let articlesHtml = '';
  if (items.length === 0) {
    articlesHtml = '<div class="card empty"><p>No changes recorded yet.</p></div>';
  } else {
    articlesHtml = items
      .map((it) => {
        const eventLis = it.events
          .map((e) => {
            const pill = eventPill(e);
            const sentence = escapeHtml(eventSentence(e));
            const term = termLink(e);
            return `<li>${pill}<span>${sentence}</span>${term}</li>`;
          })
          .join('');

        const whenP = whenHtmlForPage(it.since, it.at, it.sources);

        const eventTypes = [...new Set(it.events.map((e) => e.type))].join(', ');

        return `<article class="feed-item" data-guid="${escapeHtml(it.guid)}">
<header class="feed-head"><h2 class="feed-title">${escapeHtml(it.title)}</h2>${whenHtml(
          it.at,
          'datetime'
        )}</header>
<ul class="feed-events">${eventLis}</ul>
<p class="feed-when">${whenP}</p>
<p class="feed-links"><a class="ext" href="${escapeHtml(
          it.openrouterUrl
        )}" target="_blank" rel="noopener noreferrer">${escapeHtml(
          it.name
        )} on OpenRouter<span class="sr-only"> (opens OpenRouter in a new tab)</span></a></p>
<details class="feed-fields"><summary>Item fields</summary><dl>
<dt>title</dt><dd>${escapeHtml(it.title)}</dd>
<dt>link</dt><dd><code>${escapeHtml(it.link)}</code></dd>
<dt>guid</dt><dd><code>${escapeHtml(it.guid)}</code></dd>
<dt>pubDate</dt><dd><code>${escapeHtml(it.pubDate)}</code></dd>
<dt>event types</dt><dd><code>${escapeHtml(eventTypes)}</code></dd>
</dl></details>
</article>`;
      })
      .join('\n');
  }

  const body = `<header class="page-header">
<h1 class="page-title">Pool-change feed</h1>
<p class="subtitle">${items.length} items, one per model per snapshot in which its providers changed: who joined (and at what multiple of the cheapest), who left, which prices moved. Newest first; the same items are in both formats below. OpenRouter's own feed lists new models only; this one lists provider changes on existing models.</p>
<p class="meta">Routine price moves by providers that reprice many times a day are left out; a move that makes or ends one the cheapest, or pushes a price range past 3x, stays in. <a href="events.html">All changes</a> keeps every move.</p>
<div class="hero-actions"><a class="btn btn-outline" href="feed.xml" type="application/rss+xml">RSS 2.0 (feed.xml)</a><a class="btn btn-outline" href="feed.json" type="application/feed+json">JSON Feed (feed.json)</a></div>
<p class="meta">feed.xml has the same shape as OpenRouter's new-models feed, so an RSS bot such as MonitoRSS can post it to Discord as is. feed.json carries every change as typed data (type, provider, tag, prices, multiple of the cheapest, the sentence) for a bot that formats its own messages.</p>
</header>
${articlesHtml}`;

  return page({
    title: 'Pool-change feed · OpenRouter pool history',
    description:
      'An RSS and JSON feed of provider changes on OpenRouter models: joins, departures and price moves.',
    current: 'feed',
    body,
  });
}
