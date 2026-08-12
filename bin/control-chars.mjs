#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// control-chars — command line gate.
//
// Finds RAW control characters in source: C0 controls except tab/newline/CR,
// DEL, the C1 block, zero-width characters, and the bidirectional overrides of
// the "Trojan Source" class. See ../lib/control-chars.mjs for what it does not
// find — chiefly: a WRONG ESCAPE (`\x08` spelled out) is invisible to it.
//
// A hit is solid. A non-hit only means: not in these roots, not in these
// extensions, not as a raw character.
//
// EXIT CODE
//   0  green — no deviation from the baseline (or --report, which never judges)
//   1  red   — a new hit, a changed count, a vanished entry, or no readable baseline
// ─────────────────────────────────────────────────────────────────────────────

import { parseArgs } from "node:util";
import { scan, loadBaseline, compare, name, hex, DEFAULT_EXTENSIONS, DEFAULT_IGNORE_DIRS } from "../lib/control-chars.mjs";

const HELP = `control-chars — find raw control characters in source, as a shrinking ratchet

USAGE
  control-chars [--root DIR]... [options]          check against the baseline
  control-chars --report [--root DIR]...           measure and print, never judge

OPTIONS
  --root <dir>       Directory to scan. Repeatable.        (default: src)
  --ext <.ext>       File extension to read. Repeatable.   (default: ${DEFAULT_EXTENSIONS.length} common ones)
  --ignore <dir>     Directory name to skip. Repeatable.   (default: ${DEFAULT_IGNORE_DIRS.join(", ")})
  --baseline <file>  The baseline.        (default: control-chars.baseline.json)
  --report           Measure and print, exit 0 always. No baseline needed.
  -h, --help         This text.

THE BASELINE
  A JSON array. Every entry needs file, codePoint, count and a non-empty
  "reason" — an entry without a reason is not a decision, it is a tolerance.

    [
      {
        "file": "src/parser.js",
        "codePoint": 8203,
        "count": 2,
        "reason": "Deliberate: a raw ZERO WIDTH SPACE as test data for the
                   normaliser that strips it. Verified: blank the constant and
                   two tests fail."
      }
    ]

  Identity is file + code point + COUNT, not file + line. Line numbers shift on
  every harmless edit, and a gate that fires for the wrong reason gets switched
  off.

THE RATCHET — four ways to go red
  a new hit · a higher count · a LOWER count without updating the baseline ·
  a baseline entry that no longer exists.

  The last two are the shrink pressure. And a missing baseline is red, not
  green: a guard that turns green when its subject disappears guards nothing.

EXAMPLES
  control-chars --report --root src --root docs
  control-chars --root src --baseline control-chars.baseline.json
`;

let parsed;
try {
  parsed = parseArgs({
    options: {
      root: { type: "string", multiple: true, default: [] },
      ext: { type: "string", multiple: true, default: [] },
      ignore: { type: "string", multiple: true, default: [] },
      baseline: { type: "string", default: "control-chars.baseline.json" },
      report: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });
} catch (e) {
  console.error(`control-chars: ${e.message}\n`);
  console.error(HELP);
  process.exit(2);
}

const { values } = parsed;
if (values.help) {
  console.log(HELP);
  process.exit(0);
}

const roots = values.root.length ? values.root : ["src"];
const extensions = values.ext.length ? values.ext.map((e) => (e.startsWith(".") ? e : `.${e}`)) : DEFAULT_EXTENSIONS;
const ignoreDirs = values.ignore.length ? values.ignore : DEFAULT_IGNORE_DIRS;

/** The note about the file count travels NEXT TO the number, not in a convention about
 *  reports. A convention gets forgotten; a line beside the number moves with it. */
const FILES_NOTE = [
  "  The file count is a SNAPSHOT OF THE DISK, not of the commit: it counts untracked files and",
  "  grows while you are writing. NOT comparable between two reports, NOT reconstructable from a",
  "  commit. What it is good for: a sudden drop shows the scanner is seeing less than it should.",
].join("\n");

const { files, found } = scan({ roots, extensions, ignoreDirs });

if (values.report) {
  console.log(`Roots : ${roots.join(", ")}`);
  console.log(`Files : ${files}`);
  console.log(FILES_NOTE);
  console.log(`HITS  : ${found.reduce((n, f) => n + f.count, 0)} in ${found.length} file/character pair${found.length === 1 ? "" : "s"}`);
  for (const f of found) console.log(`  ${f.file}  ${hex(f.codePoint)} ${name(f.codePoint)}  x${f.count}  @ ${f.where.join(" ")}`);
  if (!found.length) console.log("  (none)");
  process.exit(0);
}

const base = loadBaseline(values.baseline);
if (!base.ok) {
  console.error(`control-chars RED: ${base.error}`);
  process.exit(1);
}

const { newHits, changed, gone, clean } = compare(found, base.entries);

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

if (clean) {
  const hits = base.entries.reduce((n, e) => n + e.count, 0);
  console.log(`control-chars GREEN — ${plural(files, "file")} · ${plural(hits, "hit")} in ${plural(base.entries.length, "justified baseline entry", "justified baseline entries")} · no deviation.`);
  console.log(FILES_NOTE);
  process.exit(0);
}

console.error(`control-chars RED — ${files} files checked.`);
console.error(FILES_NOTE);
for (const f of newHits) {
  console.error("");
  console.error(`NEW: ${f.file}  ${hex(f.codePoint)} ${name(f.codePoint)}  x${f.count}  @ ${f.where.join(" ")}`);
  console.error("     A raw control character in source. Write it as an escape, or record it WITH A REASON");
  console.error(`     in ${values.baseline}.`);
}
for (const c of changed) {
  console.error("");
  console.error(`COUNT: ${c.entry.file}  ${hex(c.entry.codePoint)}  baseline ${c.entry.count} -> now ${c.now}`);
  console.error(c.now < c.entry.count
    ? "     Fewer. That is good — and the baseline must be tightened (shrink pressure)."
    : "     More. That is a new incident.");
}
for (const g of gone) {
  console.error("");
  console.error(`GONE: ${g.file}  ${hex(g.codePoint)}  (baseline: x${g.count})`);
  console.error("     The hit is closed — remove the entry. A ratchet that does not shrink is a tolerance list.");
}
process.exit(1);
