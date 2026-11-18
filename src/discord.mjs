import {
  fmtUsdPerM,
  fmtVsCheapest,
  fmtCount,
  fmtListedPrice,
  fmtPriceMove
} from './format.mjs';
import {
  cheapestSides,
  rangeSides,
  rangeText,
  standingText,
  tieChange,
  tiedText,
  listedPricesText
} from './events.mjs';
import { PRICE_MAJOR } from './rules.mjs';
import { orProviderUrl, providerSlug } from './links.mjs';
import { OR_DOCS, tierOf } from './docs-links.mjs';
import { baseId, formatTokens } from './usage.mjs';
import { col, frame, modelFooter, rows } from './frame.mjs';

export const ROUTE_BUTTON = Object.freeze({
  type: 2,
  style: 1,
  custom_id: 'route',
  label: 'Test request'
});

const PRICE_TIP =
  `Set [\`max_price\`](${OR_DOCS.maxPrice}) to keep requests off endpoints above your limit · ` +
  `[See how routing works →](${OR_DOCS.providerRouting})`;

const HIDING =
  `OpenRouter [hides an endpoint](${OR_DOCS.hiding}) when its provider stops listing the model, reports it not ready, or it fails every request; one can come back.`;

const plural = {
  'New provider': 'new providers',
  'Provider removed': 'providers removed',
  'Endpoint removed': 'endpoints removed',
  'Endpoint changed': 'endpoints changed',
  'Price increase': 'price increases',
  'Price decrease': 'price decreases',
  'Price change': 'price changes',
  'Quantization changed': 'quantization changes'
};

const order = [
  'Model delisted',
  'No providers left',
  'New provider',
  'Provider removed',
  'Endpoint removed',
  'Endpoint changed',
  'Price increase',
  'Price decrease',
  'Price change',
  'New cheapest provider',
  'Cheapest now tied',
  'Cheapest no longer tied',
  'Price range widened',
  'Price range narrowed',
  'Quantization changed'
];

const numeric = n => typeof n === 'number' && Number.isFinite(n);

function escaped(text) {
  return String(text).replace(/[[\]()]/g, '\\$&');
}

export function linked(provider, tag) {
  const slug = providerSlug(tag);
  const url = slug ? orProviderUrl(tag) : null;
  return url ? `[${escaped(provider)}](${url})` : String(provider);
}

export function modelFromFooter(text) {
  const value = String(text || '');
  const match = value.match(/^Model id:\s*([^·]+?)(?:\s*·|$)/);
  if (match) return match[1].trim();
  return value && !/\s/.test(value) && value.includes('/') ? value : '';
}

function cheapestLabel(event) {
  const sides = [event.input, event.output].filter(Boolean);
  for (const side of sides) {
    const from = side.from || [];
    const to = side.to || [];
    const fromSet = new Set(from);
    const toSet = new Set(to);
    if (from.every(x => toSet.has(x)) && to.length > from.length) {
      return 'Cheapest now tied';
    }
    if (to.every(x => fromSet.has(x)) && from.length > to.length) {
      return 'Cheapest no longer tied';
    }
  }
  return 'New cheapest provider';
}

export function kindLabel(e) {
  if (!e) return null;
  switch (e.type) {
    case 'model-delisted': return 'Model delisted';
    case 'pool-empty': return 'No providers left';
    case 'model-listed': return null;
    case 'joined': return e.replaces ? 'Endpoint changed' : 'New provider';
    case 'left':
      if (e.replacedBy) return 'Endpoint changed';
      return e.providerStays ? 'Endpoint removed' : 'Provider removed';
    case 'price-changed':
      return e.direction === 'down'
        ? 'Price decrease'
        : e.direction === 'mixed'
          ? 'Price change'
          : 'Price increase';
    case 'cheapest-changed': return cheapestLabel(e);
    case 'spread-crossed':
      return (e.up ?? rangeSides(e).some(([, side]) => side.up)) ? 'Price range widened' : 'Price range narrowed';
    case 'quantization-changed': return 'Quantization changed';
    default: return null;
  }
}

function eventsOf(items) {
  if (!Array.isArray(items)) return [];
  return items.flatMap(item => Array.isArray(item?.events) ? item.events : [item]);
}

