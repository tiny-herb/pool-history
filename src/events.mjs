import { SPREAD, PRICE_MAJOR, PRICE_EPSILON, BLEND, sideRange } from './rules.mjs';
import {
  fmtUsdPerM,
  fmtMultiple,
  fmtVsCheapest,
  nearOne,
  fmtListedPrice,
  fmtPriceMove
} from './format.mjs';
import { observed } from './snapshot.mjs';

export { fmtMultiple };

const numeric = v => typeof v === 'number' && Number.isFinite(v);

function cleanName(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function whoName(provider, tag) {
  if (!tag) return provider;
  if (cleanName(provider) === cleanName(tag)) {
    return provider;
  }
  return `${provider} (${tag})`;
}

export function cheapestNow(endpoints) {
  if (!Array.isArray(endpoints)) return null;
  const priced = endpoints.filter(e => numeric(e?.prompt) && numeric(e?.completion));
  if (priced.length < 2) return null;

  // input
  const inputSorted = [...priced].sort((a, b) => a.prompt - b.prompt || a.tag.localeCompare(b.tag));
  const minInput = inputSorted[0].prompt;
  const inputTies = inputSorted.filter(e => e.prompt === minInput);

  // output
  const outputSorted = [...priced].sort((a, b) => a.completion - b.completion || a.tag.localeCompare(b.tag));
  const minOutput = outputSorted[0].completion;
  const outputTies = outputSorted.filter(e => e.completion === minOutput);

  // combined: endpoint with lowest sum
  let minCombinedEndpoint = priced[0];
  let minCombinedSum = priced[0].prompt + priced[0].completion;
  for (let i = 1; i < priced.length; i++) {
    const sum = priced[i].prompt + priced[i].completion;
    if (sum < minCombinedSum - 1e-9) {
      minCombinedSum = sum;
      minCombinedEndpoint = priced[i];
    }
  }
  // All endpoints that tie for minimum sum
  const combinedTies = priced
    .filter(e => Math.abs((e.prompt + e.completion) - minCombinedSum) < 1e-9)
    .sort((a, b) => a.tag.localeCompare(b.tag));

  return {
    input: {
      tags: inputTies.map(e => e.tag),
      providers: inputTies.map(e => e.provider),
      price: minInput,
    },
    output: {
      tags: outputTies.map(e => e.tag),
      providers: outputTies.map(e => e.provider),
      price: minOutput,
    },
    combined: {
      tags: combinedTies.map(e => e.tag),
      providers: combinedTies.map(e => e.provider),
      prompt: minCombinedEndpoint.prompt,
      completion: minCombinedEndpoint.completion,
      price: Number((minCombinedEndpoint.prompt + minCombinedEndpoint.completion).toFixed(6)),
    },
  };
}

export function standing(e, others) {
  if (!e || !numeric(e.prompt) || !numeric(e.completion)) {
    return { poolSize: 1, input: null, output: null };
  }
  const validOthers = (others || []).filter(o => numeric(o?.prompt) && numeric(o?.completion));
  const poolSize = 1 + validOthers.length;
  if (poolSize <= 1) {
    return { poolSize: 1, input: null, output: null };
  }

  function sideStanding(key) {
    const val = e[key];
    const sorted = [...validOthers].sort((a, b) => a[key] - b[key] || a.tag.localeCompare(b.tag));
    if (sorted.length === 0) return null;
    const minOther = sorted[0][key];
    const ties = sorted.filter(o => o[key] === minOther);
    const tags = ties.map(o => o.tag);
    const providers = ties.map(o => o.provider);

    if (val <= minOther) {
      return { cheapest: true, vs: null, tags, providers };
    }
    if (minOther === 0) {
      return { cheapest: false, vs: null, tags, providers };
    }
    return { cheapest: false, vs: val / minOther, tags, providers };
  }

  return {
    poolSize,
    input: sideStanding('prompt'),
    output: sideStanding('completion'),
  };
}

function formatProvidersRef(providers, tags, nameFn) {
  if (!nameFn) return '';
  if (!providers || providers.length === 0) return '';
  // Check if multiple endpoints belong to same provider
  // Count by provider
  const counts = new Map();
  for (const p of providers) {
    counts.set(p, (counts.get(p) || 0) + 1);
  }
  const parts = [];
  const seen = new Set();
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    if (seen.has(p)) continue;
    seen.add(p);
    const count = counts.get(p);
    const named = nameFn(p, tags ? tags[i] : null);
    if (count > 1) {
      parts.push(`${count} ${named} endpoints`);
    } else {
      parts.push(named);
    }
  }
  return parts.join(', ');
}

