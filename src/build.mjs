import { mkdir, rm, writeFile, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readSnapshots } from "./snapshot.mjs";
import { HistoryBuilder } from "./history.mjs";
import { readChecks } from "./checks.mjs";
import {
  renderIndex,
  renderEvents,
} from "./render.mjs";
import {
  renderFeed,
  renderJsonFeed,
  renderFeedPage,
} from "./feed.mjs";
import {
  cheapest,
  spreadOf,
  priceRanges,
} from "./rules.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function safeName(id) {
  return String(id)
    .replaceAll("/", "__")
    .replaceAll(":", "~")
    .replace(/[^A-Za-z0-9._~-]/g, "_");
}

function json(value, pretty = false) {
  return `${JSON.stringify(value, null, pretty ? 1 : 0)}\n`;
}

function indexModel(model) {
  const point = model.series.at(-1);
  const endpoints = model.latest?.endpoints || [];
  const priced = cheapest(endpoints);
  const endpoint = priced[0] || null;
  const spread = spreadOf(endpoints);

  return {
    slug: model.slug,
    name: model.name,
    endpoints: point?.endpoints ?? 0,
    providers: point?.providers ?? 0,
    cheapest: endpoint?.prompt ?? null,
    cheapestCompletion: endpoint?.completion ?? null,
    cheapestBlended: point?.cheapest ?? null,
    everMulti: model.everMulti,
    spread: spread.spread,
    mixedFree: spread.mixedFree,
    ranges: priceRanges(endpoints),
    minUptime: point?.minUptime ?? null,
    lastChange: model.lastChange,
    firstSeen: model.firstSeen,
    lastObserved: point?.takenAt ?? null,
    inLatestFull: model.inLatestFull,
    observations: model.series.length,
    events: model.events.length,
  };
}

function modelData(model) {
  return {
    slug: model.slug,
    name: model.name,
    series: model.series,
    events: model.events,
    latest: model.latest,
    everMulti: model.everMulti,
    firstSeen: model.firstSeen,
    lastChange: model.lastChange,
    outputModalities: model.outputModalities,
    inputModalities: model.inputModalities,
    inLatestFull: model.inLatestFull,
    latestFull: model.latestFull,
  };
}

async function copyAssets(siteDir) {
  for (const name of ["style.css", "theme.js", "localtime.js"]) {
    await copyFile(join(here, "assets", name), join(siteDir, name));
  }
}

export async function buildSite({
  snapshotsDir,
  siteDir,
  siteUrl = process.env.SITE_URL || null,
  checksPath = null,
}) {
  const snapshots = await readSnapshots(snapshotsDir);
  if (snapshots.length === 0) {
    throw new Error(`no snapshots in ${snapshotsDir}`);
  }

  const checks = await readChecks(
    checksPath || join(dirname(snapshotsDir), "checks.jsonl"),
  );
  const builder = new HistoryBuilder({ checks });
  for (const snapshot of snapshots) builder.add(snapshot);
  const history = builder.finish();

  await rm(siteDir, { recursive: true, force: true });
  await mkdir(join(siteDir, "data", "models"), { recursive: true });

  await copyAssets(siteDir);

  await writeFile(join(siteDir, "index.html"), renderIndex(history));
  await writeFile(join(siteDir, "events.html"), renderEvents(history));
  await writeFile(
    join(siteDir, "feed.xml"),
    renderFeed(history, { siteUrl }),
  );
  await writeFile(
    join(siteDir, "feed.json"),
    renderJsonFeed(history, { siteUrl }),
  );
  await writeFile(join(siteDir, "feed.html"), renderFeedPage(history));

  const models = Object.values(history.models)
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const index = {
    takenAt: history.takenAt,
    snapshots: history.snapshots,
    models: models.map(indexModel),
  };

  await writeFile(join(siteDir, "data", "index.json"), json(index, true));
  await writeFile(
    join(siteDir, "data", "events.json"),
    json(history.events),
  );

  await Promise.all(models.map(model =>
    writeFile(
      join(siteDir, "data", "models", `${safeName(model.slug)}.json`),
      json(modelData(model)),
    )
  ));

  return {
    takenAt: history.takenAt,
    models: models.length,
    pages: 2,
    events: history.events.length,
    snapshots: history.snapshots.length,
  };
}