function suppressedCheapest(events, e) {
  if (e.type !== 'cheapest-changed') return false;
  const joins = events.filter(x => x.type === 'joined' && !x.rejoined);
  if (!joins.length) return false;
  const sides = [e.input, e.output].filter(Boolean);
  return sides.length > 0 && sides.every(side =>
    side.to.length === 1 && joins.some(join => join.tag === side.to[0])
  );
}

export function kindCounts(items) {
  const events = eventsOf(items);
  const usable = events.filter(e => kindLabel(e) && !suppressedCheapest(events, e));
  const map = new Map();

  for (const label of order) {
    const n = usable.filter(e => kindLabel(e) === label).length;
    if (n) map.set(label, n);
  }

  const counts = [...map].map(([label, n]) => ({ label, n }));
  const allParts = counts.map(({ label, n }) =>
    n > 1 && plural[label] ? `${n} ${plural[label]}` : label
  );
  const parts = allParts.length > 3
    ? [...allParts.slice(0, 3), `+${allParts.length - 3} more change${allParts.length - 3 === 1 ? '' : 's'}`]
    : allParts;

  return { total: usable.length, parts, counts };
}

function roseEnough(side, fraction = 0.1) {
  if (!side) return false;
  if (side.from === 0 && side.to > 0) return true;
  if (numeric(side.change)) return side.change >= fraction - 1e-9;
  return numeric(side.from) && numeric(side.to) && side.from > 0 &&
    side.to / side.from - 1 >= fraction - 1e-9;
}

export function cardEvent(e) {
  if (!e) return false;
  switch (e.type) {
    case 'joined':
      return !e.rejoined && !e.replaces;
    case 'left':
      return e.confirmed === true && !e.returned && !e.replacedBy;
    case 'model-delisted':
    case 'pool-empty':
      return true;
    case 'price-changed':
      return roseEnough(e.prompt) || roseEnough(e.completion) || (e.moves || []).some(move => roseEnough(move));
    case 'spread-crossed': {
      const sides = rangeSides(e);
      return (e.cause === 'priciest-rose' || sides.some(([, s]) => s.cause === 'priciest-rose')) &&
        (e.up || sides.some(([, s]) => s.up));
    }
    default:
      return false;
  }
}

function dynamicProvider(item, provider) {
  return (item.dynamic || []).some(d => d.provider === provider);
}

// A dynamic provider that becomes or stops being the cheapest.
function dynamicCheapest(item, event) {
  return [event.input, event.output].some(side =>
    [...(side?.toProviders || []), ...(side?.fromProviders || [])]
      .some(provider => dynamicProvider(item, provider))
  );
}

// The price range crossed because dynamic providers raised their prices, and only they did.
function dynamicRange(item) {
  const rises = (item.events || []).filter(e => e.type === 'price-changed' && e.direction !== 'down');
  return rises.length > 0 && rises.every(e => dynamicProvider(item, e.provider));
}

export function cardWorthy(item) {
  const events = item?.events || [];
  for (const event of events) {
    if (event.type === 'cheapest-changed' && dynamicCheapest(item, event)) {
      if (!item.repeatDynamicCheapest) return true;
      continue;
    }
    // A dynamic provider's 3x-range card, like its cheapest card, once per model in 24 hours.
    if (event.type === 'spread-crossed' && item.repeatDynamicRange && dynamicRange(item)) continue;
    if (event.type === 'price-changed' && dynamicProvider(item, event.provider)) continue;
    if (cardEvent(event)) return true;
  }
  return false;
}

export function costlyChange(item) {
  return (item?.events || []).some(event => {
    if (event.type === 'joined') return event.expensive === true;
    if (event.type === 'price-changed') {
      return roseEnough(event.prompt, PRICE_MAJOR) || roseEnough(event.completion, PRICE_MAJOR);
    }
    if (event.type === 'spread-crossed') {
      return [event, ...rangeSides(event).map(([, side]) => side)]
        .some(side => side.up === true && side.cause === 'priciest-rose');
    }
    return false;
  });
}

