// Tests for the control-chars gate.
//
// The gate's whole value is that it goes red in four situations and green in
// exactly one. Each of the four is tested here, including the subtlest: a
// missing baseline must be RED, because a guard that turns green when its
// subject disappears guards nothing.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scan, loadBaseline, compare, suspicious, name, hex } from "../lib/control-chars.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "gbb-cc-"));
const CH = (cp) => String.fromCharCode(cp); // NAMED, never typed raw

// ── THE CLOSED SET ──────────────────────────────────────────────────────────

test("suspicious() accepts tab, newline and carriage return", () => {
  for (const cp of [0x09, 0x0a, 0x0d]) assert.equal(suspicious(cp), false, `${hex(cp)} structures source`);
});

test("suspicious() catches C0 controls, DEL and the C1 block", () => {
  for (const cp of [0x00, 0x07, 0x08, 0x0b, 0x0c, 0x1b, 0x7f, 0x80, 0x9f]) {
    assert.equal(suspicious(cp), true, `${hex(cp)} must be caught`);
  }
});

test("suspicious() catches zero-width and the Trojan Source bidi class", () => {
  for (const cp of [0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x200e, 0x202e, 0x2066, 0x2069]) {
    assert.equal(suspicious(cp), true, `${hex(cp)} must be caught`);
  }
});

test("suspicious() leaves ordinary text alone, including non-ASCII", () => {
  for (const ch of "abcZ0 ,.-ÖüßéМир漢字🙂") {
    assert.equal(suspicious(ch.codePointAt(0)), false, `${ch} is not a control character`);
  }
});

test("every caught code point has a name or is honestly labelled unnamed", () => {
  assert.equal(name(0x08), "BACKSPACE");
  assert.equal(name(0x202e), "RIGHT-TO-LEFT OVERRIDE");
  assert.equal(name(0x9f), "(unnamed)");
  assert.equal(hex(0x200b), "0x200B");
});

// ── SCANNING ────────────────────────────────────────────────────────────────

test("scan() reads CODE POINTS, not bytes — a zero-width char is one hit, not three", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "a.js"), `const x = "a${CH(0x200b)}b";\n`);
  const { files, found } = scan({ roots: [path.join(dir, "src")], cwd: dir });
  assert.equal(files, 1);
  assert.equal(found.length, 1);
  assert.equal(found[0].codePoint, 0x200b);
  assert.equal(found[0].count, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("scan() reports line and column, and counts repeats in one entry", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "a.md"), `clean\nx${CH(0x200b)}y${CH(0x200b)}z\n`);
  const { found } = scan({ roots: [dir], cwd: dir });
  assert.equal(found.length, 1, "same file + same code point is ONE entry");
  assert.equal(found[0].count, 2);
  assert.deepEqual(found[0].where, ["2:2", "2:4"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("scan() honours the extension filter and the ignore list", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "node_modules"));
  fs.writeFileSync(path.join(dir, "seen.js"), `a${CH(0x07)}b`);
  fs.writeFileSync(path.join(dir, "skipped.bin"), `a${CH(0x07)}b`);
  fs.writeFileSync(path.join(dir, "node_modules", "dep.js"), `a${CH(0x07)}b`);
  const { found } = scan({ roots: [dir], extensions: [".js"], cwd: dir });
  assert.equal(found.length, 1);
  assert.equal(found[0].file, "seen.js");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("scan() skips a root that does not exist instead of crashing", () => {
  const { files, found } = scan({ roots: ["definitely/not/here"] });
  assert.equal(files, 0);
  assert.deepEqual(found, []);
});

test("OVERLAPPING ROOTS do not double the counts", () => {
  // Found by running the gate with `--root . --root fixtures`: the same file was read
  // twice and every count doubled. A gate that goes red because of how it was invoked
  // rather than what it found is a gate people switch off.
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "a.js"), `x${CH(0x200b)}y`);
  const once = scan({ roots: [dir], cwd: dir });
  const twice = scan({ roots: [dir, path.join(dir, "src")], cwd: dir });
  assert.equal(twice.files, once.files, "the file is counted once");
  assert.equal(twice.found[0].count, 1, "and its hits are counted once");
  assert.deepEqual(twice.found[0].where, ["1:2"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("two different files with the same code point stay two entries", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "a.js"), `x${CH(0x200b)}`);
  fs.writeFileSync(path.join(dir, "b.js"), `x${CH(0x200b)}`);
  const { found } = scan({ roots: [dir], cwd: dir });
  assert.equal(found.length, 2);
});

// ── THE BASELINE ────────────────────────────────────────────────────────────

