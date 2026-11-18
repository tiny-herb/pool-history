import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  changedModels,
  keepDecision,
  partialSnapshot,
  checkOnce,
  loadHistory,
  nextRun,
  stopper,
  scrub,
  postFromHistory,
  runOnce,
} from "../src/watch.mjs";

const endpoint = (tag, provider, prompt = 1, completion = 2) => ({
  tag,
  provider,
  prompt,
  completion,
  discount: 0,
  context: null,
  quantization: null,
  status: null,
  uptime30m: null,
  uptime1d: null,
  uptimePage: null,
  latency30m: null,
  throughput30m: null,
});

const observed = (name, endpoints) => ({
  name,
  listed: { prompt: 1, completion: 2 },
  endpoints,
});

const snapshot = {
  takenAt: "2026-11-17T16:37:00Z",
  source: "openrouter-api",
  partial: false,
  note: null,
  modelCount: 3,
  catalogue: ["a/a", "b/b", "c/c"],
  models: {
    "a/a": observed("A", [endpoint("a", "A")]),
    "b/b": observed("B", [endpoint("b", "B")]),
    "c/c": {
      name: "C",
      listed: null,
      error: "endpoint read failed",
    },
  },
};

test("nextRun schedules the next strictly later matching minute", () => {
  assert.equal(
    nextRun(new Date("2026-11-16T19:06:42Z"), 15).toISOString(),
    "2026-11-16T19:07:00.000Z",
  );

  assert.equal(
    nextRun(new Date("2026-11-16T19:07:00Z"), 15).toISOString(),
    "2026-11-16T19:22:00.000Z",
  );

  assert.equal(
    nextRun(new Date("2026-11-16T23:52:30Z"), 15).toISOString(),
    "2026-11-17T00:07:00.000Z",
  );

  assert.equal(
    nextRun(new Date("2026-11-16T19:08:00Z"), 5).toISOString(),
    "2026-11-16T19:12:00.000Z",
  );
});

test("partialSnapshot keeps the sorted catalogue and selected models only", () => {
  const result = partialSnapshot(
    {
      takenAt: "2026-11-17T16:37:00Z",
      source: "openrouter-api",
      partial: false,
      note: null,
      modelCount: 3,
      models: {
        "z/z": observed("Z", [endpoint("z", "Z")]),
        "a/a": observed("A", [endpoint("a", "A")]),
        "m/m": observed("M", [endpoint("m", "M")]),
      },
    },
    ["z/z", "a/a"],
  );

  assert.deepEqual(result, {
    takenAt: "2026-11-17T16:37:00Z",
    source: "openrouter-api",
    partial: true,
    note: null,
    modelCount: 3,
    catalogue: ["a/a", "m/m", "z/z"],
    models: {
      "a/a": observed("A", [endpoint("a", "A")]),
      "z/z": observed("Z", [endpoint("z", "Z")]),
    },
  });
});

test("partialSnapshot can contain no models when only the catalogue changed", () => {
  const result = partialSnapshot(
    {
      takenAt: "2026-11-17T00:22:00Z",
      source: "openrouter-api",
      partial: false,
      note: null,
      modelCount: 1,
      models: {
        "a/a": observed("A", [endpoint("a", "A")]),
      },
    },
    [],
  );

  assert.deepEqual(result, {
    takenAt: "2026-11-17T00:22:00Z",
    source: "openrouter-api",
    partial: true,
    note: null,
    modelCount: 1,
    catalogue: ["a/a"],
    models: {},
  });
});

test("scrub replaces every occurrence of every secret", () => {
  assert.equal(
    scrub(
      "token=abc key=xyz abc xyz abc",
      ["abc", "xyz"],
    ),
    "token=[redacted] key=[redacted] [redacted] [redacted] [redacted]",
  );
});

test("scrub ignores undefined secrets", () => {
  assert.equal(
    scrub("DISCORD token is visible", [undefined, ""]),
    "DISCORD token is visible",
  );
});

test("stopper exits immediately on a second request", async () => {
  const exits = [];
  const logs = [];

  const control = stopper({
    exit: (code) => exits.push(code),
    log: (line) => logs.push(line),
  });

  control.request();
  control.request();

  assert.deepEqual(exits, [0, 130]);
  assert.deepEqual(logs, ['watch stopped']);
});