function listNames(providers, tags, ids = false, commaOnly = false) {
  const parts = [];
  const seen = new Set();
  for (let i = 0; i < (providers || []).length; i++) {
    const provider = providers[i];
    const tag = tags?.[i] ?? null;
    const key = ids ? `${provider}\0${tag}` : provider;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(`${linked(provider, tag)}${ids ? ` (${tag})` : ''}`);
  }
  if (commaOnly || parts.length < 2) return parts.join(', ');
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

function endpointName(item, event) {
  const needsId = (item.sharedProviders || []).includes(event.provider) ||
    (item.events || []).filter(x => x.provider === event.provider).length > 1 ||
    tierOf(event.tag);
  return `${linked(event.provider, event.tag)}${needsId ? ` (${event.tag})` : ''}`;
}

function standingCompact(side) {
  if (!side) return '';
  if (side.cheapest) return 'cheapest';
  if (side.vs === null) return 'the cheapest is free';
  return fmtVsCheapest(side.vs);
}

function changedBetween(item) {
  const a = Date.parse(item.since);
  const b = Date.parse(item.at);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b - a <= 20 * 60 * 1000) return '';
  if ((item.sources || []).some(x => x === 'archived-model-page')) {
    const date = iso => new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', timeZone: 'UTC'
    });
    return `Changed between ${date(item.since)} and ${date(item.at)} (dates from archived OpenRouter pages)`;
  }
  const since = Math.floor(a / 1000);
  const at = Math.floor(b / 1000);
  return `Changed between <t:${since}:f> and <t:${at}:f>${item.watcherOff ? ' (the watcher was off)' : ''}`;
}

function trafficInfo(provider, traffic) {
  if (!Array.isArray(traffic)) return null;
  const totals = new Map();
  for (const row of traffic) {
    if (!numeric(row?.requests30m)) continue;
    totals.set(row.provider, (totals.get(row.provider) || 0) + row.requests30m);
  }
  const total = [...totals.values()].reduce((a, b) => a + b, 0);
  if (!total || !totals.has(provider)) return null;
  const own = totals.get(provider);
  const active = [...totals.entries()].filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (own === 0) return { own, total, active, share: 'none', rank: null };
  const percent = own / total * 100;
  return {
    own, total, active,
    share: percent < 1 ? 'under 1%' : `${Math.round(percent)}%`,
    rank: active.findIndex(([p]) => p === provider) + 1
  };
}

function usageField(item, usage) {
  const value = usage?.get?.(baseId(item.model));
  if (!value) return null;
  return col('Model usage', [
    `#${value.rank} by tokens`,
    `[${formatTokens(value.tokens)} last week](https://openrouter.ai/rankings)`
  ]);
}

function compactSummary(item, event, traffic) {
  const who = endpointName(item, event);
  let summary = '';

  if (event.type === 'joined') {
    summary = `${who} joined at ${fmtUsdPerM(event.prompt)} in / ${fmtUsdPerM(event.completion)} out`;
  } else if (event.type === 'left') {
    summary = event.providerStays
      ? `${who} removed its ${event.tag} endpoint`
      : `${who} left this model`;
    if (event.remains) {
      summary += `; only ${linked(event.remains.provider, event.remains.tag)} remains`;
    }
  } else {
    const parts = [];
    for (const [name, side] of [['input', event.prompt], ['output', event.completion]]) {
      if (!side) continue;
      let verb;
      let detail;
      if (side.from === 0 && side.to > 0) {
        verb = 'raised';
        detail = `its ${name} price from free to ${fmtUsdPerM(side.to)}`;
      } else if (side.from > 0 && side.to === 0) {
        verb = 'cut';
        detail = `its ${name} price to free`;
      } else {
        verb = side.to >= side.from ? 'raised' : 'cut';
        detail = `${name} ${Math.abs(Math.round((side.to / side.from - 1) * 100))}%`;
      }
      parts.push({ verb, detail, side });
    }
    if (parts.length === 2 && parts[0].verb === parts[1].verb &&
      parts[0].side.from > 0 && parts[1].side.from > 0 &&
      Math.round(Math.abs(parts[0].side.change) * 100) === Math.round(Math.abs(parts[1].side.change) * 100)) {
      summary = `${who} ${parts[0].verb} input and output prices ${Math.round(Math.abs(parts[0].side.change) * 100)}%`;
    } else if (parts.length === 2 && parts[0].side.from > 0 && parts[1].side.from > 0) {
      const second = parts[1].verb === parts[0].verb ? parts[1].detail : `${parts[1].verb} ${parts[1].detail}`;
      summary = `${who} ${parts[0].verb} ${parts[0].detail} and ${second}`;
    } else if (parts.length === 1) {
      const { verb, detail, side } = parts[0];
      summary = side.from > 0 && side.to > 0
        ? `${who} ${verb} ${detail.replace(/^(input|output) /, 'its $1 price ')}`
        : `${who} ${verb} ${detail}`;
    } else {
      summary = `${who} ${parts.map(p => `${p.verb} ${p.detail}`).join(' and ')}`;
    }
  }

  const info = trafficInfo(event.provider, traffic);
  if (!info) return summary;
  if (info.own === 0) {
    return `${summary}. It served none of this model's requests in the last 30 min.`;
  }
  return `${summary}. It served ${info.share} of this model's requests in the last 30 min (#${info.rank} of ${info.active.length} providers).`;
}