export function standingText(s, name = (provider) => provider) {
  if (!s || s.poolSize <= 1 || (!s.input && !s.output)) return '';

  const { input, output } = s;
  if (input?.cheapest && output?.cheapest) {
    return 'cheapest on input and output';
  }

  if (input && !output) {
    const ref = formatProvidersRef(input.providers, input.tags, name);
    const refStr = ref ? ` (${ref})` : '';
    if (input.cheapest) return 'cheapest input';
    if (input.vs === null) return `the cheapest input is free${refStr}`;
    return `input ${fmtVsCheapest(input.vs)}${refStr}`;
  }

  if (output && !input) {
    const ref = formatProvidersRef(output.providers, output.tags, name);
    const refStr = ref ? ` (${ref})` : '';
    if (output.cheapest) return 'cheapest output';
    if (output.vs === null) return `the cheapest output is free${refStr}`;
    return `output ${fmtVsCheapest(output.vs)}${refStr}`;
  }

  const inRef = formatProvidersRef(input.providers, input.tags, name);
  const outRef = formatProvidersRef(output.providers, output.tags, name);

  // Both cheapest free?
  if (input.vs === null && !input.cheapest && output.vs === null && !output.cheapest) {
    if (inRef === outRef) {
      return inRef ? `the cheapest (${inRef}) is free` : 'the cheapest is free';
    }
    return inRef || outRef
      ? `the cheapest input (${inRef}) is free, the cheapest output (${outRef}) is free`
      : 'the cheapest input is free, the cheapest output is free';
  }

  // One cheapest is free
  if (input.vs === null && !input.cheapest) {
    const outClause = output.cheapest ? 'cheapest output' : `output ${fmtVsCheapest(output.vs, 'the cheapest')}${outRef ? ` (${outRef})` : ''}`;
    return `the cheapest input is free, ${outClause}`;
  }
  if (output.vs === null && !output.cheapest) {
    const inClause = input.cheapest ? 'cheapest input' : `input ${fmtVsCheapest(input.vs, 'the cheapest')}${inRef ? ` (${inRef})` : ''}`;
    return `${inClause}, the cheapest output is free`;
  }

  if (input.cheapest) {
    const outRefStr = outRef ? ` (${outRef})` : '';
    return `cheapest input; output ${fmtVsCheapest(output.vs, 'the cheapest')}${outRefStr}`;
  }
  if (output.cheapest) {
    const inRefStr = inRef ? ` (${inRef})` : '';
    return `cheapest output; input ${fmtVsCheapest(input.vs, 'the cheapest')}${inRefStr}`;
  }

  // Neither cheapest
  const sameRef = inRef === outRef;
  const inMultiple = fmtMultiple(input.vs);
  const outMultiple = fmtMultiple(output.vs);
  const sameMultiple = inMultiple === outMultiple && !nearOne(input.vs) && !nearOne(output.vs);

  if (sameRef && sameMultiple) {
    const refStr = inRef ? ` (${inRef})` : '';
    return `input and output ${fmtVsCheapest(input.vs, 'the cheapest')}${refStr}`;
  }

  if (sameRef) {
    const refStr = inRef ? ` (${inRef})` : '';
    // A side within 5% of the cheapest reads as a percent, so each side names its own
    // reference; fmtMultiple already ends in `x`.
    if (nearOne(input.vs) || nearOne(output.vs)) {
      const inClause = fmtVsCheapest(input.vs, 'the cheapest');
      const outClause = fmtVsCheapest(output.vs, 'the cheapest');
      return `input ${inClause}${refStr}, output ${outClause}${refStr}`;
    }
    return `input ${inMultiple}, output ${outMultiple} the cheapest${refStr}`;
  }

  // Different references
  const inClause = nearOne(input.vs)
    ? fmtVsCheapest(input.vs, 'the cheapest') + (inRef ? ` (${inRef})` : '')
    : `${inMultiple} the cheapest` + (inRef ? ` (${inRef})` : '');
  const outClause = nearOne(output.vs)
    ? fmtVsCheapest(output.vs, 'the cheapest') + (outRef ? ` (${outRef})` : '')
    : `${outMultiple} the cheapest` + (outRef ? ` (${outRef})` : '');

  return `input ${inClause}, output ${outClause}`;
}

