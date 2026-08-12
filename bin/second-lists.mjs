#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// second-lists — command line tool.
//
// Finds the same string literals written twice in one module: once as a union
// type, once as an array value. See ../lib/second-lists.mjs for the limits —
// chiefly: this is a REGEX, not a parser. Multi-line unions, unions with
// comments inside, and template literal types all escape it.
//
// A hit is solid. A non-hit is NOT — the number is a LOWER BOUND.
//
// EXIT CODE
//   Always 0, even with findings. This is a tool, not a gate: its parsing is
//   incomplete, so a green exit would mean "found nothing", not "there is
//   nothing". Use --json if you want to build on the results.
// ─────────────────────────────────────────────────────────────────────────────

import { parseArgs } from "node:util";
import { analyze } from "../lib/second-lists.mjs";

const HELP = `second-lists — find the same strings written twice: once as a type, once as a value

USAGE
  second-lists [--root DIR] [options]

OPTIONS
  --root <dir>     Directory to scan.                     (default: src)
  --ext <.ext>     File extension. Repeatable.            (default: .ts, .tsx)
  --ignore <dir>   Directory name to skip. Repeatable.    (default: node_modules, dist, .git)
  --json           Machine-readable output.
  -h, --help       This text.

WHAT IT LOOKS FOR
  Two truths in one module:

    type Status = "open" | "closed" | "archived";              <- the type
    const STATUSES = ["open", "closed", "archived"] as const;  <- the value

  Add a fourth state to one and the other silently disagrees. The fix is to
  derive one from the other:

    const STATUSES = ["open", "closed", "archived"] as const;
    type Status = (typeof STATUSES)[number];

  Derived types are invisible to this tool — by design. They are the fix, not
  the finding.

TWO COLUMNS
  IDENTICAL    the sets are equal. A second truth.
  OVERLAPPING  they share at least two literals but differ. Could be a deliberate
               named subset, could be drift. This one needs a human.

WHY IT IS NOT A GATE
  Its parsing is fragile, so it produces false negatives — as a gate it would
  report green without having measured, which is the exact defect this repository
  is about. And legitimate set equality produces false positives, whose remedy
  would be an exception list: a second truth, to prevent a second truth.

EXAMPLE
  second-lists --root src
  second-lists --root fixtures/example-project/src --json
`;

let parsed;
try {
  parsed = parseArgs({
    options: {
      root: { type: "string" },
      ext: { type: "string", multiple: true, default: [] },
      ignore: { type: "string", multiple: true, default: [] },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });
} catch (e) {
  console.error(`second-lists: ${e.message}\n`);
  console.error(HELP);
  process.exit(2);
}

const { values } = parsed;
if (values.help) {
  console.log(HELP);
  process.exit(0);
}

const root = values.root ?? "src";
const extensions = values.ext.length ? values.ext.map((e) => (e.startsWith(".") ? e : `.${e}`)) : [".ts", ".tsx"];
const ignoreDirs = values.ignore.length ? values.ignore : ["node_modules", "dist", ".git"];

const result = analyze({ root, extensions, ignoreDirs });

if (values.json) {
  console.log(JSON.stringify({ root, ...result }, null, 2));
  process.exit(0);
}

console.log(`Unions found: ${result.unions}   String arrays found: ${result.arrays}\n`);

console.log(`=== IDENTICAL (second list == union): ${result.identical.length} ===`);
for (const i of result.identical) {
  console.log(`  ${i.file}  type ${i.type}  ==  ${i.value}   [${i.literals.length}] ${JSON.stringify(i.literals)}`);
}
if (!result.identical.length) console.log("  (none)");

console.log(`\n=== OVERLAPPING (not equal — check whether it is a deliberate subset or DRIFT): ${result.overlapping.length} ===`);
for (const o of result.overlapping) {
  console.log(`  ${o.file}  type ${o.type}  vs  ${o.value}`);
  console.log(`      only in union: ${JSON.stringify(o.onlyUnion)}`);
  console.log(`      only in array: ${JSON.stringify(o.onlyArray)}`);
}
if (!result.overlapping.length) console.log("  (none)");

console.log(`\nA hit is solid, a non-hit is NOT — the number is a LOWER BOUND (see --help).`);
process.exit(0);