function cheapestChange(item, sideName) {
  const events = item.events || [];
  const event = events.find(e => e.type === 'cheapest-changed');
  if (!event || suppressedCheapest(events, event)) return null;
  return event[sideName] || null;
}

function compactCheapest(item, sideName) {
  const side = item.cheapest?.[sideName];
  if (!side) return null;
  const change = cheapestChange(item, sideName);
  let value = `${listNames(side.providers, side.tags)} · ${fmtUsdPerM(side.price)}`;
  if ((side.providers || []).length > 1) value += ', tied';
  if (change) {
    value += `\nwas ${listNames(change.fromProviders, change.from, false, true)}${change.fromLeft ? ' (left)' : ''}`;
  }
  return col(sideName === 'input' ? 'Cheapest input' : 'Cheapest output', value);
}

function compactFields(item, main, usage) {
  const first = [];
  if (main.type === 'price-changed') {
    for (const [name, move, standing] of [
      ['Input /M', main.prompt, main.standing?.input],
      ['Output /M', main.completion, main.standing?.output]
    ]) {
      if (!move) continue;
      first.push(col(name, [
        `${fmtUsdPerM(move.from)} → **${fmtUsdPerM(move.to)}**`,
        standingCompact(standing)
      ]));
    }
  } else if (main.type === 'joined') {
    first.push(col('Input /M', [`**${fmtUsdPerM(main.prompt)}**`, standingCompact(main.standing?.input)]));
    first.push(col('Output /M', [`**${fmtUsdPerM(main.completion)}**`, standingCompact(main.standing?.output)]));
  }
  const use = usageField(item, usage);
  if (use) first.push(use);

  const second = [
    compactCheapest(item, 'input'),
    compactCheapest(item, 'output')
  ].filter(Boolean);

  const combined = item.cheapest?.combined;
  if (combined) {
    second.push(col('Lowest in + out', [
      `${listNames(combined.providers, combined.tags)} · ${fmtUsdPerM(combined.price)}`,
      `${fmtUsdPerM(combined.prompt)} + ${fmtUsdPerM(combined.completion)}`
    ]));
  }

  return rows(first, second);
}

function tierPart(event, state) {
  const tier = tierOf(event.tag);
  if (!tier || state.usedTier) return '';
  state.usedTier = true;
  return `[${tier} tier](${OR_DOCS.serviceTiers})`;
}

function fullPrice(event, item, state) {
  // A video model's price belongs to the model, not to one endpoint.
  const who = event.provider ? endpointName(item, event) : 'Model price';
  const arrow = event.direction === 'up' ? ' ↑' : event.direction === 'down' ? ' ↓' : '';
  const parts = [`${who}${arrow}`];
  const tier = tierPart(event, state);
  if (tier) parts.push(tier);

  let saidPerM = false;
  for (const [name, side] of [['input', event.prompt], ['output', event.completion]]) {
    if (!side) continue;
    let text;
    if (side.from === 0 && side.to > 0) {
      text = `${name} free to ${fmtUsdPerM(side.to)}${saidPerM ? '' : ' per M'}`;
    } else if (side.from > 0 && side.to === 0) {
      text = `${name} ${fmtUsdPerM(side.from)}${saidPerM ? '' : ' per M'} to free`;
    } else {
      const pct = Math.round((side.to / side.from - 1) * 100);
      text = `${name} ${fmtUsdPerM(side.from)} to ${fmtUsdPerM(side.to)}${saidPerM ? '' : ' per M'} (${pct >= 0 ? '+' : ''}${pct}%)`;
    }
    saidPerM = true;
    parts.push(text);
  }
  for (const move of event.moves || []) parts.push(fmtPriceMove(move));
  if (numeric(event.discountFrom) && numeric(event.discountTo) && event.discountFrom !== event.discountTo) {
    parts.push(`listed discount ${Math.round(event.discountFrom * 100)}% to ${Math.round(event.discountTo * 100)}%`);
  }
  const standing = standingText(event.standing, null);
  if (standing) parts.push(standing);
  return parts.join(' · ');
}