test("stopper waits for a tracked promise before finishing", async () => {
  const exits = [];
  const logs = [];
  let resolveWork;

  const work = new Promise((resolve) => {
    resolveWork = resolve;
  });

  const control = stopper({
    exit: (code) => exits.push(code),
    log: (line) => logs.push(line),
  });

  const tracked = control.track(work);
  control.request();

  assert.deepEqual(exits, []);
  assert.equal(logs[0], 'stopping after 1 Test request answer in progress (Ctrl+C again to stop now)');

  resolveWork();
  await tracked;

  assert.deepEqual(exits, [0]);
});

test("stopper run returns the function result", async () => {
  const exits = [];
  const logs = [];
  const control = stopper({
    exit: (code) => exits.push(code),
    log: (line) => logs.push(line),
  });

  assert.equal(await control.run(async () => 42), 42);
  assert.deepEqual(exits, []);
  assert.deepEqual(logs, []);
});

test("checkOnce refuses an empty catalogue without writing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "watch-"));
  const dir = path.join(root, "snapshots");
  const checksPath = path.join(root, "checks.jsonl");
  await fs.mkdir(dir, { recursive: true });

  const fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { data: [] };
    },
  });

  await assert.rejects(
    checkOnce({
      dir,
      checksPath,
      fetch,
      now: () => new Date("2026-11-17T00:22:00Z"),
      sleep: async () => {},
      concurrency: 1,
    }),
    (error) => {
      assert.equal(
        error.message,
        "check refused: the catalogue came back empty; nothing written",
      );
      return true;
    },
  );

  assert.deepEqual(
    (await fs.readdir(dir)).filter((name) => name.endsWith(".json")),
    [],
  );
  await assert.rejects(fs.access(checksPath));
});

test("checkOnce refuses a catalogue below eighty percent of the previous full snapshot", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "watch-"));
  const dir = path.join(root, "snapshots");
  const checksPath = path.join(root, "checks.jsonl");
  await fs.mkdir(dir, { recursive: true });

  const previous = {
    takenAt: "2026-11-17T00:07:00Z",
    source: "openrouter-api",
    partial: false,
    note: null,
    modelCount: 4,
    models: {},
  };

  await fs.writeFile(
    path.join(dir, "2026-11-17T0007Z.json"),
    `${JSON.stringify(previous)}\n`,
  );

  const fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        data: [{ id: "a/a", name: "A" }],
      };
    },
  });

  await assert.rejects(
    checkOnce({
      dir,
      checksPath,
      fetch,
      now: () => new Date("2026-11-17T00:22:00Z"),
      sleep: async () => {},
      concurrency: 1,
    }),
    (error) => {
      assert.equal(
        error.message,
        "check refused: the catalogue lists 1 models, under 80% of the 4 in the previous full snapshot; nothing written",
      );
      return true;
    },
  );

  assert.deepEqual(
    (await fs.readdir(dir)).filter((name) => name.endsWith(".json")),
    ["2026-11-17T0007Z.json"],
  );
  await assert.rejects(fs.access(checksPath));
});

test("loadHistory returns an empty history when no snapshots exist", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "watch-"));
  const dir = path.join(root, "snapshots");
  await fs.mkdir(dir, { recursive: true });

  const history = await loadHistory(dir, {
    checksPath: path.join(root, "checks.jsonl"),
  });

  assert.equal(history.takenAt, null);
  assert.equal(history.latestFull, null);
  assert.deepEqual(history.snapshots, []);
  assert.deepEqual(history.models, {});
  assert.deepEqual(history.events, []);
});

test("changedModels returns no models for an empty history", () => {
  const history = {
    takenAt: null,
    latestFull: null,
    snapshots: [],
    models: {},
    events: [],
  };

  assert.deepEqual(
    changedModels(snapshot, history),
    [],
  );
});

test("keepDecision writes a full snapshot on the first live UTC day", () => {
  const history = {
    takenAt: null,
    latestFull: null,
    snapshots: [],
    models: {},
    events: [],
  };

  assert.deepEqual(
    keepDecision(snapshot, history, []),
    { kind: "full", models: [] },
  );
});

test("keepDecision writes nothing when the live full snapshot is unchanged", () => {
  const history = {
    takenAt: "2026-11-17T16:00:00Z",
    latestFull: {
      takenAt: "2026-11-17T00:07:00Z",
      source: "openrouter-api",
    },
    snapshots: [{
      takenAt: "2026-11-17T00:07:00Z",
      source: "openrouter-api",
      partial: false,
      modelCount: 3,
    }],
    models: {},
    events: [],
  };

  assert.deepEqual(
    keepDecision(snapshot, history, [{
      takenAt: "2026-11-17T00:07:00Z",
      source: "openrouter-api",
      partial: false,
      modelCount: 3,
    }]),
    { kind: null, models: [] },
  );
});
