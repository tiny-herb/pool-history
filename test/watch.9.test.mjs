import test from "node:test";
import assert from "node:assert/strict";

import {
  partialSnapshot,
  nextRun,
  scrub,
  keepDecision,
} from "../src/watch.mjs";

test("partialSnapshot keeps the catalogue sorted and only selected models", () => {
  const first = {
    name: "B",
    listed: { prompt: 1, completion: 2 },
    endpoints: [],
  };
  const second = {
    name: "A",
    listed: null,
    error: "down",
  };

  const snapshot = {
    takenAt: "2026-11-17T12:07:00Z",
    source: "openrouter-api",
    partial: false,
    note: null,
    modelCount: 3,
    catalogue: ["z/model", "a/model", "m/model"],
    models: {
      "b/model": first,
      "a/model": second,
      "z/model": {
        name: "Z",
        listed: null,
        endpoints: [],
      },
    },
  };

  assert.deepEqual(partialSnapshot(snapshot, ["b/model", "a/model"]), {
    takenAt: "2026-11-17T12:07:00Z",
    source: "openrouter-api",
    partial: true,
    note: null,
    modelCount: 3,
    catalogue: ["a/model", "m/model", "z/model"],
    models: {
      "a/model": second,
      "b/model": first,
    },
  });
});

test("partialSnapshot does not mutate its input", () => {
  const snapshot = {
    takenAt: "2026-11-17T12:07:00Z",
    source: "openrouter-api",
    partial: false,
    note: null,
    modelCount: 1,
    catalogue: ["b", "a"],
    models: {
      a: { name: "A", listed: null, endpoints: [] },
      b: { name: "B", listed: null, endpoints: [] },
    },
  };

  const result = partialSnapshot(snapshot, ["a"]);

  assert.equal(snapshot.partial, false);
  assert.deepEqual(snapshot.catalogue, ["b", "a"]);
  assert.deepEqual(Object.keys(snapshot.models).sort(), ["a", "b"]);
  assert.notStrictEqual(result, snapshot);
  assert.notStrictEqual(result.models, snapshot.models);
});

test("nextRun schedules the next strictly future slot", () => {
  assert.equal(
    nextRun(new Date("2026-11-17T12:00:00Z"), 15).toISOString(),
    "2026-11-17T12:07:00.000Z",
  );
  assert.equal(
    nextRun(new Date("2026-11-17T12:06:59Z"), 15).toISOString(),
    "2026-11-17T12:07:00.000Z",
  );
  assert.equal(
    nextRun(new Date("2026-11-17T12:07:00Z"), 15).toISOString(),
    "2026-11-17T12:22:00.000Z",
  );
  assert.equal(
    nextRun(new Date("2026-11-17T12:07:30Z"), 15).toISOString(),
    "2026-11-17T12:22:00.000Z",
  );
  assert.equal(
    nextRun(new Date("2026-11-17T12:22:00Z"), 15).toISOString(),
    "2026-11-17T12:37:00.000Z",
  );
  assert.equal(
    nextRun(new Date("2026-11-17T12:52:10Z"), 15).toISOString(),
    "2026-11-17T13:07:00.000Z",
  );
  assert.equal(
    nextRun(new Date("2026-11-17T23:59:00Z"), 15).toISOString(),
    "2026-11-18T00:07:00.000Z",
  );
});

test("nextRun supports schedules other than fifteen minutes", () => {
  assert.equal(
    nextRun(new Date("2026-11-17T12:00:00Z"), 5).toISOString(),
    "2026-11-17T12:02:00.000Z",
  );
  assert.equal(
    nextRun(new Date("2026-11-17T12:02:00Z"), 5).toISOString(),
    "2026-11-17T12:07:00.000Z",
  );
  assert.equal(
    nextRun(new Date("2026-11-17T12:59:59.999Z"), 5).toISOString(),
    "2026-11-17T13:02:00.000Z",
  );
});

test("scrub replaces every configured secret", () => {
  assert.equal(
    scrub(
      "Authorization: Bot abc.def failed with key sk-or-123",
      ["abc.def", "sk-or-123"],
    ),
    "Authorization: Bot [redacted] failed with key [redacted]",
  );
});

test("scrub replaces repeated secrets everywhere", () => {
  assert.equal(
    scrub("abc abc / abc", ["abc"]),
    "[redacted] [redacted] / [redacted]",
  );
});

test("scrub ignores missing secrets", () => {
  assert.equal(
    scrub("token stays visible only when it is not configured", [
      undefined,
      null,
      "",
    ]),
    "token stays visible only when it is not configured",
  );
});

test("keepDecision chooses a full snapshot on a UTC day without a full API snapshot", () => {
  const snapshot = {
    takenAt: "2026-11-17T00:07:00Z",
    source: "openrouter-api",
    partial: false,
    note: null,
    modelCount: 1,
    catalogue: ["a/b"],
    models: {
      "a/b": {
        name: "A: B",
        listed: null,
        endpoints: [],
      },
    },
  };

  const history = {
    takenAt: "2026-11-16T23:52:00Z",
    latestFull: {
      takenAt: "2026-11-16T23:52:00Z",
      source: "openrouter-api",
    },
    snapshots: [
      {
        takenAt: "2026-11-16T23:52:00Z",
        source: "openrouter-api",
        partial: false,
        modelCount: 1,
      },
    ],
    models: {},
    events: [],
  };

  assert.deepEqual(keepDecision(snapshot, history, history.snapshots), {
    kind: "full",
    models: [],
  });
});

test("keepDecision does not treat an archived full seed as today's API full snapshot", () => {
  const snapshot = {
    takenAt: "2026-11-17T00:07:00Z",
    source: "openrouter-api",
    partial: false,
    note: null,
    modelCount: 1,
    catalogue: ["a/b"],
    models: {},
  };

  const stored = [
    {
      takenAt: "2026-11-16T23:52:00Z",
      source: "archived-model-page",
      partial: false,
      modelCount: 1,
    },
  ];

  const history = {
    takenAt: stored[0].takenAt,
    latestFull: {
      takenAt: stored[0].takenAt,
      source: stored[0].source,
    },
    snapshots: stored,
    models: {},
    events: [],
  };

  assert.deepEqual(keepDecision(snapshot, history, stored), {
    kind: "full",
    models: [],
  });
});