// A provider with two endpoints on the model, or a tier endpoint, is named with its id.
function cheapestName(item, provider, tag, state) {
  const needsId = (item.sharedProviders || []).includes(provider) || tierOf(tag);
  const tier = tierPart({ tag }, state);
  return `${linked(provider, tag)}${needsId ? ` (${tag})` : ''}${tier ? ` · ${tier}` : ''}`;
}

function cheapestText(item, providers, tags, price, state) {
  const oneProvider = providers.length > 1 && new Set(providers).size === 1;
  return tiedText(providers.map((provider, i) => ({
    provider: oneProvider ? linked(provider, tags[i]) : cheapestName(item, provider, tags[i], state),
    tag: tags[i]
  })), price);
}

function andList(names) {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
}

function oldNames(item, change, state, keep = () => true) {
  return change.from
    .map((tag, i) => ({ tag, provider: change.fromProviders[i] }))
    .filter(({ tag }) => keep(tag))
    .map(({ tag, provider }) => cheapestName(item, provider, tag, state));
}

function nowText(change, price) {
  if (change.fromLeft) return ' (left)';
  return change.fromNow == null ? '' : ` (now ${price(change.fromNow)})`;
}

function beforeText(item, change, price, state) {
  return `${andList(oldNames(item, change, state))}${nowText(change, price)}`;
}

// A tie made: `<new> now ties <old> at …`, or `4 providers now tie <old> at …`.
function tieMadeText(item, change, price, state) {
  const was = new Set(change.from);
  const added = change.to
    .map((tag, i) => ({ tag, provider: change.toProviders[i] }))
    .filter(({ tag }) => !was.has(tag));
  const who = added.length === 1
    ? `${cheapestName(item, added[0].provider, added[0].tag, state)} now ties`
    : `${added.length} providers now tie`;
  return `${who} ${andList(oldNames(item, change, state))} at ${price}`;
}

// A tie broken: `<name> no longer ties (now $3.96 per M)`, `tie` when several dropped out.
function tieBrokenText(item, change, price, state) {
  const now = new Set(change.to);
  const dropped = oldNames(item, change, state, tag => !now.has(tag));
  return `${andList(dropped)} no longer ${dropped.length === 1 ? 'ties' : 'tie'}${nowText(change, price)}`;
}

function fullCheapest(item, state) {
  const c = item.cheapest;
  if (!c?.input || !c?.output) return null;
  const events = item.events || [];
  const change = events.find(e => e.type === 'cheapest-changed' && !suppressedCheapest(events, e));
  const sides = change ? cheapestSides(change) : {};
  const moved = side => side && !tieChange(side) ? side : null;
  const perSide = n => `${fmtUsdPerM(n)} per M`;
  const perBoth = p => `${fmtUsdPerM(p.prompt)} in / ${fmtUsdPerM(p.completion)} out per M`;
  // The cheapest now, worded as a tie made or followed by a tie broken when the change was one.
  const now = (prefix, current, change, priceText, price) => {
    const tie = tieChange(change);
    if (tie === 'tied') return [`${prefix}${tieMadeText(item, change, priceText, state)}`];
    const line = `${prefix}${cheapestText(item, current.providers, current.tags, priceText, state)}`;
    return tie === 'untied' ? [line, `${prefix}${tieBrokenText(item, change, price, state)}`] : [line];
  };
  const lines = [];
  if (c.input.tags.join(',') === c.output.tags.join(',')) {
    lines.push(...now('', c.input, sides.both,
      perBoth({ prompt: c.input.price, completion: c.output.price }), perBoth));
  } else {
    lines.push(...now('Input: ', c.input, sides.input, perSide(c.input.price), perSide));
    if (moved(sides.input)) lines.push(`Input before: ${beforeText(item, sides.input, perSide, state)}`);
    lines.push(...now('Output: ', c.output, sides.output, perSide(c.output.price), perSide));
    if (moved(sides.output)) lines.push(`Output before: ${beforeText(item, sides.output, perSide, state)}`);
    if (c.combined) {
      lines.push(`Lowest input + output: ${cheapestText(item, c.combined.providers, c.combined.tags, perSide(c.combined.price), state)} (${fmtUsdPerM(c.combined.prompt)} + ${fmtUsdPerM(c.combined.completion)})`);
    }
  }
  if (moved(sides.both)) {
    lines.push(`Before: ${beforeText(item, sides.both, perBoth, state)}`);
  }
  return { name: 'Cheapest', value: lines.join('\n') };
}

