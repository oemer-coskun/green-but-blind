#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// mutation-proof — command line runner.
//
// Breaks your code on purpose, one mutation at a time, and reports whether a
// test went red. See ../lib/mutation-proof.mjs for the rule this obeys:
// it may say FIRED or UNCLEAR, never "does not fire".
//
// WHAT A RESULT IS WORTH
//   FIRED    solid — a test went red while the code was mutated. Read the named
//            failures: a run can be red because a DIFFERENT assertion tripped
//            first, which would mean your guard is still unproven.
//   UNCLEAR  says nothing about your code. It says this tool could not see.
//            The full run is written to the log directory for you to read.
//
// EXIT CODE
//   0  every mutation FIRED
//   1  at least one UNCLEAR — something needs a human, not that a guard is missing
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { proveMutation, report } from "../lib/mutation-proof.mjs";

const HELP = `mutation-proof — prove that a guard actually fires

USAGE
  mutation-proof --spec <file.json> [options]

OPTIONS
  --spec <file>      Mutation spec, JSON. Required. Format below.
  --log-dir <dir>    Where full runs are stored on UNCLEAR.  (default: .proof-logs)
  --only <name>      Run only the mutation with this name. Repeatable.
  -h, --help         This text.

SPEC FORMAT
  {
    "cwd":  ".",                       // project root, relative to the spec file
    "cmd":  "node --test test/",       // how to run the tests
    "kind": "node",                    // "node" (TAP) or "vitest" (JSON)
    "mutations": [
      {
        "name": "auth guard rejects empty token",
        "file": "src/auth.js",         // relative to cwd
        "from": "if (!token) throw",   // exact anchor text, must appear verbatim
        "to":   "if (false) throw"     // what replaces it
      }
    ]
  }

  The file is always written back, even if the run crashes. A mutation never
  survives. If "from" does not appear in the file, the result is UNCLEAR
  (anchor missing) — never a silent skip.

EXAMPLE
  mutation-proof --spec fixtures/example-project/mutations.json
`;

let parsed;
try {
  parsed = parseArgs({
    options: {
      spec: { type: "string" },
      "log-dir": { type: "string", default: ".proof-logs" },
      only: { type: "string", multiple: true, default: [] },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });
} catch (e) {
  console.error(`mutation-proof: ${e.message}\n`);
  console.error(HELP);
  process.exit(2);
}

const { values } = parsed;
if (values.help) {
  console.log(HELP);
  process.exit(0);
}
if (!values.spec) {
  console.error("mutation-proof: --spec is required.\n");
  console.error(HELP);
  process.exit(2);
}

let spec;
try {
  spec = JSON.parse(fs.readFileSync(values.spec, "utf8"));
} catch (e) {
  console.error(`mutation-proof: cannot read spec ${values.spec} — ${e.message}`);
  process.exit(2);
}

if (!Array.isArray(spec.mutations) || spec.mutations.length === 0) {
  console.error(`mutation-proof: ${values.spec} has no "mutations" array.`);
  process.exit(2);
}
if (typeof spec.cmd !== "string" || !spec.cmd.trim()) {
  console.error(`mutation-proof: ${values.spec} has no "cmd" — there is nothing to run.`);
  process.exit(2);
}

// `cwd` is relative to the spec file, so a spec can sit next to the project it mutates.
const specDir = path.dirname(path.resolve(values.spec));
const cwd = path.resolve(specDir, spec.cwd ?? ".");
const kind = spec.kind ?? "node";

const selected = values.only.length
  ? spec.mutations.filter((m) => values.only.includes(m.name))
  : spec.mutations;

if (!selected.length) {
  console.error(`mutation-proof: --only matched no mutation. Available: ${spec.mutations.map((m) => m.name).join(", ")}`);
  process.exit(2);
}

console.log(`mutation-proof — ${selected.length} mutation(s) against \`${spec.cmd}\` in ${cwd}\n`);

const results = [];
for (const m of selected) {
  for (const field of ["name", "file", "from", "to"]) {
    if (typeof m[field] !== "string") {
      console.error(`mutation-proof: mutation ${JSON.stringify(m.name ?? "(unnamed)")} is missing "${field}".`);
      process.exit(2);
    }
  }
  const file = path.resolve(cwd, m.file);
  if (!fs.existsSync(file)) {
    console.error(`mutation-proof: ${m.name} — file not found: ${file}`);
    process.exit(2);
  }
  // Progress on stderr, so `--json`-style piping of stdout stays clean. Only when
  // someone is watching: in a log file a carriage return produces one unreadable line.
  if (process.stderr.isTTY) process.stderr.write(`  running: ${m.name}`.padEnd(78).slice(0, 78) + "\r");
  results.push(proveMutation({
    name: m.name, file, from: m.from, to: m.to,
    cmd: spec.cmd, cwd, kind, logDir: path.resolve(values["log-dir"]),
  }));
}
if (process.stderr.isTTY) process.stderr.write(" ".repeat(78) + "\r");

console.log(report(results));
process.exit(results.some((r) => r.verdict === "UNCLEAR") ? 1 : 0);
