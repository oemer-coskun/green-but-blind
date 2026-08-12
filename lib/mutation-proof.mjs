// ─────────────────────────────────────────────────────────────────────────────
// mutation-proof — does this guard actually fire?
//
// You break something on purpose, run the tests, and see whether anything turns
// red. That is the whole idea. The value of this tool is not the idea; it is the
// one rule it keeps.
//
// ── THE RULE ─────────────────────────────────────────────────────────────────
//
//     This tool may report FIRED or UNCLEAR.
//     It may NEVER report "does not fire".
//
// ── WHY ──────────────────────────────────────────────────────────────────────
//
// It cannot tell "no test failed" apart from "I could not read the output". An
// earlier version of this tool did not make that distinction, and reported three
// existing guards as missing because it could not parse the test runner's
// coloured output. All three fired.
//
// A claimed absence invites you to build a guard that already exists — and it is
// the more dangerous direction. A MISSING guard eventually becomes visible,
// because a defect gets through. A guard falsely reported as missing never does,
// because everything works and you simply hold a wrong map of your own system.
//
// ── WHY THE RULE STAYS, THOUGH THE PARSING IS NOW CORRECT ────────────────────
//
// Detection now reads machine-readable formats — TAP for `node --test`, JSON for
// vitest — instead of text with colour codes. That makes it correct, but correct
// is not omniscient. A green run after a mutation has at least five possible
// causes, and this tool cannot tell them apart:
//
//   1. There really is no guard.
//   2. The mutation was a no-op and changed nothing.
//   3. A second, independently sufficient guard caught it.
//   4. The mutation was harmless: the test was green over an incidental case.
//   5. The run never reached the tests at all.
//
// Only case 1 would be "does not fire". So the tool reports UNCLEAR and hands
// you the material to decide. A repaired tool that still claims nothing it does
// not know is the goal — not a tool you trust again.
//
// ── WHAT HAPPENS ON UNCLEAR ──────────────────────────────────────────────────
//
// The run is repeated with full output and written to a file. Done by hand, that
// step is forgotten the next time.
//
// ── WHAT A RESULT IS WORTH ───────────────────────────────────────────────────
//
//   FIRED   is solid: a test went red while the code was mutated. Check that the
//           red test is the one you expected — see `report()`'s named failures.
//           A run can be red because a DIFFERENT assertion tripped first.
//   UNCLEAR is not a verdict about your code. It is a verdict about this tool's
//           ability to see. A human reads the log and decides.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

/** The COMPLETE set of possible verdicts. There is no third one, and that there is none is tested. */
export const VERDICTS = Object.freeze(["FIRED", "UNCLEAR"]);

/** Why it is unclear — for the human who decides next. Never "there is no guard". */
export const UNCLEAR_REASONS = Object.freeze({
  ANCHOR_MISSING: "The anchor text was not in the file — the mutation was never applied.",
  NO_OP: "The mutation did not change the file (no-op) — nothing was tested.",
  UNREADABLE: "The test run's output could not be parsed — whether a test failed is NOT determinable.",
  NO_FAILURE_OBSERVED:
    "No test failed. This is NOT 'there is no guard': it may be a second sufficient guard, " +
    "a harmless mutation, or a test that stayed green for an unrelated reason. A human decides.",
});

// ── DETECTION ────────────────────────────────────────────────────────────────

/** TAP 13, as `node --test --test-reporter=tap` writes it. `not ok N - name` is a failed test. */
export function parseTap(out) {
  if (typeof out !== "string" || !/^TAP version/m.test(out)) return { readable: false, failures: [] };
  const failures = [...out.matchAll(/^not ok \d+ - (.+)$/gm)]
    .map((m) => m[1].trim())
    // TAP also reports the FILE subtest as failed when a test inside it failed — not a second finding.
    .filter((n) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(n));
  return { readable: true, failures };
}

/** vitest `--reporter=json`. The report is ONE JSON object in the output, possibly preceded by noise. */
export function parseVitestJson(out) {
  if (typeof out !== "string") return { readable: false, failures: [] };
  const start = out.indexOf('{"numTotalTestSuites"');
  if (start < 0) return { readable: false, failures: [] };
  let report;
  try {
    report = JSON.parse(out.slice(start, out.lastIndexOf("}") + 1));
  } catch {
    return { readable: false, failures: [] }; // truncated or corrupted — do NOT read as "green"
  }
  if (!Array.isArray(report.testResults)) return { readable: false, failures: [] };
  const failures = [];
  for (const suite of report.testResults) {
    for (const a of suite.assertionResults ?? []) {
      if (a.status === "failed") failures.push(a.fullName ?? a.title ?? "(unnamed)");
    }
  }
  return { readable: true, failures };
}

