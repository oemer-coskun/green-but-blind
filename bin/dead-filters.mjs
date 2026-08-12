#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// dead-filters — command line tool.
//
// Finds test assertions that filter on an event literal nobody writes. If the
// filter never matches, the assertion compares the empty set against the empty
// set: it cannot go red, and it still claims to check something.
//
// See ../lib/dead-filters.mjs for the limits — chiefly: this is a LITERAL
// SEARCH. Events built from template literals or held in constants are
// invisible to it, on both sides.
//
// A hit is solid. A non-hit is NOT — the number is a LOWER BOUND. And a number
// alone says nothing: the lines have to be read.
//
// EXIT CODE
//   Always 0, even with findings. This is a tool, not a gate: its search is
//   incomplete, so a green exit would mean "found nothing", not "there is
//   nothing". Use --json if you want to build on the results.
// ─────────────────────────────────────────────────────────────────────────────

import { parseArgs } from "node:util";
import { analyze } from "../lib/dead-filters.mjs";

const HELP = `dead-filters — find test assertions that can never go red

USAGE
  dead-filters [--root DIR]... [options]

OPTIONS
  --root <dir>        Directory to scan. Repeatable.        (default: src)
  --prefix <str>      Common start of your event literals.  (default: event.)
  --writer-key <key>  Property through which an event is WRITTEN. (default: type)
  --ext <.ext>        File extension. Repeatable.           (default: .ts .tsx .js .jsx .mjs)
  --ignore <dir>      Directory name to skip. Repeatable.   (default: node_modules, dist, .git)
  --test-pattern <re> Regex marking a file as a test.  (default: \\.(test|spec)\\.[cm]?[jt]sx?$)
  --literal-chars <s> Regex character class body for what may follow the prefix
                      inside a literal.                (default: A-Za-z0-9_.:/-)
  --json              Machine-readable output.
  -h, --help          This text.

THE DEFECT IT FINDS

    // production writes:  { type: "event.platform.invoice.created" }
    const seen = ledger.filter(e => e.type.startsWith("event.billing."));
    assert.equal(seen.length, 0);   // <- passes. Always. Forever.

  The filter matches nothing, so the assertion compares 0 against 0. It is green
  and it measures nothing.

TWO COLUMNS, AND THE SECOND IS THE DECIDING ONE
  FILTER ONLY   the literal appears only in a filter — never written, not in the
                test, not in production. This is the finding.
  SELF-WRITTEN  the test writes the literal itself (via --writer-key). The filter
                matches by construction. Expected, not a finding.

  Without that split the real defect hides among dozens of deliberate synthetic
  events.

--prefix AND --writer-key ARE THE WHOLE CONFIGURATION
  This tool assumes your events are string literals sharing a common start, and
  that they are written through one named property:

    { type: "event.user.created" }      --prefix "event."  --writer-key "type"
    { kind: "evt:order:placed" }        --prefix "evt:"    --writer-key "kind"

  If your project names every event through a constant instead, this tool finds
  nothing — and that is blindness, not a clean bill of health. Constants are the
  BETTER form; they simply cannot drift, so there is nothing here to find.

THREE CLASSES OF FALSE POSITIVE
  Permission scopes (\`scope: ["event.x"]\`), namespaces, and literals inside
  comments all look the same to a literal search. Read the lines.

EXAMPLE
  dead-filters --root src
  dead-filters --root src --prefix "evt:" --writer-key kind
`;

let parsed;
try {
  parsed = parseArgs({
    options: {
      root: { type: "string", multiple: true, default: [] },
      prefix: { type: "string", default: "event." },
      "writer-key": { type: "string", default: "type" },
      ext: { type: "string", multiple: true, default: [] },
      ignore: { type: "string", multiple: true, default: [] },
      "test-pattern": { type: "string" },
      "literal-chars": { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });
} catch (e) {
  console.error(`dead-filters: ${e.message}\n`);
  console.error(HELP);
  process.exit(2);
}

const { values } = parsed;
if (values.help) {
  console.log(HELP);
  process.exit(0);
}

let testPattern;
try {
  testPattern = values["test-pattern"] ? new RegExp(values["test-pattern"]) : undefined;
} catch (e) {
  console.error(`dead-filters: --test-pattern is not a valid regex — ${e.message}`);
  process.exit(2);
}

const roots = values.root.length ? values.root : ["src"];
const extensions = values.ext.length ? values.ext.map((e) => (e.startsWith(".") ? e : `.${e}`)) : undefined;
const ignoreDirs = values.ignore.length ? values.ignore : undefined;

const result = analyze({
  roots,
  prefix: values.prefix,
  writerKey: values["writer-key"],
  ...(extensions ? { extensions } : {}),
  ...(ignoreDirs ? { ignoreDirs } : {}),
  ...(testPattern ? { testPattern } : {}),
  ...(values["literal-chars"] ? { literalChars: values["literal-chars"] } : {}),
});

if (values.json) {
  console.log(JSON.stringify({ roots, prefix: values.prefix, writerKey: values["writer-key"], ...result }, null, 2));
  process.exit(0);
}

console.log(`Test literals: ${result.testLiterals}   Production literals: ${result.productionLiterals}`);
console.log(`Prefix: "${values.prefix}"   Writer key: "${values["writer-key"]}"\n`);

console.log(`=== FILTER ONLY, NEVER WRITTEN — the assertion checks the empty set: ${result.dead.length} ===`);
for (const d of result.dead) console.log(`  ${d.file}:${d.line}  ${d.literal}`);
if (!result.dead.length) console.log("  (none)");

console.log(`\n=== expected: written by the test ITSELF (synthetic events): ${result.selfWritten.length} ===`);
for (const d of result.selfWritten) console.log(`  ${d.file}:${d.line}  ${d.literal}`);
if (!result.selfWritten.length) console.log("  (none)");

console.log(`\nA hit is solid, a non-hit is NOT — the number is a LOWER BOUND (see --help).`);
console.log(`A number alone says nothing here: the lines have to be read.`);
process.exit(0);
