import { API_BASE } from './endpoints.mjs';

export const PROBE_PROMPT = 'Reply with exactly: ok';
export const PROBE_MAX_TOKENS = 16;
export const REQUEST_TIMEOUT_MS = 30000;
export const LOOKUP_TIMEOUT_MS = 10000;

function scrub(value, key) {
  const text = String(value ?? '');
  return key ? text.split(key).join('') : text;
}

function errorMessage(body, key) {
  const message = body?.error?.message;
  const start = typeof body === 'string' ? body : JSON.stringify(body);
  return scrub(message ?? start, key).slice(0, 300);
}

function withTimeout(operation, url, timeoutMs) {
  const controller = new AbortController();
  let timer;

  return new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${url} timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    Promise.resolve()
      .then(() => operation(controller.signal))
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

async function requestJson(fetchImpl, url, options, timeoutMs) {
  return withTimeout(
    (signal) => fetchImpl(url, { ...options, signal }),
    url,
    timeoutMs
  );
}

// Polls the generation record while it answers 404 (not settled yet); null when it
// never settles. Throws on a network failure, a timeout or an unreadable body.
async function lookupRecord(fetchImpl, generationId, { apiKey, sleep, tries, delayMs, timeoutMs }) {
  const url = `${API_BASE}/generation?id=${encodeURIComponent(generationId)}`;
  for (let index = 0; index < tries; index += 1) {
    const response = await requestJson(
      fetchImpl,
      url,
      { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } },
      timeoutMs
    );
    if (response.status !== 404) {
      const body = await response.json();
      return response.status >= 200 && response.status < 300
        ? body?.data ?? null
        : null;
    }
    if (index + 1 < tries) await sleep(delayMs);
  }
  return null;
}

export function summarizeMetadata(meta) {
  if (meta == null) return null;

  const endpoints = meta.endpoints;
  const availableEntries = Array.isArray(endpoints?.available)
    ? endpoints.available
    : [];
  const available = availableEntries.map((entry) => entry?.provider ?? '?');
  const selectedEntry = availableEntries.find((entry) => entry?.selected === true);
  const summary = meta.summary;
  const selectedFromSummary = typeof summary === 'string'
    ? summary.match(/(?:^|[\s,;])selected=([^,;\n]+)/)?.[1]?.trim() || null
    : null;
  const selected = selectedEntry?.provider ?? selectedFromSummary ?? null;

  return {
    selected,
    available,
    total: endpoints?.total ?? available.length,
    strategy: meta.strategy,
    attempt: meta.attempt,
    attempts: Array.isArray(meta.attempts)
      ? meta.attempts.map((entry) => ({
          provider: entry?.provider,
          model: entry?.model,
          status: entry?.status
        }))
      : [],
    summary
  };
}

export async function routeCheck(
  model,
  provider,
  {
    fetch: fetchImpl = globalThis.fetch,
    apiKey,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    lookupTries = 6,
    lookupDelayMs = 2500,
    now = () => new Date(),
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
    lookupTimeoutMs = LOOKUP_TIMEOUT_MS,
    log = () => {}
  } = {}
) {
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }

  const at = now().toISOString();
  const url = `${API_BASE}/chat/completions`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-Title': 'openrouter-pool-history',
    'X-OpenRouter-Metadata': 'enabled'
  };

  const baseBody = {
    model,
    messages: [{ role: 'user', content: PROBE_PROMPT }],
    max_completion_tokens: PROBE_MAX_TOKENS,
    temperature: 0,
    reasoning: { enabled: false },
    stream: false,
    provider: provider ?? {}
  };

  let response;
  let body;
  try {
    response = await requestJson(
      fetchImpl,
      url,
      { method: 'POST', headers, body: JSON.stringify(baseBody) },
      requestTimeoutMs
    );
    body = await response.json();
  } catch (error) {
    throw new Error(scrub(error?.message ?? error, apiKey));
  }

  const reasoningMessage = body?.error?.message;
  if (
    response.status === 400 &&
    typeof reasoningMessage === 'string' &&
    /reasoning/i.test(reasoningMessage)
  ) {
    const retryBody = { ...baseBody };
    delete retryBody.reasoning;

    try {
      response = await requestJson(
        fetchImpl,
        url,
        { method: 'POST', headers, body: JSON.stringify(retryBody) },
        requestTimeoutMs
      );
      body = await response.json();
    } catch (error) {
      throw new Error(scrub(error?.message ?? error, apiKey));
    }
  }

  if (response.status < 200 || response.status >= 300) {
    return {
      ok: false,
      status: response.status,
      message: errorMessage(body, apiKey),
      cost: 0,
      at
    };
  }

  const metadata = summarizeMetadata(body?.openrouter_metadata);
  const generationId = body?.id ?? null;
  const usageCost = body?.usage?.cost;
  let record = null;

  // The request went through and is billed whatever the lookup does: a lookup that
  // fails leaves its cost pending (logged), never a thrown, uncounted request.
  if (generationId) {
    try {
      record = await lookupRecord(fetchImpl, generationId, {
        apiKey,
        sleep,
        tries: Math.max(0, Number(lookupTries) || 0),
        delayMs: lookupDelayMs,
        timeoutMs: lookupTimeoutMs
      });
    } catch (error) {
      const text = scrub(error?.message ?? error, apiKey);
      const timedOut = text.match(/timed out after (\d+) ms/);
      log(timedOut
        ? `GET /generation timed out after ${timedOut[1]} ms; cost pending`
        : `GET /generation failed: ${text}; cost pending`);
    }
  }

  const recordCost = record?.total_cost;
  const hasRecordCost = recordCost !== undefined && recordCost !== null;
  const metadataSelected = metadata?.selected ?? null;
  const served =
    record?.provider_name ?? metadataSelected ?? body?.provider ?? null;
  const costPending = !hasRecordCost;

  return {
    ok: true,
    served,
    available: metadata?.available ?? [],
    total: metadata?.total ?? 0,
    attempts: Array.isArray(record?.provider_responses)
      ? Math.max(1, record.provider_responses.length)
      : metadata?.attempt ?? 1,
    cost: hasRecordCost ? recordCost : (usageCost ?? null),
    costPending,
    generationId,
    at
  };
}
