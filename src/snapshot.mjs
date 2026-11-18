import {
  modelsUrl,
  endpointsUrl,
  normalizeEndpoints,
  videosUrl,
  videoModelPrices,
  imageEndpointsUrl,
  imageEndpointPrices,
  endpointListedPrices
} from './endpoints.mjs';
import { perMillion } from './format.mjs';
import { listedPriceKind } from './model-types.mjs';
import * as nodeFs from 'node:fs/promises';
import { join as joinPath } from 'node:path';

const DEFAULT_FS = nodeFs;

export async function fetchJson(
  url,
  {
    fetch: fetchImpl = globalThis.fetch,
    retries = 3,
    backoffMs = 500,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    timeoutMs = 30000
  } = {}
) {
  let attempt = 0;

  while (true) {
    const controller = new AbortController();
    let timer;
    let timedOut = false;

    try {
      const response = await new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error(`GET ${url} timed out after ${timeoutMs} ms`));
        }, timeoutMs);

        Promise.resolve()
          .then(() => fetchImpl(url, {
            headers: { Accept: 'application/json' },
            signal: controller.signal
          }))
          .then(resolve, reject);
      });

      if (!response.ok) {
        const body = (await response.text()).slice(0, 200);
        const error = new Error(
          `GET ${url} returned HTTP ${response.status}: ${body}`
        );

        if (
          (response.status === 429 || response.status >= 500) &&
          response.status <= 599 &&
          attempt < retries
        ) {
          await sleep(backoffMs * 2 ** attempt);
          attempt++;
          continue;
        }

        throw error;
      }

      return await response.json();
    } catch (error) {
      if (timedOut) {
        throw new Error(`GET ${url} timed out after ${timeoutMs} ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function listedPrice(value) {
  if (value === undefined || value === null || value === '') return 0;
  const result = perMillion(value);
  return Number.isFinite(result) ? result : 0;
}

function catalogueEntry(model) {
  const pricing = model.pricing ?? {};
  const hasPrompt = pricing.prompt !== undefined &&
    pricing.prompt !== null && pricing.prompt !== '';
  const hasCompletion = pricing.completion !== undefined &&
    pricing.completion !== null && pricing.completion !== '';

  const entry = {
    name: model.name || model.id,
    listed: hasPrompt || hasCompletion
      ? {
          prompt: listedPrice(pricing.prompt),
          completion: listedPrice(pricing.completion)
        }
      : null
  };

  const architecture = model.architecture ?? {};
  if (Array.isArray(architecture.output_modalities)) {
    entry.outputModalities = architecture.output_modalities
      .map(String);
  }
  if (Array.isArray(architecture.input_modalities)) {
    entry.inputModalities = architecture.input_modalities
      .map(String);
  }

  return entry;
}

export async function takeSnapshot({
  fetch: fetchImpl = globalThis.fetch,
  now = () => new Date(),
  concurrency = 6,
  sleep
} = {}) {
  const started = now();
  const takenAt = new Date(started).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const catalogueJson = await fetchJson(modelsUrl(), {
    fetch: fetchImpl,
    sleep
  });

  const catalogue = Array.isArray(catalogueJson?.data)
    ? catalogueJson.data
    : [];

  const ids = catalogue
    .map(model => model?.id)
    .filter(id => typeof id === 'string')
    .sort();

  const models = {};
  for (const model of catalogue) {
    if (typeof model?.id === 'string') {
      models[model.id] = catalogueEntry(model);
    }
  }

  // Prices listed other than per token. A model keeps `prices` (model level, video) and an
  // endpoint keeps `prices` (per provider, image) only when the call that lists them answered;
  // when it failed, the prices are unknown for this snapshot and `pricesError` says why. Speech,
  // transcription, embeddings, rerank and decision endpoints take theirs from the endpoints list.
  const kindOf = id => listedPriceKind(models[id].outputModalities);
  const videoIds = ids.filter(id => kindOf(id) === 'video');
  if (videoIds.length > 0) {
    try {
      const listed = videoModelPrices(
        await fetchJson(videosUrl(), { fetch: fetchImpl, sleep })
      );
      for (const id of videoIds) models[id].prices = listed.get(id) ?? {};
    } catch (error) {
      for (const id of videoIds) {
        models[id].pricesError = error?.message ?? String(error);
      }
    }
  }

  let next = 0;
  const workers = Math.max(
    1,
    Math.min(Number.isFinite(concurrency) ? concurrency : 6, ids.length || 1)
  );

  async function imagePrices(id) {
    try {
      const listed = imageEndpointPrices(
        await fetchJson(imageEndpointsUrl(id), { fetch: fetchImpl, sleep })
      );
      for (const endpoint of models[id].endpoints) {
        endpoint.prices = listed.get(endpoint.tag) ?? {};
      }
    } catch (error) {
      models[id].pricesError = error?.message ?? String(error);
    }
  }

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= ids.length) return;

      const id = ids[index];
      try {
        const json = await fetchJson(endpointsUrl(id), {
          fetch: fetchImpl,
          sleep
        });
        const pool = normalizeEndpoints(json);
        models[id].endpoints = pool.endpoints.map(toRecord);
        const kind = kindOf(id);
        if (kind && kind !== 'video' && kind !== 'image') {
          const listed = endpointListedPrices(json, kind);
          for (const endpoint of models[id].endpoints) {
            endpoint.prices = listed.get(endpoint.tag) ?? {};
          }
        }
      } catch (error) {
        models[id].error = error?.message ?? String(error);
        continue;
      }
      if (kindOf(id) === 'image') await imagePrices(id);
    }
  }

  await Promise.all(Array.from({ length: workers }, worker));

  return {
    takenAt,
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: ids.length,
    models
  };
}

export function toRecord(endpoint) {
  return {
    tag: endpoint.tag,
    provider: endpoint.provider,
    prompt: endpoint.promptPerM,
    completion: endpoint.completionPerM,
    discount: endpoint.discount,
    context: endpoint.context,
    quantization: endpoint.quantization,
    status: endpoint.status,
    uptime30m: endpoint.uptime30m,
    uptime1d: endpoint.uptime1d,
    uptimePage: null,
    latency30m: endpoint.latency30m,
    throughput30m: endpoint.throughput30m
  };
}

export function snapshotFileName(takenAt) {
  const date = new Date(takenAt);
  const pad = value => String(value).padStart(2, '0');

  return `${date.getUTCFullYear()}-${
    pad(date.getUTCMonth() + 1)
  }-${pad(date.getUTCDate())}T${
    pad(date.getUTCHours())
  }${pad(date.getUTCMinutes())}Z.json`;
}

export function observed(entry) {
  return Boolean(entry && 'endpoints' in entry);
}

export function serializeSnapshot(snapshot) {
  const topKeys = [
    'takenAt',
    'source',
    'partial',
    'note',
    'modelCount'
  ];

  if ('catalogue' in snapshot) topKeys.push('catalogue');

  const lines = ['{'];
  for (const key of topKeys) {
    lines.push(
      `  ${JSON.stringify(key)}: ${JSON.stringify(snapshot[key])},`
    );
  }

  lines.push('  "models": {');

  const modelEntries = Object.entries(snapshot.models ?? {});
  modelEntries.forEach(([id, entry], modelIndex) => {
    const comma = modelIndex < modelEntries.length - 1 ? ',' : '';

    if (!observed(entry)) {
      lines.push(`    ${JSON.stringify(id)}: ${JSON.stringify(entry)}${comma}`);
      return;
    }

    lines.push(`    ${JSON.stringify(id)}: {`);

    const keys = Object.keys(entry).filter(key => key !== 'endpoints');
    keys.forEach((key, index) => {
      const suffix = index < keys.length - 1 || entry.endpoints
        ? ','
        : '';
      lines.push(
        `      ${JSON.stringify(key)}: ${JSON.stringify(entry[key])}${suffix}`
      );
    });

    if (entry.endpoints.length === 0) {
      lines.push('      "endpoints": []');
    } else {
      lines.push('      "endpoints": [');
      entry.endpoints.forEach((endpoint, index) => {
        const suffix = index < entry.endpoints.length - 1 ? ',' : '';
        lines.push(`        ${JSON.stringify(endpoint)}${suffix}`);
      });
      lines.push('      ]');
    }

    lines.push(`    }${comma}`);
  });

  lines.push('  }');
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

export async function writeSnapshot(
  dir,
  snapshot,
  { fs = DEFAULT_FS } = {}
) {
  await fs.mkdir(dir, { recursive: true });

  const name = snapshotFileName(snapshot.takenAt);
  const path = joinPath(dir, name);
  const temporary = `${path}.tmp`;

  await fs.writeFile(temporary, serializeSnapshot(snapshot));
  await fs.rename(temporary, path);
  return path;
}

export async function listSnapshotFiles(
  dir,
  { fs = DEFAULT_FS } = {}
) {
  const names = await fs.readdir(dir);
  return names
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => joinPath(dir, name));
}

export async function loadSnapshot(
  path,
  { fs = DEFAULT_FS } = {}
) {
  const text = await fs.readFile(path, 'utf8');
  return JSON.parse(text);
}

export function catalogueLooksWrong(snapshot, previousFull) {
  if (snapshot.modelCount === 0 ||
      (Array.isArray(snapshot.catalogue) && snapshot.catalogue.length === 0)) {
    return 'the catalogue came back empty';
  }

  if (
    previousFull &&
    snapshot.modelCount < previousFull.modelCount * 0.8
  ) {
    return `the catalogue lists ${snapshot.modelCount} models, under 80% of the ${previousFull.modelCount} in the previous full snapshot`;
  }

  return null;
}

export async function readSnapshots(
  dir,
  { fs = DEFAULT_FS } = {}
) {
  const files = await listSnapshotFiles(dir, { fs });
  const snapshots = await Promise.all(
    files.map(file => loadSnapshot(file, { fs }))
  );

  return snapshots.sort((a, b) =>
    String(a.takenAt).localeCompare(String(b.takenAt))
  );
}