function dynamicField(item) {
  const d = (item.dynamic || [])[0];
  if (!d) return null;
  const ranges = [];
  for (const [name, range] of [['input', d.range?.input], ['output', d.range?.output]]) {
    if (!range) continue;
    ranges.push(range.low === range.high
      ? `${name} ${fmtUsdPerM(range.low)}`
      : `${name} ${fmtUsdPerM(range.low)} to ${fmtUsdPerM(range.high)}`);
  }
  let value = `${d.provider} changed its price at ${d.checks} of the last ${d.of} checks (one check every 15 minutes).`;
  if (ranges.length) value += ` Its range on this model over the last 24 hours: ${ranges.join(', ')} per M`;
  return { name: 'Frequent repricing', value };
}

// A join's own listed prices, when the endpoint lists them (an image provider's).
function ownPrices(e) {
  return e.pricesFrom === 'endpoint' ? listedPricesText(e.prices) : '';
}

// One line per listed price when there is one list (a video model's, or one provider's); with
// several providers' lists, one line per provider, named, with its endpoint id when the
// provider has several.
function listedLines(item) {
  const { model, endpoints } = item.listedPrices;
  if (model.length === 0 && endpoints.length === 1) {
    return endpoints[0].prices.map(price => fmtListedPrice(price.key, price));
  }
  return [
    ...model.map(price => fmtListedPrice(price.key, price)),
    ...endpoints.map(endpoint =>
      `${endpointName(item, endpoint)} · ${listedPricesText(endpoint.prices)}`)
  ];
}