export function tiedText(items, price = null) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const priceSuffix = price ? ` at ${price}` : '';
  // `label` is the caller's display name (a Discord link, say); `bare` asks for the provider alone.
  const nameOf = (it) => (it.bare ? it.provider : it.label) || it.provider || it.tag;

  if (items.length === 1) {
    const name = nameOf(items[0]);
    return price ? `${name} at ${price}` : name;
  }

  // Check if all endpoints belong to the same provider
  const providers = items.map(it => it.provider);
  const distinctProviders = [...new Set(providers)];

  if (distinctProviders.length === 1 && items.length > 1) {
    const p = nameOf(items[0]);
    const tags = items.map(it => it.tag).join(', ');
    return `${p}, ${items.length} endpoints (${tags}),${priceSuffix}`;
  }

  if (items.length === 2) {
    return `${nameOf(items[0])} and ${nameOf(items[1])}, tied,${priceSuffix}`;
  }

  // 3 or more
  const names = items.map(nameOf).join(', ');
  if (price) {
    return `${items.length} tied at ${price}: ${names}`;
  }
  return `${items.length} tied: ${names}`;
}

export function cheapestSides(e) {
  if (!e || e.type !== 'cheapest-changed') return { input: null, output: null };
  const { input, output } = e;
  if (input && output && input.from.join(',') === output.from.join(',') && input.to.join(',') === output.to.join(',')) {
    return {
      both: {
        ...input,
        toPrice: { prompt: input.toPrice, completion: output.toPrice },
        fromNow: input.fromNow !== null && output.fromNow !== null ? { prompt: input.fromNow, completion: output.fromNow } : null,
      }
    };
  }
  return { input, output };
}

export function tieChange(c) {
  if (!c || !c.from || !c.to) return null;
  const fromSet = new Set(c.from);
  const toSet = new Set(c.to);

  const oldInNew = c.from.every(t => toSet.has(t));
  const newInOld = c.to.every(t => fromSet.has(t));

  if (oldInNew && toSet.size > fromSet.size) return 'tied';
  if (newInOld && fromSet.size > toSet.size) return 'untied';
  return null;
}

export function cheapestKinds(e) {
  const kinds = new Set();
  if (!e || e.type !== 'cheapest-changed') return kinds;
  for (const side of [e.input, e.output]) {
    if (!side) continue;
    const tc = tieChange(side);
    if (tc === 'tied') kinds.add('tied');
    else if (tc === 'untied') kinds.add('untied');
    else if (kinds.size === 0) kinds.add('new');
  }
  if (kinds.has('tied') || kinds.has('untied')) {
    kinds.delete('new');
  }
  return kinds;
}

export function cheapestMove(c, { name = (p) => p, sep = '; ', newPrice = fmtUsdPerM, oldPrice = fmtUsdPerM } = {}) {
  if (!c) return '';
  const tc = tieChange(c);
  const toItems = c.to.map((tag, i) => ({ tag, provider: name(c.toProviders[i], tag) }));

  if (tc === 'tied') {
    // tie made: added now ties old
    const fromSet = new Set(c.from);
    const added = c.to.filter(t => !fromSet.has(t)).map(t => {
      const idx = c.to.indexOf(t);
      return name(c.toProviders[idx], t);
    });
    const old = c.from.map((t, idx) => name(c.fromProviders[idx], t));
    const verb = added.length > 1 ? 'now tie' : 'now ties';
    return `${added.join(', ')} ${verb} ${old.join(', ')}`;
  }

  if (tc === 'untied') {
    // tie broken: new alone (dropped no longer ties/tie)
    const toSet = new Set(c.to);
    const dropped = c.from.filter(t => !toSet.has(t)).map(t => {
      const idx = c.from.indexOf(t);
      return name(c.fromProviders[idx], t);
    });
    const verb = dropped.length > 1 ? 'no longer tie' : 'no longer ties';
    const newName = toItems.map(it => it.provider).join(', ');
    return `${newName} alone (${dropped.join(', ')} ${verb})`;
  }

  // otherwise: now <new, as tied text> at <price> per M · was <old>, now <old price now> or (left)
  const isDual = typeof c.toPrice === 'object' && c.toPrice !== null;
  let priceStr = '';
  if (isDual) {
    priceStr = `${newPrice(c.toPrice.prompt)} in / ${newPrice(c.toPrice.completion)} out per M`;
  } else {
    priceStr = `${newPrice(c.toPrice)} per M`;
  }
  const newPart = tiedText(toItems, priceStr);

  const oldNames = c.from.map((t, idx) => name(c.fromProviders[idx], t)).join(', ');
  let wasPart = `was ${oldNames}`;
  if (c.fromLeft) {
    wasPart += ' (left)';
  } else if (c.fromNow !== null && c.fromNow !== undefined) {
    if (isDual && typeof c.fromNow === 'object') {
      wasPart += `, now ${oldPrice(c.fromNow.prompt)} in / ${oldPrice(c.fromNow.completion)} out`;
    } else {
      wasPart += `, now ${oldPrice(c.fromNow)}`;
    }
  }

  return `now ${newPart} · ${wasPart}`;
}

