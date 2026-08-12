// Tests for second-lists.
//
// Two things need proving: that it finds the property regardless of spelling
// (the point of the tool), and that it is honest about the shapes it misses
// (the point of the repository).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyze, findUnions, findStringArrays, strings } from "../lib/second-lists.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "gbb-sl-"));
const project = (files) => {
  const dir = tmp();
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
};

// ── THE PARTS ───────────────────────────────────────────────────────────────

test("strings() reads both quote styles and keeps order", () => {
  assert.deepEqual(strings(`"a", 'b', "c"`), ["a", "b", "c"]);
});

test("findUnions() takes a single-statement union of two or more literals", () => {
  const u = findUnions(`type S = "a" | "b" | "c";`, "f.ts");
  assert.deepEqual([...u.get("f.ts|S")].sort(), ["a", "b", "c"]);
});

test("findUnions() ignores a one-member union — there is nothing to duplicate", () => {
  assert.equal(findUnions(`type S = "a";`, "f.ts").size, 0);
});

// ── THE POINT: the value side is spelling-agnostic ──────────────────────────

test("findStringArrays() finds the same set through four different spellings", () => {
  const spellings = {
    frozen: `const A = Object.freeze(["a", "b"]);`,
    asConst: `const B = ["a", "b"] as const;`,
    annotated: `const C: readonly string[] = ["a", "b"];`,
    bare: `const D = ["a", "b"];`,
  };
  for (const [label, src] of Object.entries(spellings)) {
    const found = [...findStringArrays(src, "f.ts").values()];
    assert.equal(found.length, 1, `${label} was not found`);
    assert.deepEqual([...found[0]].sort(), ["a", "b"], `${label} produced the wrong set`);
  }
});

test("findStringArrays() names the array after the constant it is assigned to", () => {
  const keys = [...findStringArrays(`const STATUSES = ["a", "b"] as const;`, "f.ts").keys()];
  assert.match(keys[0], /\|STATUSES@1$/);
});

test("findStringArrays() refuses arrays that are not purely strings", () => {
  for (const src of [`const A = ["a", 1];`, `const B = ["a", ...rest];`, `const C = ["a", fn()];`]) {
    assert.equal(findStringArrays(src, "f.ts").size, 0, src);
  }
});

// ── THE VERDICT ─────────────────────────────────────────────────────────────

test("a union and an array with the SAME set in one module is IDENTICAL", () => {
  const dir = project({
    "status.ts": `export type S = "a" | "b" | "c";\nexport const S_LIST = ["a", "b", "c"] as const;\n`,
  });
  const r = analyze({ root: dir });
  assert.equal(r.identical.length, 1);
  assert.equal(r.identical[0].type, "S");
  assert.deepEqual(r.identical[0].literals, ["a", "b", "c"]);
  assert.equal(r.overlapping.length, 0);
});

test("THE SAME SET IN TWO DIFFERENT MODULES IS NOT A HIT", () => {
  const dir = project({
    "a.ts": `export type S = "a" | "b" | "c";\n`,
    "b.ts": `export const LIST = ["a", "b", "c"] as const;\n`,
  });
  const r = analyze({ root: dir });
  assert.equal(r.identical.length, 0, "two truths in two modules are not the property this measures");
});

test("a partial overlap is reported separately and NOT judged", () => {
  const dir = project({
    "s.ts": `export type S = "a" | "b" | "c";\nexport const ACTIVE = ["a", "b"] as const;\n`,
  });
  const r = analyze({ root: dir });
  assert.equal(r.identical.length, 0);
  assert.equal(r.overlapping.length, 1);
  assert.deepEqual(r.overlapping[0].onlyUnion, ["c"]);
  assert.deepEqual(r.overlapping[0].onlyArray, []);
});

test("an overlap of exactly one literal is below the threshold and stays quiet", () => {
  const dir = project({
    "s.ts": `export type S = "a" | "z";\nexport const OTHER = ["a", "q"] as const;\n`,
  });
  assert.equal(analyze({ root: dir }).overlapping.length, 0);
});

// ── THE LIMITS, TESTED AS LIMITS ────────────────────────────────────────────
//
// These assert that the tool MISSES things. That is not a bug being enshrined:
// it is the boundary written down where it can be checked, so nobody reads a
// clean run as "there is nothing there".

test("LIMIT: a derived type is invisible — it is the fix, not the finding", () => {
  const dir = project({
    "s.ts": `export const LIST = ["a", "b", "c"] as const;\nexport type S = (typeof LIST)[number];\n`,
  });
  const r = analyze({ root: dir });
  assert.equal(r.identical.length, 0, "the correct form must not be reported as a defect");
});

test("LIMIT: a MULTI-LINE union escapes the regex entirely", () => {
  const dir = project({
    "s.ts": `export type S =\n  | "a"\n  | "b";\nexport const LIST = ["a", "b"] as const;\n`,
  });
  const r = analyze({ root: dir });
  assert.equal(r.identical.length, 0, "documented blind spot — a non-hit is NOT proof of absence");
  assert.equal(r.unions, 0, "the union was never seen in the first place");
});

test("LIMIT: a comment inside the union hides it", () => {
  const dir = project({
    "s.ts": `export type S = "a" | /* why */ "b";\nexport const LIST = ["a", "b"] as const;\n`,
  });
  assert.equal(analyze({ root: dir }).identical.length, 0, "documented blind spot");
});

// ── PLUMBING ────────────────────────────────────────────────────────────────

test("a missing root yields empty results rather than an exception", () => {
  const r = analyze({ root: path.join(tmp(), "nope") });
  assert.deepEqual([r.unions, r.arrays, r.identical.length], [0, 0, 0]);
});

test("ignored directories are not descended into", () => {
  const dir = project({
    "node_modules/dep.ts": `export type S = "a" | "b";\nexport const L = ["a", "b"] as const;\n`,
  });
  assert.equal(analyze({ root: dir }).identical.length, 0);
});

test("the shipped example project reports exactly one identical pair", () => {
  const r = analyze({ root: "fixtures/example-project/src" });
  assert.equal(r.identical.length, 1, "the planted defect in status.ts");
  assert.equal(r.identical[0].type, "OrderStatus");
});