function fullFields(item, usage, traffic) {
  const ev = item.events || [];
  const fields = [];
  const tierState = { usedTier: false };

  const joins = ev.filter(e => e.type === 'joined' && !e.replaces);
  if (joins.length) fields.push({
    name: 'Joined',
    value: joins.map(e => {
      if (!item.perToken) return [linked(e.provider, e.tag), ownPrices(e)].filter(Boolean).join(' · ');
      if (!numeric(e.prompt) || !numeric(e.completion)) return `${endpointName(item, e)} · price not recorded`;
      const parts = [endpointName(item, e)];
      const tier = tierPart(e, tierState);
      if (tier) parts.push(tier);
      parts.push(`${fmtUsdPerM(e.prompt)} in / ${fmtUsdPerM(e.completion)} out per M`);
      const standing = standingText(e.standing, null);
      if (standing) parts.push(standing);
      return parts.join(' · ');
    }).join('\n')
  });

  const left = ev.filter(e => e.type === 'left' && !e.replacedBy);
  if (left.length) fields.push({
    name: 'Left',
    value: left.map(e => {
      let text = endpointName(item, e);
      const tier = tierPart(e, tierState);
      if (tier) text += ` · ${tier}`;
      if (e.remains) text += ` · only ${endpointName(item, e.remains)} remains`;
      return text;
    }).join('\n')
  });

  const replacements = ev.filter(e => e.type === 'joined' && e.replaces);
  if (replacements.length) fields.push({
    name: 'Endpoint changed',
    value: replacements.map(e => [
      linked(e.provider, e.tag),
      `${e.replaces} to ${e.tag}`,
      item.listedPrices
        ? ownPrices(e)
        : `${fmtUsdPerM(e.prompt)} in / ${fmtUsdPerM(e.completion)} out per M`
    ].filter(Boolean).join(' · ')).join('\n')
  });

  // A model priced other than per token lists its moves here and its whole price list below.
  const prices = ev.filter(e => e.type === 'price-changed');
  if (prices.length) fields.push({
    name: item.listedPrices ? 'Price changes' : 'Prices',
    value: prices.map(e => fullPrice(e, item, tierState)).join('\n')
  });

  if (item.listedPrices) {
    const lines = listedLines(item);
    fields.push({
      name: 'Prices',
      value: lines.length ? lines.join('\n') : `Price not listed ([see OpenRouter](${item.openrouterUrl}))`
    });
  } else if (!item.perToken) {
    fields.push({
      name: 'Prices',
      value: `Price not listed per token ([see OpenRouter](${item.openrouterUrl}))`
    });
  } else {
    const cheapest = fullCheapest(item, tierState);
    if (cheapest) fields.push(cheapest);
  }

  const ranges = ev.filter(e => e.type === 'spread-crossed');
  if (ranges.length) fields.push({
    name: 'Price range',
    value: ranges.flatMap(e => rangeSides(e).map(([name, side]) =>
      `${name[0].toUpperCase()}${name.slice(1)}: ${rangeText(side)}`
    )).join('\n')
  });

  const quant = ev.filter(e => e.type === 'quantization-changed');
  if (quant.length) fields.push({
    name: 'Quantization',
    value: quant.map(e =>
      `${linked(e.provider, e.tag)} (endpoint ${e.tag}) · now ${e.to}, was ${e.from} · [what quantization means](${OR_DOCS.quantization})`
    ).join('\n')
  });

  const model = ev.filter(e => e.type === 'model-delisted' || e.type === 'pool-empty');
  if (model.length) fields.push({
    name: 'Model',
    value: model.map(e => e.type === 'model-delisted'
      ? 'No longer in OpenRouter\'s model list'
      : 'OpenRouter lists no providers for this model now'
    ).join('\n')
  });

  const dynamic = dynamicField(item);
  if (dynamic) fields.push(dynamic);

  const repriced = [...new Set(prices.map(e => e.provider))];
  const requestLines = repriced.map(provider => {
    const info = trafficInfo(provider, traffic);
    if (!info) return null;
    if (!info.own) return `${provider} served none of ${fmtCount(info.total)} requests`;
    return `${provider} served ${info.share} of ${fmtCount(info.total)} requests (#${info.rank} of ${info.active.length} providers with traffic)`;
  }).filter(Boolean);
  if (requestLines.length) fields.push({ name: 'Requests, last 30 min', value: requestLines.join('\n') });

  const usageValue = usageField(item, usage);
  if (usageValue) fields.push({ name: usageValue.name, value: usageValue.value });

  if (costlyChange(item)) fields.push({ name: 'Cap your spend', value: PRICE_TIP });
  return fields;
}

function compactEligible(item) {
  if (!item.perToken || !item.cheapest?.input || !item.cheapest?.output) return null;
  const events = item.events || [];
  const main = events.filter(e =>
    e.type === 'price-changed' ||
    (e.type === 'joined' && !e.rejoined && !e.replaces && numeric(e.prompt) && numeric(e.completion)) ||
    (e.type === 'left' && e.confirmed && !e.returned && !e.replacedBy)
  );
  if (main.length !== 1) return null;
  if (tierOf(main[0].tag)) return null;
  if (events.some(e => !main.includes(e) && e.type !== 'cheapest-changed' && e.type !== 'spread-crossed')) return null;
  return main[0];
}

const FIELD_MAX = 1024;
const EMBED_MAX = 6000;

// A field over its limit keeps whole lines from the top and ends with how many lines it left out.
function cutLines(value, max, page) {
  if (value.length <= max) return value;
  const lines = value.split('\n');
  const tail = n => page ? `…and ${n} more: [Pool history](${page})` : `…and ${n} more on OpenRouter`;
  for (let kept = lines.length - 1; kept > 0; kept--) {
    const text = [...lines.slice(0, kept), tail(lines.length - kept)].join('\n');
    if (text.length <= max) return text;
  }
  return tail(lines.length);
}

