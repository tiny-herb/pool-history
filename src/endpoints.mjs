import { perMillion } from './format.mjs';

export const API_BASE = 'https://openrouter.ai/api/v1';

export function modelsUrl() {
  return `${API_BASE}/models?output_modalities=all`;
}

export function endpointsUrl(model) {
  return `${API_BASE}/models/${model}/endpoints`;
}

// Video models are priced per model, in the `pricing_skus` of this list.
export function videosUrl() {
  return `${API_BASE}/videos/models`;
}

// An image model's per-provider prices, each with the unit it is billed in.
export function imageEndpointsUrl(model) {
  return `${API_BASE}/images/models/${model}/endpoints`;
}

const scaled = (value, scale) => Number((value * scale).toPrecision(12));

function unknownPrice(value) {
  const number = Number(value);
  return { unit: null, value: value !== '' && Number.isFinite(number) ? number : value };
}

// SKU name with any resolution segment removed → [unit, USD per listed unit, detail]. The
// `cents_` names list cents.
const VIDEO_SKUS = {
  duration_seconds: ['second', 1],
  duration_seconds_with_audio: ['second-with-audio', 1],
  duration_seconds_without_audio: ['second-without-audio', 1],
  text_to_video_duration_seconds: ['second', 1, 'text to video'],
  image_to_video_duration_seconds: ['second', 1, 'image to video'],
  cents_per_second_output: ['second', 0.01],
  cents_per_video_output_second: ['second', 0.01],
  cents_per_second_video_continuation: ['second', 0.01, 'video continuation'],
  video_tokens: ['video-tokens', 1e6],
  video_tokens_without_audio: ['video-tokens', 1e6, 'without audio'],
  video_tokens_with_video_input: ['video-tokens', 1e6, 'with video input'],
  cents_per_image_input: ['input-image', 0.01],
  minimum_cents_per_generation: ['video-minimum', 0.01]
};

const RESOLUTIONS = {
  '360p': '360p',
  '480p': '480p',
  '720p': '720p',
  '768p': '768p',
  '1080p': '1080p',
  '2k': '2K',
  '4k': '4K'
};

function videoSkuPrice(key, value) {
  const parts = String(key).split('_');
  const at = parts.findIndex(part => Object.hasOwn(RESOLUTIONS, part));
  const resolution = at < 0 ? null : RESOLUTIONS[parts[at]];
  const base = parts.filter((_, index) => index !== at).join('_');
  const sku = VIDEO_SKUS[base];
  const number = Number(value);
  if (!sku || value === '' || value === null || !Number.isFinite(number)) return unknownPrice(value);

  const [unit, scale, mode] = sku;
  const detail = [mode, resolution].filter(Boolean).join(', ');
  return { unit, usd: scaled(number, scale), ...(detail ? { detail } : {}) };
}

// GET /videos/models → Map(model id → { sku: price }).
export function videoModelPrices(json) {
  const result = new Map();
  for (const model of Array.isArray(json?.data) ? json.data : []) {
    if (typeof model?.id !== 'string') continue;
    const prices = {};
    for (const [key, value] of Object.entries(model.pricing_skus ?? {})) {
      prices[key] = videoSkuPrice(key, value);
    }
    result.set(model.id, prices);
  }
  return result;
}

// `billable:unit` → [unit, USD per listed unit].
const IMAGE_PRICES = {
  'input_text:token': ['input-text-tokens', 1e6],
  'input_image:token': ['input-image-tokens', 1e6],
  'output_image:token': ['output-image-tokens', 1e6],
  'output_image:image': ['image', 1],
  'input_image:image': ['input-image', 1],
  'input_reference:image': ['reference-image', 1],
  'output_image:megapixel': ['output-megapixel', 1],
  'input_image:megapixel': ['input-megapixel', 1],
  'output_image:request': ['request', 1]
};

function variantText(variant) {
  return String(variant)
    .replaceAll('_', ' ')
    .replace(/^(\d+(?:\.\d+)?)k$/, '$1K');
}

// GET /images/models/{id}/endpoints → Map(provider tag → { 'billable:unit[:variant]': price }).
export function imageEndpointPrices(json) {
  const result = new Map();
  for (const endpoint of Array.isArray(json?.endpoints) ? json.endpoints : []) {
    const tag = endpoint?.provider_tag ?? endpoint?.provider_slug;
    if (typeof tag !== 'string') continue;
    const prices = {};
    for (const item of Array.isArray(endpoint.pricing) ? endpoint.pricing : []) {
      const kind = `${item?.billable}:${item?.unit}`;
      const key = item?.variant ? `${kind}:${item.variant}` : kind;
      const known = IMAGE_PRICES[kind];
      const number = Number(item?.cost_usd);
      if (!known || item?.cost_usd === '' || item?.cost_usd === null || !Number.isFinite(number)) {
        prices[key] = unknownPrice(item?.cost_usd);
        continue;
      }
      prices[key] = {
        unit: known[0],
        usd: scaled(number, known[1]),
        ...(item.variant ? { detail: variantText(item.variant) } : {})
      };
    }
    result.set(tag, prices);
  }
  return result;
}

