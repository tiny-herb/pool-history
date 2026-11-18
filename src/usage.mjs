import { modelsUrl } from './endpoints.mjs';

const RANKINGS_BASE =
  'https://openrouter.ai/api/v1/datasets/rankings-daily';

function utcDate(date) {
  return new Date(date);
}

function dateText(date) {
  return date.toISOString().slice(0, 10);
}

export function rankingsUrl(now) {
  const today = utcDate(now);
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() - 1);

  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 7);

  return `${RANKINGS_BASE}?start_date=${dateText(start)}&end_date=${dateText(end)}`;
}

export function baseId(id) {
  return String(id).split(':', 1)[0];
}

export function weeklyUsage(rows, catalogue, asOf = null) {
  const totals = new Map();

  for (const row of rows ?? []) {
    const slug = row?.model_permaslug;
    const tokens = Number(row?.total_tokens);
    if (!slug || !Number.isFinite(tokens)) continue;
    totals.set(slug, (totals.get(slug) ?? 0) + tokens);
  }

  const catalogueSlugs = new Set(
    (catalogue ?? []).map(model => model?.canonical_slug).filter(Boolean)
  );
  const ranked = [...totals.entries()]
    .filter(([slug]) => catalogueSlugs.has(slug))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([slug, tokens], index) => ({
      slug,
      tokens,
      rank: index + 1
    }));

  const bySlug = new Map(ranked.map(item => [item.slug, item]));
  const result = new Map();

  for (const model of catalogue ?? []) {
    const item = bySlug.get(model?.canonical_slug);
    if (!item || !model?.id) continue;

    result.set(model.id, {
      tokens: item.tokens,
      rank: item.rank,
      asOf
    });
  }

  return result;
}

export function formatTokens(n) {
  const value = Number(n);
  if (!Number.isFinite(value) || value === 0) return '0';
  if (Math.abs(value) < 1_000_000) return String(Math.round(value));

  const units = [
    [1_000_000_000_000, 'T'],
    [1_000_000_000, 'B'],
    [1_000_000, 'M']
  ];

  for (const [unit, suffix] of units) {
    if (Math.abs(value) >= unit) {
      const amount = value / unit;
      const rounded = Math.round(amount * 10) / 10;
      return `${rounded}${suffix}`;
    }
  }

  return String(Math.round(value));
}

const READ_TIMEOUT_MS = 30_000;

async function readJson(fetchImpl, url, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`GET ${url} timed out after ${READ_TIMEOUT_MS / 1000} s`)),
    READ_TIMEOUT_MS
  );
  const init = {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    signal: controller.signal
  };

  try {
    const response = await fetchImpl(url, init);

    if (!response.ok) {
      let detail = '';
      try {
        // Remove the key before cutting, so no part of it survives the cut.
        detail = (await response.text()).split(apiKey).join('[redacted]').slice(0, 200);
      } catch {
        // Ignore an unavailable response body.
      }
      throw new Error(
        `GET ${url} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`
      );
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function createUsageCache() {
  let loadedDay = null;
  let lastGood = null;
  let pending = null;

  return {
    async get({
      fetch: fetchImpl = globalThis.fetch,
      apiKey,
      now = new Date(),
      log = () => {}
    } = {}) {
      if (!apiKey) return null;

      const day = dateText(new Date(now));
      if (loadedDay === day) return lastGood;
      if (pending) return pending;

      pending = (async () => {
        try {
          const [catalogueJson, rankingsJson] = await Promise.all([
            readJson(fetchImpl, modelsUrl(), apiKey),
            readJson(fetchImpl, rankingsUrl(now), apiKey)
          ]);

          const catalogue = Array.isArray(catalogueJson?.data)
            ? catalogueJson.data
            : [];
          const rows = Array.isArray(rankingsJson?.data)
            ? rankingsJson.data
            : [];

          lastGood = weeklyUsage(rows, catalogue, rankingsJson?.as_of ?? null);
          loadedDay = day;
          return lastGood;
        } catch (error) {
          loadedDay = day;
          const reason = error instanceof Error
            ? error.message
            : String(error);
          log(
            `usage: OpenRouter's rankings did not load (${reason}); cards go out without the usage line`
          );
          return lastGood;
        } finally {
          pending = null;
        }
      })();

      return pending;
    }
  };
}
