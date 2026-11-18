import { SPREAD, providerTag } from "./rules.mjs";

const list = value => Array.isArray(value) ? value : [];

function key(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function refSlug(value) {
  return providerTag(value);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function price(endpoint, side) {
  const value = endpoint?.[side];
  return finite(value) ? value : 0;
}

export function matches(endpoint, ref) {
  if (!endpoint || ref == null) return false;
  const wanted = key(ref);
  if (!wanted) return false;

  return [endpoint.slug, endpoint.provider, endpoint.tag]
    .some(value => key(value) === wanted);
}

export function resolveProviders(refs, endpoints) {
  const source = list(refs);
  const pool = list(endpoints);
  const resolved = [];
  const unmatched = [];

  for (const ref of source) {
    const normalized = refSlug(ref);
    const endpoint = pool.find(item => matches(item, ref));

    if (endpoint) {
      resolved.push(endpoint.slug || refSlug(endpoint.tag || endpoint.provider));
    } else {
      resolved.push(normalized);
      if (!unmatched.includes(normalized)) unmatched.push(normalized);
    }
  }

  return { refs: resolved, unmatched };
}

export function eligible(prefs = {}, endpoints) {
  const pool = list(endpoints);
  const only = list(prefs?.only);
  const ignore = list(prefs?.ignore);
  const max = prefs?.max_price || {};

  return pool.filter(endpoint => {
    if (only.length && !only.some(ref => matches(endpoint, ref))) {
      return false;
    }

    if (ignore.some(ref => matches(endpoint, ref))) {
      return false;
    }

    if (
      finite(max.prompt) &&
      price(endpoint, "promptPerM") > max.prompt
    ) {
      return false;
    }

    if (
      finite(max.completion) &&
      price(endpoint, "completionPerM") > max.completion
    ) {
      return false;
    }

    return true;
  });
}

function clean(value) {
  if (value === 0) return 0;
  return Number(value.toPrecision(15));
}

export function capFor(endpoints) {
  const pool = list(endpoints);
  if (!pool.length) return null;

  const prompts = pool.map(endpoint => price(endpoint, "promptPerM"));
  const completions = pool.map(endpoint => price(endpoint, "completionPerM"));
  const prompt = Math.min(...prompts);
  const completion = Math.min(...completions);

  return {
    prompt: clean(prompt * SPREAD),
    completion: clean(completion * SPREAD),
    free: {
      prompt: prompt === 0,
      completion: completion === 0
    }
  };
}

export function servedLabel(provider, endpoints) {
  const name = String(provider ?? "");
  const found = list(endpoints).filter(endpoint =>
    key(endpoint.provider) === key(name)
  );

  return {
    provider: found[0]?.provider || name,
    count: found.length
  };
}

export function routerGap(available, endpoints, prefs = {}) {
  const names = list(available);
  const pool = eligible(prefs, endpoints);

  // Router metadata identifies providers, not endpoint tags. If it names a
  // provider with multiple endpoints, it cannot identify which endpoint list
  // it considered, so there is no reliable endpoint-level gap to report.
  if (names.some(name =>
    pool.filter(endpoint => key(endpoint.provider) === key(name)).length > 1
  )) {
    return [];
  }

  return pool.filter(endpoint =>
    !names.some(name => key(name) === key(endpoint.provider))
  );
}