function embedLength(embed) {
  return [embed.title, embed.description, embed.author?.name, embed.footer?.text,
    ...embed.fields.flatMap(field => [field.name, field.value])]
    .reduce((n, text) => n + (text ? text.length : 0), 0);
}

// Every field within 1,024 characters, then the longest cut further until the embed, its
// buttons' links included (withLinks), fits Discord's 6,000.
function fitFields(fields, room, page) {
  const fitted = fields.map(field => ({ ...field, value: cutLines(field.value, FIELD_MAX, page) }));
  let over = fitted.reduce((n, field) => n + field.name.length + field.value.length, 0) - room;
  while (over > 0 && fitted.length) {
    const longest = fitted.reduce((a, b, i) => b.value.length > fitted[a].value.length ? i : a, 0);
    const before = fitted[longest].value;
    const value = cutLines(fields[longest].value, before.length - over, page);
    if (value.length >= before.length) break;
    fitted[longest] = { ...fitted[longest], value };
    over -= before.length - value.length;
  }
  return fitted;
}

export function toMessage(item, {
  routeButton = false,
  usage = null,
  traffic = null,
  layout = 'auto'
} = {}) {
  const counts = kindCounts(item.events || []);
  const kinds = counts.parts.length ? counts.parts.join(' · ') : 'Pool change';
  const author = item.modelType ? `${item.modelType} · ${kinds}` : kinds;
  const main = layout === 'full' ? null : compactEligible(item);
  const compact = Boolean(main) && layout !== 'full';

  const descriptionLines = [];
  if (compact) descriptionLines.push(compactSummary(item, main, traffic));
  const between = changedBetween(item);
  if (between) descriptionLines.push(between);
  if ((item.events || []).some(e => e.type === 'left' && e.confirmed)) descriptionLines.push(HIDING);

  let fields;
  if (compact) {
    fields = compactFields(item, main, usage);
    for (const range of (item.events || []).filter(e => e.type === 'spread-crossed')) {
      const value = rangeSides(range).map(([name, side]) =>
        `${name[0].toUpperCase()}${name.slice(1)}: ${rangeText(side)}`
      ).join('\n');
      if (value) fields.push({ name: 'Price range', value });
    }
    const dynamic = dynamicField(item);
    if (dynamic) fields.push(dynamic);
    if (costlyChange(item)) fields.push({ name: 'Cap your spend', value: PRICE_TIP });
  } else {
    fields = fullFields(item, usage, traffic);
  }

  const buttons = [];
  if (routeButton && item.perToken) buttons.push({ ...ROUTE_BUTTON });
  buttons.push({
    type: 2,
    style: 5,
    label: 'View on OpenRouter',
    url: item.openrouterUrl
  });
  if (item.ownPage) buttons.push({
    type: 2,
    style: 5,
    label: 'Pool history',
    url: item.ownPage
  });
  const components = [{ type: 1, components: buttons }];

  const parts = {
    author,
    title: item.name,
    url: item.openrouterUrl,
    description: descriptionLines.join('\n'),
    footer: item.listedPrices && listedLines(item).length
      ? `${modelFooter(item.model, { prices: false })} · Prices in USD, per the unit on each line`
      : modelFooter(item.model, { prices: item.perToken }),
    timestamp: (item.sources || []).some(x => x === 'archived-model-page') ? undefined : item.at
  };
  const shell = withLinks({ embeds: [frame(parts)], components }).embeds[0];
  const embed = frame({ ...parts, fields: fitFields(fields, EMBED_MAX - embedLength(shell), item.ownPage) });

  return {
    embeds: [embed],
    components,
    allowed_mentions: { parse: [] }
  };
}

export function withLinks(message) {
  const links = (message.components || [])
    .flatMap(row => row.components || [])
    .filter(button => button.style === 5 && button.url)
    .map(button => `[${button.label}](${button.url})`);

  const embeds = (message.embeds || []).map((embed, index) => {
    if (index !== 0 || !links.length) return { ...embed };
    const text = links.join(' · ');
    return {
      ...embed,
      description: embed.description ? `${embed.description}\n${text}` : text
    };
  });

  const { components, ...rest } = message;
  return { ...rest, embeds };
}