// The listed prices of one endpoint or model ({ key: price }) as a list, in listing order,
// without the zeros that stand for a price the list does not give (`unlisted`).
export function listedPrices(prices) {
  return Object.entries(prices || {})
    .filter(([, price]) => !price?.unlisted)
    .map(([key, price]) => ({ key, ...price }));
}

function listedNumber(price) {
  const value = price?.unit === null ? price.value : price?.usd;
  return numeric(value) ? value : null;
}

// Moves between two listings of prices other than per token, one per key listed in both with
// the same unit. A key in only one listing is not a move: a listing taken before such prices
// were recorded, or whose call failed, has none. A side whose 0 stands for a price the list does
// not give (`unlisted`) is null: the price became listed, or is no longer listed.
export function priceMoves(before, after) {
  if (!before || !after) return [];
  const moves = [];
  for (const [key, price] of Object.entries(after)) {
    const old = before[key];
    if (!old || old.unit !== price.unit) continue;
    if (listedNumber(old) === null || listedNumber(price) === null) continue;
    const from = old.unlisted ? null : listedNumber(old);
    const to = price.unlisted ? null : listedNumber(price);
    if (from === to) continue;
    let change;
    if (from === null || to === null) {
      change = null;
    } else if (from > 0 && to > 0) {
      if (Math.abs(to / from - 1) <= PRICE_EPSILON) continue;
      change = to / from - 1;
    } else if (from === 0) {
      change = null;
    } else {
      change = -1;
    }
    moves.push({
      key,
      unit: price.unit,
      ...(price.detail ? { detail: price.detail } : {}),
      from,
      to,
      change
    });
  }
  return moves;
}

export function movesMajor(moves) {
  return (moves || []).some(move => move.change === null || move.change === -1 ||
    Math.abs(move.change) >= PRICE_MAJOR - 1e-9);
}

export function priceDirection(e) {
  if (!e) return 'mixed';
  const prompt = e.prompt;
  const completion = e.completion;
  let up = false;
  let down = false;

  function checkSide(side) {
    if (!side) return;
    if (side.from === 0 && side.to > 0) {
      up = true;
    } else if (side.from > 0 && side.to === 0) {
      down = true;
    } else if (numeric(side.change)) {
      if (side.change > 0) up = true;
      else if (side.change < 0) down = true;
    }
  }

  checkSide(prompt);
  checkSide(completion);
  for (const move of e.moves || []) checkSide(move);

  if (up && !down) return 'up';
  if (down && !up) return 'down';
  return 'mixed';
}

export function sideRose(e, fraction) {
  if (!e || e.type !== 'price-changed') return false;
  for (const side of [e.prompt, e.completion, ...(e.moves || [])]) {
    if (!side) continue;
    if (side.from === 0 && side.to > 0) return true;
    if (numeric(side.change) && side.change >= fraction - 1e-9) return true;
  }
  return false;
}

export function rangeSides(e) {
  if (!e || e.type !== 'spread-crossed') return [];
  const res = [];
  if (e.input) res.push(['input', e.input]);
  if (e.output) res.push(['output', e.output]);
  return res;
}

export function rangeVerb(e) {
  if (!e || e.type !== 'spread-crossed') return 'changed';
  const sides = rangeSides(e);
  if (sides.length === 0) return 'changed';
  const allUp = sides.every(([, s]) => s.up);
  if (allUp) return 'widened';
  const allDown = sides.every(([, s]) => !s.up);
  if (allDown) return 'narrowed';
  return 'changed';
}

export function rangeText(s, { unit = true } = {}) {
  if (!s) return '';
  if (s.up) {
    const rangeMultiple = fmtMultiple(s.to);
    const causeStr = s.cause === 'cheapest-fell' ? ', as the cheapest fell' : '';
    const unitStr = unit ? ' per M' : '';
    return `${fmtUsdPerM(s.low)} to ${fmtUsdPerM(s.high)}${unitStr} (${rangeMultiple}, above ${SPREAD}x${causeStr})`;
  }
  const rangeMultiple = fmtMultiple(s.to);
  return `back under ${SPREAD}x (${rangeMultiple})`;
}

export function saidByJoin(e, events) {
  if (!e || e.type !== 'left' || !e.replacedBy || !Array.isArray(events)) return false;
  return events.some(other => other.type === 'joined' && other.replaces === e.tag);
}

export function shownEvents(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(e => {
    if (e.type === 'joined' && e.rejoined) return false;
    if (e.type === 'left' && saidByJoin(e, list)) return false;
    return true;
  });
}