// ── THE VERDICT ──────────────────────────────────────────────────────────────

/**
 * Pure function, so it is testable without starting a process.
 *
 * `changed` — did the mutation really change the file? (or the string "anchor-missing")
 * `parsed`  — { readable, failures } from one of the parsers
 *
 * ALWAYS returns one of VERDICTS. There is no branch that claims an absence.
 */
export function classify({ changed, parsed }) {
  if (changed === "anchor-missing") return { verdict: "UNCLEAR", reason: UNCLEAR_REASONS.ANCHOR_MISSING, failures: [] };
  if (!changed) return { verdict: "UNCLEAR", reason: UNCLEAR_REASONS.NO_OP, failures: [] };
  if (!parsed || !parsed.readable) return { verdict: "UNCLEAR", reason: UNCLEAR_REASONS.UNREADABLE, failures: [] };
  if (parsed.failures.length > 0) return { verdict: "FIRED", reason: null, failures: parsed.failures };
  return { verdict: "UNCLEAR", reason: UNCLEAR_REASONS.NO_FAILURE_OBSERVED, failures: [] };
}

// ── THE RUN ──────────────────────────────────────────────────────────────────

function run(cmd, cwd) {
  try {
    return { out: execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), code: 0 };
  } catch (e) {
    return { out: String(e.stdout ?? "") + String(e.stderr ?? ""), code: e.status ?? 1 };
  }
}

/**
 * Apply one mutation, run the command, judge — and ALWAYS write the file back.
 *
 * `kind` selects parser and machine-readable reporter. On UNCLEAR the run is
 * REPEATED without a reporter and the full output is stored, so a human can read
 * it without reinventing the step.
 */
export function proveMutation({ name, file, from, to, cmd, cwd = ".", kind = "node", logDir = ".proof-logs" }) {
  const original = fs.readFileSync(file, "utf8");
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const anchor = from.replace(/\n/g, eol);
  const replacement = to.replace(/\n/g, eol);

  if (!original.includes(anchor)) {
    return { name, ...classify({ changed: "anchor-missing", parsed: null }) };
  }
  const mutated = original.replace(anchor, replacement);
  const changed = mutated !== original;

  let verdict;
  let rawOut = "";
  try {
    if (changed) {
      fs.writeFileSync(file, mutated);
      // The flag MUST come before the file path. `node --test file.js --test-reporter=tap` passes the
      // flag to the TEST FILE instead of to node; the output then stays in the default format and the
      // parser sees no TAP. Found because the tool reported UNCLEAR and stored the full run — it did
      // not claim there was no guard there. That is exactly what the rule is for.
      const reporter = kind === "vitest"
        ? `${cmd} --reporter=json`
        : cmd.replace("--test ", "--test --test-reporter=tap ");
      const r = run(reporter, cwd);
      rawOut = r.out;
      const parsed = kind === "vitest" ? parseVitestJson(r.out) : parseTap(r.out);
      verdict = classify({ changed, parsed });

      // ON UNCLEAR: repeat, in full, and store it. Automatically — not as a step someone must remember.
      if (verdict.verdict === "UNCLEAR") {
        const again = run(cmd, cwd);
        fs.mkdirSync(logDir, { recursive: true });
        const f = path.join(logDir, `${name.replace(/[^a-zA-Z0-9._-]+/g, "_")}.log`);
        fs.writeFileSync(f, `# ${name}\n# ${verdict.reason}\n\n## Run with reporter\n${rawOut}\n\n## Repeat, full text\n${again.out}\n`);
        verdict = { ...verdict, log: f };
      }
    } else {
      verdict = classify({ changed: false, parsed: null });
    }
  } finally {
    fs.writeFileSync(file, original); // the mutation NEVER survives the run
  }
  return { name, ...verdict };
}

/** Line-by-line report. The words "does not fire" do not appear, because there is no output for it. */
export function report(results) {
  const lines = [];
  for (const r of results) {
    lines.push(r.verdict === "FIRED"
      ? `FIRED    ${r.name}  (${r.failures.length} red: ${r.failures.slice(0, 2).join(" | ")})`
      : `UNCLEAR  ${r.name}  — ${r.reason}${r.log ? `\n         full run: ${r.log}` : ""}`);
  }
  const unclear = results.filter((r) => r.verdict === "UNCLEAR").length;
  lines.push(``, `${results.length - unclear} FIRED · ${unclear} UNCLEAR · 0 absences claimed (there is no such output).`);
  return lines.join("\n");
}