// `pricing` key → [unit, USD per listed unit], for the keys OpenRouter's model pages word the
// same way on every model of the kind. Every other key is kept as listed: speech and
// transcription models are billed per character, second, hour or token, model by model and
// provider by provider, and the list does not say which.
const ENDPOINT_PRICES = {
  embeddings: {
    prompt: ['input-tokens', 1e6],
    image_token: ['input-image-tokens', 1e6],
    audio: ['input-audio-tokens', 1e6]
  },
  decisions: {
    prompt: ['input-tokens', 1e6],
    completion: ['output-tokens', 1e6],
    input_cache_read: ['cached-input-tokens', 1e6],
    request: ['request', 1]
  }
};

// Keys of `pricing` that are not prices.
const NOT_PRICES = new Set(['discount', 'overrides']);

// GET /models/{id}/endpoints of a kind priced there → Map(provider tag → { pricing key: price }).
// A listed 0 is kept, so a move to or from it is seen, and marked `unlisted`: on these kinds
// OpenRouter lists 0 where its model page shows a price (every rerank model), so it is not shown.
export function endpointListedPrices(json, kind) {
  const units = ENDPOINT_PRICES[kind] ?? {};
  const result = new Map();
  for (const raw of Array.isArray(json?.data?.endpoints) ? json.data.endpoints : []) {
    const tag = raw?.tag ?? String(raw?.provider_name ?? '').toLowerCase();
    const prices = {};
    for (const [key, value] of Object.entries(raw?.pricing ?? {})) {
      if (NOT_PRICES.has(key)) continue;
      const number = Number(value);
      const unit = units[key];
      const price = unit && value !== '' && value !== null && Number.isFinite(number)
        ? { unit: unit[0], usd: scaled(number, unit[1]) }
        : unknownPrice(value);
      prices[key] = number === 0 ? { ...price, unlisted: true } : price;
    }
    result.set(tag, prices);
  }
  return result;
}

function nullable(value) {
  return value === undefined ? null : value;
}

function percentile(value) {
  if (value && typeof value === 'object') {
    return nullable(value.p50);
  }
  return typeof value === 'number' ? value : null;
}

function price(value) {
  if (value === null || value === undefined || value === '') return 0;
  const result = perMillion(value);
  return Number.isFinite(result) ? result : 0;
}

function requests30m(perf) {
  if (!perf || typeof perf !== 'object') return null;

  let total = 0;
  let found = false;
  for (const workload of Object.values(perf)) {
    if (!workload || typeof workload !== 'object') continue;
    const count = Number(workload.request_count);
    if (Number.isFinite(count)) {
      total += count;
      found = true;
    }
  }
  return found ? total : null;
}

export function normalizeEndpoints(json) {
  const data = json?.data ?? {};
  const rawEndpoints = Array.isArray(data.endpoints) ? data.endpoints : [];

  return {
    model: {
      id: data.id ?? null,
      name: data.name ?? null
    },
    endpoints: rawEndpoints.map((raw) => {
      const provider = raw.provider_name ?? raw.tag ?? '';
      const tag = raw.tag ?? String(provider).toLowerCase();
      const pricing = raw.pricing ?? {};
      const promptPerM = price(pricing.prompt);
      const completionPerM = price(pricing.completion);
      const perf = raw.perf_last_30m_by_workload;

      return {
        tag,
        slug: tag.split('/')[0],
        provider,
        prompt: promptPerM,
        completion: completionPerM,
        promptPerM,
        completionPerM,
        discount: pricing.discount ?? 0,
        context: nullable(raw.context_length),
        quantization: nullable(raw.quantization),
        status: nullable(raw.status),
        uptime30m: nullable(raw.uptime_last_30m),
        uptime1d: nullable(raw.uptime_last_1d),
        uptimePage: null,
        throughput30m: percentile(raw.throughput_last_30m),
        latency30m: percentile(raw.latency_last_30m),
        requests30m: requests30m(perf),
        maxCompletion: raw.max_completion_tokens ?? null,
        supportedParameters: Array.isArray(raw.supported_parameters)
          ? raw.supported_parameters
          : [],
        toolChoice: {
          none: raw.tool_choice?.none === true,
          auto: raw.tool_choice?.auto === true,
          required: raw.tool_choice?.required === true,
          function: raw.tool_choice?.function === true
        }
      };
    })
  };
}

export const ENDPOINTS_TIMEOUT_MS = 10000;

export async function fetchEndpoints(
  model,
  {
    fetch: fetchImpl = globalThis.fetch,
    timeoutMs = ENDPOINTS_TIMEOUT_MS,
    apiKey
  } = {}
) {
  const url = endpointsUrl(model);
  const controller = new AbortController();
  const headers = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let timedOut = false;
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error(`GET ${url} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });

  async function read() {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers,
        signal: controller.signal
      });

      if (response.ok) return normalizeEndpoints(await response.json());

      // Remove the key before cutting, so no part of it survives the cut.
      let body = await response.text();
      if (apiKey) body = body.split(apiKey).join('[redacted]');
      const error = new Error(
        `GET ${url} returned HTTP ${response.status}: ${body.slice(0, 200)}`
      );
      const retryable = response.status === 429 || response.status >= 500;

      if (!retryable || attempt === 3) throw error;

      const wait = [500, 1000, 2000][attempt];
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  try {
    return await Promise.race([read(), timeout]);
  } catch (error) {
    if (timedOut) {
      throw new Error(`GET ${url} timed out after ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