export function priceParts(e) {
  if (!e || e.type !== 'price-changed') return [];
  const parts = [];
  let perMSaid = false;

  function fmtSide(name, move) {
    if (!move) return null;
    if (move.from === 0 && move.to > 0) {
      if (!perMSaid) {
        perMSaid = true;
        return `${name} free to ${fmtUsdPerM(move.to)} per M`;
      }
      return `${name} free to ${fmtUsdPerM(move.to)}`;
    }
    if (move.from > 0 && move.to === 0) {
      if (!perMSaid) {
        perMSaid = true;
        return `${name} ${fmtUsdPerM(move.from)} per M to free`;
      }
      return `${name} ${fmtUsdPerM(move.from)} to free`;
    }
    const pct = Math.round(move.change * 100);
    const sign = pct >= 0 ? '+' : '';
    if (!perMSaid) {
      perMSaid = true;
      return `${name} ${fmtUsdPerM(move.from)} to ${fmtUsdPerM(move.to)} per M (${sign}${pct}%)`;
    }
    return `${name} ${fmtUsdPerM(move.from)} to ${fmtUsdPerM(move.to)} (${sign}${pct}%)`;
  }

  const pStr = fmtSide('input', e.prompt);
  if (pStr) parts.push(pStr);
  const cStr = fmtSide('output', e.completion);
  if (cStr) parts.push(cStr);
  for (const move of e.moves || []) parts.push(fmtPriceMove(move));

  if (numeric(e.discountFrom) && numeric(e.discountTo) && e.discountFrom !== e.discountTo) {
    parts.push(`listed discount ${Math.round(e.discountFrom * 100)}% to ${Math.round(e.discountTo * 100)}%`);
  }

  const st = standingText(e.standing);
  if (st) parts.push(st);

  return parts;
}

export function listedPricesText(prices) {
  return (prices || []).map(price => fmtListedPrice(price.key, price)).join(', ');
}

// A join on a model priced other than per token: `prices` is the endpoint's own listing, or the
// model's when `pricesFrom` is 'model'; empty when OpenRouter lists none.
function listedJoinSentence(e) {
  const listed = listedPricesText(e.prices);
  const own = Boolean(listed) && e.pricesFrom !== 'model';
  const price = !listed
    ? '; price not listed (see OpenRouter)'
    : own ? ` at ${listed}` : `; the model is listed at ${listed}`;
  if (e.replaces) {
    return `${e.provider} endpoint changed: ${e.replaces} to ${e.tag}${own ? ',' : ''}${price}`;
  }
  return `${whoName(e.provider, e.tag)} joined${price}`;
}

