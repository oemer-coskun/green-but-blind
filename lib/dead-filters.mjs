// ─────────────────────────────────────────────────────────────────────────────
// dead-filters — test assertions that filter on an event nobody writes.
//
// ── WHAT IT MEASURES ─────────────────────────────────────────────────────────
//
// The PROPERTY: a test filters on an event type or prefix that is never written
// anywhere in production code. If the filter never matches, the assertion always
// compares the empty set against the empty set — it CANNOT go red, and it still
// claims to be checking something.
//
//   Test side       — every `"<prefix>…"` literal in a test file.
//   Production side — every `"<prefix>…"` literal outside test files.
//   Hit             — a test literal for which production has NO literal that
//                     starts with it (prefix `a.b.` covers `a.b.c.created`) and
//                     which is not itself a prefix of a production literal.
//
// ── THE SECOND COLUMN IS THE DECIDING ONE ────────────────────────────────────
//
// An unknown event in a test is usually DELIBERATE: the test writes itself an
// `event.test` and checks that a projection ignores it. That is not a defect,
// that IS the check.
//
// The real defect looks different, and this is exactly where it differs:
//
//   SELF-WRITTEN — the literal also appears in the same test file as a written
//                  type (`type: "…"`). The filter then matches BY CONSTRUCTION.
//                  Expected, not a finding.
//   FILTER ONLY  — the literal appears ONLY in a filter, never as a written type,
//                  neither in the test nor in production. THEN the assertion is
//                  checking the empty set.
//
// The case this tool was written for was exactly that: a test filtered on a
// prefix it never wrote itself and production did not know. The assertion
// compared 0 against 0, and a removed guard let malformed input through with a
// 201 response, unnoticed. The first column alone would have hidden it among
// dozens of expected hits.
//
// ── WHAT IT DOES NOT FIND ────────────────────────────────────────────────────
//
// This is a LITERAL SEARCH, not a parser:
//
//   • DYNAMICALLY BUILT TYPES. `` `event.${domain}.created` `` and every template
//     literal form escape it — on BOTH sides. A dynamically built production type
//     can make a test filter look falsely dead; that is the likeliest false positive.
//   • VARIABLES AND CONSTANTS. `filter(e => e.type === T_CREATED)` carries no
//     literal and is not seen — even though that form is the RIGHT one, because
//     it cannot drift. A project that names all its events through constants gets
//     zero hits here, and that is blindness, not a clean bill of health.
//   • COMPOSED FILTERS. `startsWith(PREFIX + "created")` escapes it.
//   • WHAT ONCE EXISTED. An event that existed and no longer does looks exactly
//     like a typo. The tool does NOT tell them apart — that is a question for a
//     human, not for a script.
//   • Anything outside the configured roots and extensions.
//
// ── THREE CLASSES OF FALSE POSITIVE, ALL OBSERVED IN PRACTICE ────────────────
//
// A prefixed literal is not always an event filter. The same spelling carries
// other meanings, and the script cannot tell them apart — whoever reads the
// output must:
//
//   1. PERMISSION SCOPES. `scope: ["event.x"]` names an allowed ACTION, not a
//      written event. A deliberately unlisted value is the subject of the test.
//   2. NAMESPACES. `{ namespace: "event.analytics.old" }` — an ordering concept.
//   3. LITERALS IN COMMENTS. A comment naming an example event is counted.
//
// A hit is solid, a non-hit is NOT — the number is a LOWER BOUND. And a number
// alone says nothing here: the lines have to be read.
//
// ── WHY THIS IS A TOOL AND NOT A GATE ────────────────────────────────────────
//
// A gate must be complete. A tool must be honest. The literal search produces
// false negatives (every non-literal form escapes it), so as a gate it would be
// a defect of its own class: reporting green without having measured.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";

export const DEFAULT_TEST_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/;

const walk = (dir, extensions, ignoreDirs) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ignoreDirs.includes(e.name) ? [] : walk(p, extensions, ignoreDirs);
    return extensions.some((x) => e.name.endsWith(x)) ? [p] : [];
  });
};

/** Escape a user-supplied prefix so it is matched literally, not as a pattern. */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Which characters may follow the prefix inside an event literal.
 *
 * Deliberately wider than dot-separated names: colons and slashes are common
 * separators (`evt:order:placed`, `event/order/placed`), and a body charset that
 * excludes your separator silently truncates every literal at it — the tool then
 * finds nothing and looks clean. Hyphen sits last so it is a literal, not a range.
 */
const LITERAL_BODY = "A-Za-z0-9_.:/-";

/**
 * Scan for filters on literals that nobody writes.
 *
 * `prefix`    — the common start of your event literals, e.g. "event." .
 * `writerKey` — the property name through which an event is WRITTEN, e.g. "type"
 *               for `{ type: "event.user.created" }`. This is what separates a
 *               deliberate synthetic event from a dead filter.
 */
export function analyze({
  roots,
  prefix = "event.",
  writerKey = "type",
  extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs"],
  ignoreDirs = ["node_modules", "dist", ".git"],
  testPattern = DEFAULT_TEST_PATTERN,
  literalChars = LITERAL_BODY,
  cwd = ".",
} = {}) {
  const p = escapeRe(prefix);
  const LITERAL = new RegExp(`["'\`](${p}[${literalChars}]*)["'\`]`, "g");
  const WRITTEN = new RegExp(`${escapeRe(writerKey)}\\s*:\\s*["'\`](${p}[${literalChars}]*)["'\`]`, "g");

  const production = new Set();
  const fromTests = [];

  for (const root of roots) {
    for (const file of walk(root, extensions, ignoreDirs)) {
      const rel = path.relative(cwd, file).replaceAll("\\", "/");
      const src = fs.readFileSync(file, "utf8");
      const isTest = testPattern.test(file);
      // Does THIS file write the literal itself? That is the form in which an event comes into being.
      const writes = new Set([...src.matchAll(WRITTEN)].map((m) => m[1]));
      for (const m of src.matchAll(LITERAL)) {
        const literal = m[1];
        if (isTest) {
          const written = [...writes].some((w) => w === literal || w.startsWith(literal));
          fromTests.push({ file: rel, line: src.slice(0, m.index).split("\n").length, literal, written });
        } else {
          production.add(literal);
        }
      }
    }
  }

  /** Does production cover this test literal? A prefix covers everything below it — and vice versa. */
  const covered = (lit) => [...production].some((x) => x.startsWith(lit) || lit.startsWith(x));

  const unknown = fromTests.filter((t) => !covered(t.literal));
  return {
    testLiterals: fromTests.length,
    productionLiterals: production.size,
    dead: unknown.filter((t) => !t.written),
    selfWritten: unknown.filter((t) => t.written),
  };
}
