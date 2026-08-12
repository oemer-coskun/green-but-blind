// Tests for dead-filters.
//
// The tool's value is the SECOND column. A tool that only reports "test filters
// on something production never writes" drowns the one real defect in dozens of
// deliberate synthetic events. The split is what makes it usable, so the split
// is what gets tested hardest here.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyze } from "../lib/dead-filters.mjs";

const project = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gbb-df-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
};

// ── THE DEFECT ──────────────────────────────────────────────────────────────

test("THE CORE CASE: a filter on a literal nobody writes is reported", () => {
  const dir = project({
    "app.js": `export const write = (l) => l.push({ type: "event.order.created" });\n`,
    "app.test.js": `const seen = ledger.filter(e => e.type.startsWith("event.billing."));\n`,
  });
  const r = analyze({ roots: [dir], cwd: dir });
  assert.equal(r.dead.length, 1);
  assert.equal(r.dead[0].literal, "event.billing.");
  assert.equal(r.dead[0].line, 1);
});

test("A PREFIX COVERS EVERYTHING BELOW IT — that is not a dead filter", () => {
  const dir = project({
    "app.js": `const t = "event.order.created";\n`,
    "app.test.js": `ledger.filter(e => e.type.startsWith("event.order."));\n`,
  });
  assert.equal(analyze({ roots: [dir], cwd: dir }).dead.length, 0);
});

test("coverage works in both directions: a test literal longer than production's is covered", () => {
  const dir = project({
    "app.js": `const t = "event.order.";\n`,
    "app.test.js": `ledger.filter(e => e.type === "event.order.created");\n`,
  });
  assert.equal(analyze({ roots: [dir], cwd: dir }).dead.length, 0);
});

// ── THE SECOND COLUMN, WHICH IS THE WHOLE POINT ─────────────────────────────

test("A SYNTHETIC EVENT THE TEST WRITES ITSELF IS NOT A DEFECT", () => {
  const dir = project({
    "app.js": `const t = "event.order.created";\n`,
    "app.test.js": `const ledger = [{ type: "event.synthetic.probe" }];\n`
      + `ledger.filter(e => e.type === "event.synthetic.probe");\n`,
  });
  const r = analyze({ roots: [dir], cwd: dir });
  assert.equal(r.dead.length, 0, "written by the test itself — the filter matches by construction");
  assert.equal(r.selfWritten.length, 2, "both occurrences land in the expected column");
});

test("the split survives when both kinds sit in the same file", () => {
  const dir = project({
    "app.js": `const t = "event.order.created";\n`,
    "app.test.js": `const l = [{ type: "event.synthetic.probe" }];\n`
      + `l.filter(e => e.type === "event.synthetic.probe");\n`
      + `l.filter(e => e.type.startsWith("event.ghost."));\n`,
  });
  const r = analyze({ roots: [dir], cwd: dir });
  assert.deepEqual(r.dead.map((d) => d.literal), ["event.ghost."]);
  assert.equal(r.selfWritten.length, 2);
});

test("a literal written in ANOTHER test file does not launder this one", () => {
  const dir = project({
    "app.js": `const t = "event.order.created";\n`,
    "a.test.js": `const l = [{ type: "event.ghost.thing" }];\n`,
    "b.test.js": `l.filter(e => e.type.startsWith("event.ghost."));\n`,
  });
  const r = analyze({ roots: [dir], cwd: dir });
  assert.equal(r.dead.length, 1, "self-written means THIS file, not any file");
  assert.equal(r.dead[0].file, "b.test.js");
});

// ── CONFIGURATION IS THE WHOLE PORTABILITY STORY ────────────────────────────

test("--prefix and --writer-key retarget the tool onto another convention", () => {
  const dir = project({
    "app.js": `const t = { kind: "evt:order:placed" };\n`,
    "app.test.js": `l.filter(e => e.kind.startsWith("evt:billing:"));\n`,
  });
  const r = analyze({ roots: [dir], prefix: "evt:", writerKey: "kind", cwd: dir });
  assert.equal(r.dead.length, 1);
  assert.equal(r.dead[0].literal, "evt:billing:");
});

test("a prefix with regex metacharacters is matched literally, not as a pattern", () => {
  const dir = project({
    "app.js": `const t = "a.b.written";\n`,
    "app.test.js": `l.filter(e => e.type === "a.b.missing");\n`,
  });
  // If "a.b." were treated as a pattern, "axbx" would match too. It must not.
  const r = analyze({ roots: [dir], prefix: "a.b.", cwd: dir });
  assert.equal(r.dead.length, 1);
  assert.equal(r.dead[0].literal, "a.b.missing");
});

test("the test pattern is configurable, and files outside it count as production", () => {
  const dir = project({
    "app.js": `const t = "event.order.created";\n`,
    "app.checks.js": `l.filter(e => e.type.startsWith("event.ghost."));\n`,
  });
  const asProduction = analyze({ roots: [dir], cwd: dir });
  assert.equal(asProduction.dead.length, 0, "not recognised as a test, so it is production");
  const asTest = analyze({ roots: [dir], testPattern: /\.checks\.js$/, cwd: dir });
  assert.equal(asTest.dead.length, 1);
});

test("all three default test spellings are recognised", () => {
  for (const f of ["a.test.js", "a.spec.js", "a.test.mjs"]) {
    const dir = project({
      "app.js": `const t = "event.order.created";\n`,
      [f]: `l.filter(e => e.type.startsWith("event.ghost."));\n`,
    });
    assert.equal(analyze({ roots: [dir], cwd: dir }).dead.length, 1, `${f} was not treated as a test`);
  }
});

// ── THE LIMITS, TESTED AS LIMITS ────────────────────────────────────────────

test("LIMIT: a template literal escapes it on BOTH sides", () => {
  const dir = project({
    "app.js": "const t = `event.${domain}.created`;\n",
    "app.test.js": "l.filter(e => e.type === `event.${domain}.created`);\n",
  });
  const r = analyze({ roots: [dir], cwd: dir });
  assert.equal(r.testLiterals, 0, "documented blind spot: nothing is seen at all");
  assert.equal(r.dead.length, 0, "a non-hit is NOT proof of absence");
});

test("LIMIT: events held in constants are invisible — the BETTER form finds nothing", () => {
  const dir = project({
    "app.js": `export const CREATED = "event.order.created";\n`,
    "app.test.js": `import { CREATED } from "./app.js";\nl.filter(e => e.type === CREATED);\n`,
  });
  const r = analyze({ roots: [dir], cwd: dir });
  assert.equal(r.dead.length, 0);
  assert.equal(r.testLiterals, 0, "a project written this way gets zero hits, and that is blindness");
});

test("LIMIT: a literal in a COMMENT is counted like any other", () => {
  const dir = project({
    "app.js": `const t = "event.order.created";\n`,
    "app.test.js": `// mentions "event.ghost." only in prose\n`,
  });
  assert.equal(analyze({ roots: [dir], cwd: dir }).dead.length, 1, "false-positive class: read the lines");
});

// ── THE SHIPPED EXAMPLE ─────────────────────────────────────────────────────

test("the example project shows both columns, including one commented false positive", () => {
  const r = analyze({ roots: ["fixtures/example-project/src"] });
  assert.equal(r.dead.length, 2, "the real defect on line 44, plus one literal quoted in a comment");
  assert.ok(r.dead.every((d) => d.literal === "event.orders."));
  assert.equal(r.selfWritten.length, 2, "the deliberate synthetic event");
});
