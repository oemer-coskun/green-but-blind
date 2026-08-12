// The effectiveness proof FOR the proof tool.
//
// The core case: a guard that DEMONSTRABLY fires, whose output the tool cannot
// read, must come out UNCLEAR — never "does not fire".

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  classify, parseTap, parseVitestJson, proveMutation, report, VERDICTS, UNCLEAR_REASONS,
} from "../lib/mutation-proof.mjs";

// ── THE CENTRAL CASE: output is unreadable, the guard fires anyway ───────────

test("UNREADABLE OUTPUT from a firing guard => UNCLEAR, never an absence", () => {
  const ESC = String.fromCharCode(27); // NAMED, never raw — control-chars would catch it
  const realFailureButUnreadable = `${ESC}[31m x Invoices > gaps are named${ESC}[0m\n 1 failed | 5 passed\n`;

  assert.equal(parseTap(realFailureButUnreadable).readable, false);
  assert.equal(parseVitestJson(realFailureButUnreadable).readable, false);

  const v = classify({ changed: true, parsed: parseVitestJson(realFailureButUnreadable) });
  assert.equal(v.verdict, "UNCLEAR");
  assert.equal(v.reason, UNCLEAR_REASONS.UNREADABLE);
  // The point: a naive tool would say "does not fire" here.
  assert.ok(!/does not fire|no guard/i.test(JSON.stringify(v)));
});

test("TRUNCATED JSON counts as unreadable, not as green", () => {
  const truncated = '{"numTotalTestSuites":1,"testResults":[{"assertionResults":[{"status":"fai';
  assert.equal(parseVitestJson(truncated).readable, false);
  assert.equal(classify({ changed: true, parsed: parseVitestJson(truncated) }).verdict, "UNCLEAR");
});

// ── DETECTION ───────────────────────────────────────────────────────────────

test("TAP with one failed test => FIRED, with names", () => {
  const tap = "TAP version 13\nnot ok 1 - the seller is a snapshot\nok 2 - something else\n";
  const p = parseTap(tap);
  assert.equal(p.readable, true);
  assert.deepEqual(p.failures, ["the seller is a snapshot"]);
  assert.equal(classify({ changed: true, parsed: p }).verdict, "FIRED");
});

test("TAP does not count the FILE subtest as a second finding", () => {
  const tap = "TAP version 13\nnot ok 1 - a real test\nnot ok 2 - src/orders/orders.test.ts\n";
  assert.deepEqual(parseTap(tap).failures, ["a real test"]);
});

test("TAP filters the file subtest for js, mjs and spec spellings too", () => {
  const tap = [
    "TAP version 13",
    "not ok 1 - a real test",
    "not ok 2 - src/orders.test.js",
    "not ok 3 - src/orders.spec.mjs",
    "not ok 4 - src/thing.test.tsx",
  ].join("\n");
  assert.deepEqual(parseTap(tap).failures, ["a real test"]);
});

test("vitest JSON with one failed test => FIRED, with names", () => {
  const json = JSON.stringify({
    numTotalTestSuites: 1,
    testResults: [{
      assertionResults: [
        { status: "failed", fullName: "Invoices gaps are named" },
        { status: "passed", fullName: "Invoices something else" },
      ],
    }],
  });
  const p = parseVitestJson("noise before\n" + json);
  assert.equal(p.readable, true);
  assert.deepEqual(p.failures, ["Invoices gaps are named"]);
  assert.equal(classify({ changed: true, parsed: p }).verdict, "FIRED");
});

test("vitest JSON without a testResults array is unreadable, not green", () => {
  assert.equal(parseVitestJson('{"numTotalTestSuites":1,"testResults":null}').readable, false);
});

// ── THE RULE ITSELF ─────────────────────────────────────────────────────────

test("A GREEN RUN IS UNCLEAR, not 'does not fire' — the rule this exists for", () => {
  const green = parseTap("TAP version 13\nok 1 - all good\n");
  const v = classify({ changed: true, parsed: green });
  assert.equal(v.verdict, "UNCLEAR");
  assert.equal(v.reason, UNCLEAR_REASONS.NO_FAILURE_OBSERVED);
  // The reason NAMES the other causes, so nobody reads it as an absence.
  assert.match(v.reason, /second sufficient guard/);
});

test("A NO-OP is UNCLEAR — nothing was tested", () => {
  const v = classify({ changed: false, parsed: parseTap("TAP version 13\nok 1 - x\n") });
  assert.equal(v.verdict, "UNCLEAR");
  assert.equal(v.reason, UNCLEAR_REASONS.NO_OP);
});

test("A MISSING ANCHOR is UNCLEAR, never a silent skip", () => {
  const v = classify({ changed: "anchor-missing", parsed: null });
  assert.equal(v.verdict, "UNCLEAR");
  assert.equal(v.reason, UNCLEAR_REASONS.ANCHOR_MISSING);
});

