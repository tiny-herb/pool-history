export const SPREAD = 3;
export const PRICE_MAJOR = 0.25;
export const PRICE_EPSILON = 0.005;

export const BLEND = Object.freeze({ prompt: 3, completion: 1 });

const recorded = value =>
  typeof value === 'number' && Number.isFinite(value);

export function blended(endpoint) {
  if (!endpoint || !recorded(endpoint.prompt) || !recorded(endpoint.completion)) {
    return null;
  }

  return (
    (endpoint.prompt * BLEND.prompt + endpoint.completion * BLEND.completion) /
    (BLEND.prompt + BLEND.completion)
  );
}

export function priced(endpoints) {
  return endpoints.filter(endpoint => blended(endpoint) !== null);
}

export function cheapest(endpoints) {
  let result = [];
  let lowest = Infinity;

  for (const endpoint of endpoints) {
    const price = blended(endpoint);
    if (price === null) continue;

    if (price < lowest) {
      lowest = price;
      result = [endpoint];
    } else if (price === lowest) {
      result.push(endpoint);
    }
  }

  return result;
}

export function priciest(endpoints) {
  let result = null;
  let highest = -Infinity;

  for (const endpoint of endpoints) {
    const price = blended(endpoint);
    if (price === null) continue;

    if (price > highest) {
      highest = price;
      result = endpoint;
    }
  }

  return result;
}

export function ratio(a, b) {
  if (b === 0) return a === 0 ? 1 : Infinity;
  return Number((a / b).toPrecision(15));
}

export function spreadOf(endpoints) {
  const values = endpoints
    .map(blended)
    .filter(value => value !== null);

  if (values.length === 0) {
    return { spread: null, mixedFree: false };
  }

  const low = Math.min(...values);
  const high = Math.max(...values);
  const mixedFree = low === 0 && high > 0;

  return {
    spread: mixedFree ? null : ratio(high, low),
    mixedFree,
  };
}

export function sideRange(endpoints, key) {
  const values = endpoints
    .map(endpoint => endpoint?.[key])
    .filter(recorded);

  if (values.length === 0) {
    return {
      low: null,
      high: null,
      range: null,
      mixedFree: false,
    };
  }

  const low = Math.min(...values);
  const high = Math.max(...values);
  const mixedFree = low === 0 && high > 0;

  return {
    low,
    high,
    range: mixedFree ? null : ratio(high, low),
    mixedFree,
  };
}

export function priceRanges(endpoints) {
  return {
    input: sideRange(endpoints, 'prompt'),
    output: sideRange(endpoints, 'completion'),
  };
}

export function providerTag(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// A provider is dynamic at a time when, over the window up to it, it changed a
// price at DYNAMIC_MIN_CHECKS or more checks and at DYNAMIC_SHARE or more of
// them. A check is a time at which any event from the API was recorded.
export const DYNAMIC_MIN_CHECKS = 8;
export const DYNAMIC_SHARE = 0.5;
export const DYNAMIC_WINDOW_MS = 86_400_000;

// First index whose value is >= x (or > x when `after`), in an ascending list.
function bound(sorted, x, after = false) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x || (after && sorted[mid] === x)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const countIn = (sorted, low, high) => bound(sorted, high, true) - bound(sorted, low);

// The check times of a list of events, and each provider's price-change times, in ms ascending.
export function repricingIndex(events) {
  const checks = new Map();
  const moves = new Map();
  for (const e of events || []) {
    const t = new Date(e.at).getTime();
    if (!Number.isFinite(t) || e.sources?.[1] === 'archived-model-page') continue;
    checks.set(e.at, t);
    if (e.type !== 'price-changed' || !e.provider) continue;
    if (!moves.has(e.provider)) moves.set(e.provider, new Map());
    moves.get(e.provider).set(e.at, t);
  }
  const ascending = times => [...times.values()].sort((a, b) => a - b);
  return {
    checks: ascending(checks),
    moves: new Map([...moves].map(([provider, times]) => [provider, ascending(times)])),
  };
}

function windowRange(series, provider, start, end) {
  const input = { low: Infinity, high: -Infinity };
  const output = { low: Infinity, high: -Infinity };
  const widen = (side, value) => {
    if (!recorded(value)) return;
    side.low = Math.min(side.low, value);
    side.high = Math.max(side.high, value);
  };
  for (const point of series || []) {
    const t = new Date(point.takenAt).getTime();
    if (!Number.isFinite(t) || t < start || t > end || !point.prices) continue;
    for (const record of Object.values(point.prices)) {
      if (record?.provider !== provider) continue;
      widen(input, record.prompt);
      widen(output, record.completion);
    }
  }
  const side = s => (Number.isFinite(s.low) ? { low: s.low, high: s.high } : null);
  return { input: side(input), output: side(output) };
}

// The providers among `providers` that are dynamic at `at`, each with its count of
// changing checks, the checks in the window and its price range on `series` there.
export function dynamicProviders(index, at, providers, series = []) {
  if (!providers || providers.length === 0) return [];
  const end = new Date(at).getTime();
  if (!Number.isFinite(end)) return [];
  const start = end - DYNAMIC_WINDOW_MS;
  const of = countIn(index.checks, start, end);
  const result = [];
  for (const provider of providers) {
    const checks = countIn(index.moves.get(provider) || [], start, end);
    if (checks < DYNAMIC_MIN_CHECKS || of === 0 || checks / of < DYNAMIC_SHARE) continue;
    result.push({ provider, checks, of, range: windowRange(series, provider, start, end) });
  }
  return result;
}

const crossSides = e => [['prompt', e.input], ['completion', e.output]].filter(([, side]) => side);

// The move's new price became the low (the cheapest fell) or the high (the
// priciest rose) of a price range that went past SPREAD.
export function pushedRange(move, range) {
  return crossSides(range).some(([key, side]) => {
    if (!side.up) return false;
    const edge = side.cause === 'cheapest-fell' ? side.low : side.cause === 'priciest-rose' ? side.high : null;
    return edge !== null && move[key]?.to === edge;
  });
}

const namesProvider = (cheapestChange, provider) =>
  crossSides(cheapestChange).some(([, side]) =>
    [...(side.toProviders || []), ...(side.fromProviders || [])].includes(provider));

// A price move by a dynamic provider (`dynamic`: a set of names) that, among the
// events of its model at its check (`together`), neither makes nor ends that
// provider the cheapest nor pushes a price range past SPREAD.
export function routineMove(e, together, dynamic) {
  if (e?.type !== 'price-changed' || !dynamic.has(e.provider)) return false;
  return !together.some(other =>
    (other.type === 'cheapest-changed' && namesProvider(other, e.provider))
    || (other.type === 'spread-crossed' && pushedRange(e, other)));
}

// Every routine move in a list of events, judged at its own check.
export function routineMoves(events) {
  const index = repricingIndex(events);
  const groups = new Map();
  for (const e of events || []) {
    const key = `${e.model}|${e.at}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const routine = new Set();
  for (const group of groups.values()) {
    const repriced = [...new Set(group.filter(e => e.type === 'price-changed' && e.provider).map(e => e.provider))];
    const dynamic = new Set(dynamicProviders(index, group[0].at, repriced).map(d => d.provider));
    for (const e of group) {
      if (routineMove(e, group, dynamic)) routine.add(e);
    }
  }
  return routine;
}
