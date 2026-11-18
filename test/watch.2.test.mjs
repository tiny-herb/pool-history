import test from "node:test";
import assert from "node:assert/strict";
import {
  partialSnapshot,
  nextRun,
  scrub,
  stopper,
  loadHistory,
} from "../src/watch.mjs";

test("partialSnapshot keeps the requested models and a sorted catalogue", () => {
  const snapshot = {
    takenAt: "2026-11-17T16:37:00Z",
    source: "openrouter-api",
    partial: false,
    note: null,
    modelCount: 4,
    models: {
      "z/solo": {
        name: "Solo",
        listed: { prompt: 1, completion: 2 },
        endpoints: [],
      },
      "a/model": {
        name: "A",
        listed: null,
        error: "temporarily unavailable",
      },
      "m/model": {
        name: "M",
        listed: { prompt: 0.1, completion: 0.2 },
        endpoints: [
          {
            tag: "m",
            provider: "M",
            prompt: 0.1,
            completion: 0.2,
            discount: 0,
            context: null,
            quantization: null,
            status: null,
            uptime30m: null,
            uptime1d: null,
            uptimePage: null,
            latency30m: null,
            throughput30m: null,
          },
        ],
      },
    },
  };

  const result = partialSnapshot(snapshot, ["m/model", "z/solo"]);

  assert.deepEqual(result, {
    takenAt: "2026-11-17T16:37:00Z",
    source: "openrouter-api",
    partial: true,
    note: null,
    modelCount: 4,
    catalogue: ["a/model", "m/model", "z/solo"],
    models: {
      "m/model": snapshot.models["m/model"],
      "z/solo": snapshot.models["z/solo"],
    },
  });
});

test("partialSnapshot does not mutate its input", () => {
  const snapshot = {
    takenAt: "2026-11-17T16:37:00Z",
    source: "openrouter-api",
    partial: false,
    note: null,
    modelCount: 1,
    catalogue: ["b", "a"],
    models: {
      a: {
        name: "A",
        listed: null,
        endpoints: [],
      },
      b: {
        name: "B",
        listed: null,
        endpoints: [],
      },
    },
  };

  const before = structuredClone(snapshot);
  const result = partialSnapshot(snapshot, []);

  assert.deepEqual(snapshot, before);
  assert.equal(result.partial, true);
  assert.deepEqual(result.catalogue, ["a", "b"]);
  assert.deepEqual(result.models, {});
});

test("partialSnapshot accepts duplicate model ids only once", () => {
  const snapshot = {
    takenAt: "2026-11-17T16:37:00Z",
    source: "openrouter-api",
    partial: false,
    note: null,
    modelCount: 1,
    models: {
      "a/model": {
        name: "A",
        listed: null,
        endpoints: [],
      },
    },
  };

  const result = partialSnapshot(snapshot, ["a/model", "a/model"]);

  assert.deepEqual(Object.keys(result.models), ["a/model"]);
});

test("nextRun schedules the next strictly-future aligned run", () => {
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

test("nextRun preserves seconds only by returning the next whole minute", () => {
  assert.equal(
    nextRun(new Date("2026-11-16T00:00:01Z"), 15).toISOString(),
    "2026-11-16T00:07:00.000Z",
  );

  assert.equal(
    nextRun(new Date("2026-11-16T00:52:59Z"), 15).toISOString(),
    "2026-11-16T01:07:00.000Z",
  );
});

test("scrub replaces every occurrence of every secret", () => {
  assert.equal(
    scrub(
      "token=abc123 key=xyz789 token=abc123",
      ["abc123", "xyz789"],
    ),
    "token=[redacted] key=[redacted] token=[redacted]",
  );
});

test("scrub ignores undefined secrets", () => {
  assert.equal(
    scrub("Authorization: abc123", [undefined, ""]),
    "Authorization: abc123",
  );
});

test("scrub handles secrets containing regular-expression characters", () => {
  assert.equal(
    scrub("a.$[x]\\? a.$[x]\\?", ["a.$[x]\\?"]),
    "[redacted] [redacted]",
  );
});

test("scrub leaves text unchanged when no secret occurs", () => {
  assert.equal(
    scrub("ordinary log line", ["not-present", undefined]),
    "ordinary log line",
  );
});

test("stopper runs a promise and exposes a stopping request", async () => {
  const exits = [];
  const messages = [];
  const controller = stopper({
    exit: (code) => exits.push(code),
    log: (line) => messages.push(line),
  });

  let ran = false;
  const result = await controller.run(async () => {
    ran = true;
    return 42;
  });

  assert.equal(result, 42);
  assert.equal(ran, true);
  assert.deepEqual(exits, []);
  assert.deepEqual(messages, []);
});

test("stopper.track returns the tracked promise result", async () => {
  const controller = stopper({
    exit: () => {},
    log: () => {},
  });

  const promise = Promise.resolve("finished");
  assert.equal(await controller.track(promise), "finished");
});

test("stopper.request is idempotent", () => {
  const messages = [];
  const controller = stopper({
    exit: () => {},
    log: (line) => messages.push(line),
  });

  controller.request();
  controller.request();

  assert.ok(messages.length <= 1);
});

test("loadHistory rejects a missing directory", async () => {
  await assert.rejects(
    loadHistory(
      `/tmp/pool-history-watch-test-${process.pid}-${Date.now()}/snapshots`,
      { checksPath: `/tmp/pool-history-watch-test-${process.pid}-${Date.now()}/checks.jsonl` },
    ),
    { code: "ENOENT" },
  );
});