const write = (dir, obj) => {
  const f = path.join(dir, "baseline.json");
  fs.writeFileSync(f, typeof obj === "string" ? obj : JSON.stringify(obj));
  return f;
};

test("A MISSING BASELINE IS RED — the subtlest of the four", () => {
  const r = loadBaseline(path.join(tmp(), "nope.json"));
  assert.equal(r.ok, false);
  assert.match(r.error, /missing or unreadable/);
  assert.match(r.error, /guards nothing/, "the error must say WHY, not just that");
});

test("a baseline that is not JSON is red", () => {
  const dir = tmp();
  const r = loadBaseline(write(dir, "{ not json"));
  assert.equal(r.ok, false);
  assert.match(r.error, /not valid JSON/);
});

test("a baseline that is not an array is red", () => {
  const dir = tmp();
  const r = loadBaseline(write(dir, { file: "a.js" }));
  assert.equal(r.ok, false);
  assert.match(r.error, /must be an array/);
});

test("AN ENTRY WITHOUT A REASON IS REJECTED — a tolerance is not a decision", () => {
  const dir = tmp();
  const r = loadBaseline(write(dir, [{ file: "a.js", codePoint: 8203, count: 1 }]));
  assert.equal(r.ok, false);
  assert.match(r.error, /reason/);
});

test("an entry with a blank reason is rejected too", () => {
  const dir = tmp();
  const r = loadBaseline(write(dir, [{ file: "a.js", codePoint: 8203, count: 1, reason: "   " }]));
  assert.equal(r.ok, false);
});

test("a complete entry is accepted", () => {
  const dir = tmp();
  const r = loadBaseline(write(dir, [{ file: "a.js", codePoint: 8203, count: 1, reason: "test datum, verified" }]));
  assert.equal(r.ok, true);
  assert.equal(r.entries.length, 1);
});

// ── THE RATCHET: four ways to be red, one to be green ───────────────────────

const hit = (file, codePoint, count) => ({ file, codePoint, count, where: [] });
const base = (file, codePoint, count) => ({ file, codePoint, count, reason: "because" });

test("no deviation is GREEN", () => {
  const r = compare([hit("a.js", 8203, 2)], [base("a.js", 8203, 2)]);
  assert.equal(r.clean, true);
  assert.deepEqual([r.newHits, r.changed, r.gone], [[], [], []]);
});

test("A NEW HIT is red", () => {
  const r = compare([hit("a.js", 8203, 1), hit("b.js", 8, 1)], [base("a.js", 8203, 1)]);
  assert.equal(r.clean, false);
  assert.equal(r.newHits.length, 1);
  assert.equal(r.newHits[0].file, "b.js");
});

test("A HIGHER COUNT is red", () => {
  const r = compare([hit("a.js", 8203, 3)], [base("a.js", 8203, 1)]);
  assert.equal(r.clean, false);
  assert.deepEqual(r.changed.map((c) => c.now), [3]);
});

test("A LOWER COUNT IS ALSO RED — the shrink pressure", () => {
  const r = compare([hit("a.js", 8203, 1)], [base("a.js", 8203, 3)]);
  assert.equal(r.clean, false, "getting better still requires tightening the baseline");
  assert.equal(r.changed[0].now, 1);
});

test("A VANISHED ENTRY is red — a ratchet that does not shrink is a tolerance list", () => {
  const r = compare([], [base("a.js", 8203, 1)]);
  assert.equal(r.clean, false);
  assert.equal(r.gone.length, 1);
});

test("identity is file + code point, so the same file with two characters is two entries", () => {
  const r = compare([hit("a.js", 8203, 1), hit("a.js", 8, 1)], [base("a.js", 8203, 1)]);
  assert.equal(r.newHits.length, 1);
  assert.equal(r.newHits[0].codePoint, 8);
});

test("the key separator does not collide across file/code-point boundaries", () => {
  // "x" + 12  and  "x1" + 2  must not collapse into one entry.
  const r = compare([hit("x", 12, 1), hit("x1", 2, 1)], []);
  assert.equal(r.newHits.length, 2, "a naive string concat would report only one");
});

// ── THE REPOSITORY EATS ITS OWN COOKING ─────────────────────────────────────

test("this repository's own baseline is valid and its single entry is justified", () => {
  const r = loadBaseline("control-chars.baseline.json");
  assert.equal(r.ok, true, r.error);
  assert.ok(r.entries.length >= 1);
  for (const e of r.entries) assert.ok(e.reason.trim().length > 20, "a real reason, not a shrug");
});