export function eventSentence(e) {
  if (!e) return '';
  switch (e.type) {
    case 'model-listed':
      return `Listed with ${e.endpoints} endpoint${e.endpoints === 1 ? '' : 's'}`;
    case 'model-delisted':
      return 'No longer in OpenRouter\'s model list';
    case 'pool-empty':
      return 'OpenRouter lists no providers for this model now';
    case 'joined': {
      if (Array.isArray(e.prices)) return listedJoinSentence(e);
      if (e.replaces) {
        if (e.priceNotPerToken) {
          return `${e.provider} endpoint changed: ${e.replaces} to ${e.tag}; price not listed per token (see OpenRouter)`;
        }
        if (!numeric(e.prompt) || !numeric(e.completion)) {
          return `${e.provider} endpoint changed: ${e.replaces} to ${e.tag} (price not recorded)`;
        }
        return `${e.provider} endpoint changed: ${e.replaces} to ${e.tag}, at ${fmtUsdPerM(e.prompt)} / ${fmtUsdPerM(e.completion)} per M`;
      }
      const who = whoName(e.provider, e.tag);
      if (e.priceNotPerToken) {
        return `${who} joined; price not listed per token (see OpenRouter)`;
      }
      if (!numeric(e.prompt) || !numeric(e.completion)) {
        return `${who} joined (price not recorded)`;
      }
      const st = standingText(e.standing);
      const stStr = st ? `, ${st}` : '';
      return `${who} joined at ${fmtUsdPerM(e.prompt)} / ${fmtUsdPerM(e.completion)} per M${stStr}`;
    }
    case 'left': {
      if (e.replacedBy) {
        return `${e.provider} endpoint ${e.tag} replaced by ${e.replacedBy}`;
      }
      const who = whoName(e.provider, e.tag);
      if (e.returned) {
        return `${who} was briefly unlisted and came back`;
      }
      if (e.confirmed === false) {
        return `${who} missing at the last check; may come back`;
      }
      const base = e.providerStays ? `${who} endpoint removed` : `${who} left`;
      if (e.remains) {
        const remainsWho = whoName(e.remains.provider, e.remains.tag);
        return `${base}; only ${remainsWho} remains`;
      }
      return base;
    }
    case 'price-changed': {
      // A model-level price (a video model's) belongs to no one endpoint.
      const who = e.provider ? whoName(e.provider, e.tag) : 'Model price';
      const parts = priceParts(e);
      return [who, ...parts].join(' · ');
    }
    case 'quantization-changed': {
      const who = whoName(e.provider, e.tag);
      return `${who} quantization ${e.from} to ${e.to}`;
    }
    case 'cheapest-changed': {
      // Determine if both moved identically
      const sides = cheapestSides(e);
      // Check naming rule:
      // "Collect every endpoint id on both sides of the change, and every provider name.
      //  When there are fewer distinct names than distinct ids, every name in that change is the endpoint id.
      //  Otherwise every name is the provider name."
      const allTags = new Set();
      const allProviders = [];
      for (const side of [e.input, e.output]) {
        if (!side) continue;
        for (const t of side.from) allTags.add(t);
        for (const t of side.to) allTags.add(t);
        for (const p of side.fromProviders) allProviders.push(p);
        for (const p of side.toProviders) allProviders.push(p);
      }
      const providerTags = new Map();
      for (const side of [e.input, e.output]) {
        if (!side) continue;
        for (const [index, tag] of side.from.entries()) {
          const provider = side.fromProviders[index];
          if (!providerTags.has(provider)) providerTags.set(provider, new Set());
          providerTags.get(provider).add(tag);
        }
        for (const [index, tag] of side.to.entries()) {
          const provider = side.toProviders[index];
          if (!providerTags.has(provider)) providerTags.set(provider, new Set());
          providerTags.get(provider).add(tag);
        }
      }
      const useEndpointIds = [...providerTags.values()]
        .some(tags => tags.size > 1);
      const currentTags = new Set(
        [e.input, e.output]
          .filter(Boolean)
          .flatMap(side => side.to)
      );
      const currentProviders = new Set(
        [e.input, e.output]
          .filter(Boolean)
          .flatMap(side => side.toProviders)
      );
      const nameFn = (p, tag) => {
        if (!useEndpointIds) return p;
        if (currentTags.has(tag) && currentProviders.size > 1) {
          return providerTags.get(p)?.size > 1 ? `${p} (${tag})` : p;
        }
        return tag;
      };

      if (sides.both) {
        const move = cheapestMove(sides.both, { name: nameFn });
        return `Cheapest endpoint: ${move}`;
      }
      const clauses = [];
      if (e.input) {
        clauses.push(`Cheapest input: ${cheapestMove(e.input, { name: nameFn })}`);
      }
      if (e.output) {
        clauses.push(`Cheapest output: ${cheapestMove(e.output, { name: nameFn })}`);
      }
      return clauses.join('. ');
    }
    case 'spread-crossed': {
      const verb = rangeVerb(e);
      const sides = rangeSides(e);
      let perMSaid = false;
      const parts = [`Price range ${verb}`];
      for (const [sideName, s] of sides) {
        let text = '';
        if (s.up) {
          if (!perMSaid) {
            perMSaid = true;
            text = rangeText(s, { unit: true });
          } else {
            text = rangeText(s, { unit: false });
          }
        } else {
          text = rangeText(s, { unit: false });
        }
        parts.push(`${sideName} ${text}`);
      }
      return parts.join(' · ');
    }
    default:
      return '';
  }
}

function blendedValue(prompt, completion) {
  if (!numeric(prompt) || !numeric(completion)) return null;
  return prompt * BLEND.prompt + completion * BLEND.completion;
}