test("THERE IS NO THIRD VERDICT — checked across the whole input matrix", () => {
  const parses = [
    null,
    { readable: false, failures: [] },
    { readable: true, failures: [] },
    { readable: true, failures: ["x"] },
  ];
  for (const changed of [true, false, "anchor-missing"]) {
    for (const parsed of parses) {
      const v = classify({ changed, parsed });
      assert.ok(VERDICTS.includes(v.verdict), `unexpected verdict: ${v.verdict}`);
    }
  }
  assert.deepEqual([...VERDICTS], ["FIRED", "UNCLEAR"]);
});

test("THE REPORT never CLAIMS an absence — not even with nothing but UNCLEAR", () => {
  const text = report([
    { name: "a", verdict: "UNCLEAR", reason: UNCLEAR_REASONS.NO_FAILURE_OBSERVED, failures: [] },
    { name: "b", verdict: "FIRED", reason: null, failures: ["t1"] },
  ]);
  assert.ok(!/does not fire/i.test(text), text);
  assert.match(text, /0 absences claimed/);

  // Every verdict line opens with one of the two permitted words, so there is no
  // line shape left in which a third judgement could be smuggled in.
  for (const line of text.split("\n")) {
    if (!line.trim() || /^\s/.test(line) || /absences claimed/.test(line)) continue;
    assert.match(line, /^(FIRED|UNCLEAR)\s/, `unexpected verdict line: ${line}`);
  }
});

test("the phrase 'no guard' appears ONLY inside an explicit negation", () => {
  // This is the trap the assertion above used to fall into. The reason text
  // deliberately names the wrong conclusion in order to reject it, so a naive
  // substring search for the phrase flags the very sentence that forbids it.
  const reason = UNCLEAR_REASONS.NO_FAILURE_OBSERVED;
  assert.match(reason, /there is no guard/, "the wrong conclusion is named…");
  assert.match(reason, /NOT 'there is no guard'/, "…and it is named only to be rejected");
});

// ── END TO END ──────────────────────────────────────────────────────────────

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "gbb-proof-"));

test("END TO END: a genuinely red run in an unknown format => UNCLEAR + stored full run", () => {
  const dir = tmp();
  const target = path.join(dir, "subject.txt");
  fs.writeFileSync(target, "GUARD_ON\n");
  const logDir = path.join(dir, "logs");
  // A command that really fails (exit 1) whose output is neither TAP nor vitest JSON.
  const cmd = process.platform === "win32"
    ? 'node -e "console.log(String.fromCharCode(27)+\'[31m x FAILED\'); process.exit(1)"'
    : "node -e \"console.log(String.fromCharCode(27)+'[31m x FAILED'); process.exit(1)\"";

  const r = proveMutation({ name: "unreadable", file: target, from: "GUARD_ON", to: "GUARD_OFF", cmd, cwd: dir, kind: "node", logDir });

  assert.equal(r.verdict, "UNCLEAR", "a red but unreadable run must not yield an absence");
  assert.equal(r.reason, UNCLEAR_REASONS.UNREADABLE);
  assert.ok(r.log && fs.existsSync(r.log), "the full run is stored without anyone remembering to");
  assert.match(fs.readFileSync(r.log, "utf8"), /Repeat, full text/);
  assert.equal(fs.readFileSync(target, "utf8"), "GUARD_ON\n", "the file must be written back");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("END TO END: a no-op leaves the file untouched and reports UNCLEAR", () => {
  const dir = tmp();
  const target = path.join(dir, "subject.txt");
  fs.writeFileSync(target, "SAME\n");
  const r = proveMutation({ name: "no-op", file: target, from: "SAME", to: "SAME", cmd: 'node -e ""', cwd: dir, kind: "node", logDir: path.join(dir, "logs") });
  assert.equal(r.verdict, "UNCLEAR");
  assert.equal(r.reason, UNCLEAR_REASONS.NO_OP);
  assert.equal(fs.readFileSync(target, "utf8"), "SAME\n");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("END TO END: the mutation does not survive a crashing command", () => {
  const dir = tmp();
  const target = path.join(dir, "subject.txt");
  fs.writeFileSync(target, "GUARD_ON\n");
  proveMutation({
    name: "crash", file: target, from: "GUARD_ON", to: "GUARD_OFF",
    cmd: "this-command-does-not-exist-anywhere", cwd: dir, kind: "node", logDir: path.join(dir, "logs"),
  });
  assert.equal(fs.readFileSync(target, "utf8"), "GUARD_ON\n", "restored even when the runner blows up");
  fs.rmSync(dir, { recursive: true, force: true });
});