export function diffModel(prev, next) {
  const previous = Array.isArray(prev) ? prev : [];
  const current = Array.isArray(next) ? next : [];

  if (previous.length === 0 && current.length === 0) return [];
  if (previous.length === 0 && current.length > 0) {
    return [{ type: 'model-listed', endpoints: current.length }];
  }
  if (previous.length > 0 && current.length === 0) {
    return [{ type: 'pool-empty' }];
  }

  const prevMap = new Map();
  for (const e of previous) {
    prevMap.set(e.tag, e);
  }
  const nextMap = new Map();
  for (const e of current) {
    nextMap.set(e.tag, e);
  }

  const events = [];

  // 1. Departures (all left, in previous pool's order)
  const leftEndpoints = previous.filter(e => !nextMap.has(e.tag));
  for (const e of leftEndpoints) {
    const providerStays = current.some(o => o.provider === e.provider);
    const leftEvent = {
      type: 'left',
      tag: e.tag,
      provider: e.provider,
    };
    if (providerStays) {
      leftEvent.providerStays = true;
    }
    if (current.length === 1) {
      leftEvent.remains = { tag: current[0].tag, provider: current[0].provider };
    }
    events.push(leftEvent);
  }

  // 2. Joins (all joined, in new pool's order)
  const joinedEndpoints = current.filter(e => !prevMap.has(e.tag));
  const incumbents = current.filter(e => prevMap.has(e.tag));

  // Find cheapest incumbent by blend (first in pool order among ties)
  let cheapestIncumbent = null;
  let minBlend = Infinity;
  for (const inc of incumbents) {
    const b = blendedValue(inc.prompt, inc.completion);
    if (b !== null && b < minBlend) {
      minBlend = b;
      cheapestIncumbent = inc;
    }
  }

  for (const e of joinedEndpoints) {
    const prompt = numeric(e.prompt) ? e.prompt : null;
    const completion = numeric(e.completion) ? e.completion : null;
    const newcomerBlend = blendedValue(prompt, completion);

    let ratio = null;
    let expensive = false;
    let cheapestProvider = null;
    let cheapestTag = null;

    if (newcomerBlend !== null && cheapestIncumbent !== null && minBlend > 0) {
      ratio = newcomerBlend / minBlend;
      expensive = ratio >= SPREAD;
      cheapestProvider = cheapestIncumbent.provider;
      cheapestTag = cheapestIncumbent.tag;
    }

    const st = standing(e, incumbents);

    events.push({
      type: 'joined',
      tag: e.tag,
      provider: e.provider,
      prompt,
      completion,
      ratio,
      expensive,
      cheapestProvider,
      cheapestTag,
      standing: st,
    });
  }

  // 3. For each remaining endpoint (in current order): price-changed then quantization-changed
  for (const e of current) {
    const old = prevMap.get(e.tag);
    if (!old) continue;

    // Check price changes
    function checkSide(key) {
      const from = old[key];
      const to = e[key];
      if (!numeric(from) || !numeric(to) || from === to) return null;
      if (from > 0 && to > 0) {
        const rel = Math.abs(to / from - 1);
        if (rel <= PRICE_EPSILON) return null;
        return { from, to, change: to / from - 1 };
      }
      if (from === 0 && to > 0) {
        return { from, to, change: null };
      }
      if (from > 0 && to === 0) {
        return { from, to, change: -1 };
      }
      return null;
    }

    const promptMove = checkSide('prompt');
    const completionMove = checkSide('completion');
    const moves = priceMoves(old.prices, e.prices);

    if (promptMove || completionMove || moves.length > 0) {
      const oldBlend = blendedValue(old.prompt, old.completion);
      const newBlend = blendedValue(e.prompt, e.completion);
      let change = null;
      if (oldBlend !== null && newBlend !== null && oldBlend > 0) {
        change = newBlend / oldBlend - 1;
      }

      const dir = priceDirection({ prompt: promptMove, completion: completionMove, moves });
      const isUp = dir === 'up';

      // major: side moved 25% or more, or went between free and paid
      let major = movesMajor(moves);
      for (const side of [promptMove, completionMove]) {
        if (!side) continue;
        if (side.change === null || side.change === -1) {
          major = true;
        } else if (Math.abs(side.change) >= PRICE_MAJOR - 1e-9) {
          major = true;
        }
      }

      const othersInPool = current.filter(o => o.tag !== e.tag);
      const st = standing(e, othersInPool);

      const priceEvent = {
        type: 'price-changed',
        tag: e.tag,
        provider: e.provider,
        prompt: promptMove,
        completion: completionMove,
        change,
        direction: dir,
        up: isUp,
        major,
        standing: st,
      };
      if (moves.length > 0) priceEvent.moves = moves;

      const oldDiscount = numeric(old.discount) ? old.discount : 0;
      const newDiscount = numeric(e.discount) ? e.discount : 0;
      if (oldDiscount !== newDiscount) {
        priceEvent.discountFrom = oldDiscount;
        priceEvent.discountTo = newDiscount;
      }

      events.push(priceEvent);
    }

    // Check quantization-changed
    if (old.quantization && e.quantization && old.quantization !== e.quantization) {
      events.push({
        type: 'quantization-changed',
        tag: e.tag,
        provider: e.provider,
        from: old.quantization,
        to: e.quantization,
      });
    }
  }

  // 4. One cheapest-changed event
  function sideCheapestDiff(key) {
    const prevPriced = previous.filter(o => numeric(o[key]));
    const nextPriced = current.filter(o => numeric(o[key]));
    if (nextPriced.length < 2 || prevPriced.length === 0) return null;

    const minPrev = Math.min(...prevPriced.map(o => o[key]));
    const fromEndpoints = prevPriced
      .filter(o => o[key] === minPrev)
      .sort((a, b) => a.tag.localeCompare(b.tag));
    const fromTags = fromEndpoints.map(o => o.tag);

    const minNext = Math.min(...nextPriced.map(o => o[key]));
    const toEndpoints = nextPriced
      .filter(o => o[key] === minNext)
      .sort((a, b) => a.tag.localeCompare(b.tag));
    const toTags = toEndpoints.map(o => o.tag);

    if (fromTags.join(',') === toTags.join(',')) return null;

    // We have a cheapest change on this side
    const fromProviders = fromEndpoints.map(o => o.provider);
    const toProviders = toEndpoints.map(o => o.provider);
    const toPrice = minNext;

    // fromNow: check the old cheapest in the new pool
    // If multiple old cheapest endpoints, check if any remained
    let fromNow = null;
    let fromLeft = false;

    // Single old endpoint:
    if (fromEndpoints.length === 1) {
      const oldTag = fromEndpoints[0].tag;
      const inNext = nextMap.get(oldTag);
      if (inNext && numeric(inNext[key])) {
        fromNow = inNext[key];
        fromLeft = false;
      } else {
        fromNow = null;
        fromLeft = true;
      }
    } else {
      // Multiple old endpoints
      const fromPrices = fromEndpoints.map(o => {
        const inNext = nextMap.get(o.tag);
        return inNext && numeric(inNext[key]) ? inNext[key] : null;
      });
      const allLeft = fromPrices.every(p => p === null);
      fromLeft = allLeft;
      fromNow = fromPrices.find(p => p !== null) ?? null;
    }

    const sideObj = {
      from: fromTags,
      to: toTags,
      fromProviders,
      toProviders,
      toPrice,
      fromNow,
      fromLeft,
    };

    if (fromEndpoints.length > 1) {
      sideObj.fromPrices = fromEndpoints.map(o => {
        const inNext = nextMap.get(o.tag);
        return inNext && numeric(inNext[key]) ? inNext[key] : null;
      });
    }

    return sideObj;
  }

  const inputCheapest = sideCheapestDiff('prompt');
  const outputCheapest = sideCheapestDiff('completion');
  if (inputCheapest || outputCheapest) {
    events.push({
      type: 'cheapest-changed',
      input: inputCheapest,
      output: outputCheapest,
    });
  }

  // 5. One spread-crossed event
  function sideSpreadDiff(key) {
    const prevRange = sideRange(previous, key);
    const nextRange = sideRange(current, key);

    if (prevRange.range === null || nextRange.range === null) return null;
    const prevAbove = prevRange.range >= SPREAD;
    const nextAbove = nextRange.range >= SPREAD;

    if (prevAbove === nextAbove) return null;

    const up = nextAbove;
    let cause = 'pool-changed';
    if (up) {
      if (nextRange.high > prevRange.high) {
        cause = 'priciest-rose';
      } else if (nextRange.low < prevRange.low) {
        cause = 'cheapest-fell';
      }
    } else {
      cause = 'pool-changed';
    }

    return {
      from: prevRange.range,
      to: nextRange.range,
      low: nextRange.low,
      high: nextRange.high,
      up,
      cause,
    };
  }

  const inputSpread = sideSpreadDiff('prompt');
  const outputSpread = sideSpreadDiff('completion');

  if (inputSpread || outputSpread) {
    const up = Boolean((inputSpread && inputSpread.up) || (outputSpread && outputSpread.up));
    let cause = 'pool-changed';
    const upSides = [inputSpread, outputSpread].filter(s => s && s.up);
    if (upSides.length > 0) {
      const rose = upSides.find(s => s.cause === 'priciest-rose');
      cause = rose ? 'priciest-rose' : upSides[0].cause;
    } else {
      cause = (inputSpread || outputSpread).cause;
    }

    events.push({
      type: 'spread-crossed',
      input: inputSpread,
      output: outputSpread,
      up,
      cause,
    });
  }

  return events;
}

export function diffSnapshots(a, b) {
  const at = b?.takenAt || '';
  const since = a?.takenAt || '';
  const sources = [a?.source || '', b?.source || ''];

  const allEvents = [];
  const aModels = a?.models || {};
  const bModels = b?.models || {};

  const modelIds = [...new Set([...Object.keys(aModels), ...Object.keys(bModels)])].sort();

  for (const modelId of modelIds) {
    const entryA = aModels[modelId];
    const entryB = bModels[modelId];

    if (!observed(entryA) || !observed(entryB)) {
      continue;
    }

    const modelEvents = diffModel(entryA.endpoints, entryB.endpoints);
    for (const ev of modelEvents) {
      ev.model = modelId;
      ev.at = at;
      ev.since = since;
      ev.sources = sources;
      allEvents.push(ev);
    }
  }

  return allEvents;
}
