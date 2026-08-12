// ─────────────────────────────────────────────────────────────────────────────
// second-lists — the same strings written twice in one module: once as a type,
// once as a value.
//
// ── WHAT IT MEASURES ─────────────────────────────────────────────────────────
//
// The PROPERTY, not a spelling: do the same string literals appear twice in ONE
// module — once in a union (the type) and once in an array (the value)? Then
// there are two truths and nothing holds them together. Add a case to one and
// the other silently disagrees.
//
//   Unions  — every `type X = "a" | "b" | …;`  → the SET of its literals.
//   Values  — EVERY array literal consisting only of strings, regardless of how
//             it is written: `Object.freeze([…] as const)`, `readonly T[] = […]`,
//             `readonly string[] = […]`, or with no annotation at all.
//   Hit     — same module AND the same set (not a subset, not an overlap).
//
// The spelling-agnostic value side IS the point. In the project this came from,
// searching for `readonly string[]` or `Object.freeze` found 17 cases; measuring
// the property found 51. The difference was shapes nobody had thought to grep for.
//
// ── WHAT IT DOES NOT FIND ────────────────────────────────────────────────────
//
// This is a REGEX, not a parser:
//
//   • MULTI-LINE UNIONS. Only `type X = "a" | "b";` in ONE statement is caught.
//     A union wrapped across lines escapes it entirely.
//   • UNIONS WITH COMMENTS in between (`"a" | /* why */ "b"`) — likewise.
//   • TEMPLATE LITERAL TYPES and anything not made of plain string literals.
//   • DERIVED TYPES are invisible, and rightly so: `type X = (typeof LIST)[number]`
//     is the FIX, not the finding.
//   • Arrays with non-string elements, computed values, or spreads.
//
// A hit is solid, a non-hit is NOT. The reported number is a LOWER BOUND.
//
// ── WHY THIS IS A TOOL AND NOT A GATE ────────────────────────────────────────
//
// A gate must be complete. A tool must be honest.
//
// As a gate this would be a defect of its own class: the fragile parsing above
// produces FALSE NEGATIVES, so it would report green without having measured
// completely — exactly "a gate that reports green without measuring".
//
// And legitimate set equality produces FALSE POSITIVES: if the permitted source
// states of a transition happen to be ALL states, the array is set-equal and
// still correct. The remedy would be an exception list — a second truth, to
// prevent a second truth.
//
// The same incompleteness is bearable in a tool BECAUSE it stands next to it:
// whoever runs it reads the limits with it.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";

const STR = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g;

/** All string literals of a fragment, in order. */
export const strings = (blob) => {
  const out = [];
  for (const m of blob.matchAll(STR)) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
};

const walk = (dir, extensions, ignoreDirs) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ignoreDirs.includes(e.name) ? [] : walk(p, extensions, ignoreDirs);
    return extensions.some((x) => e.name.endsWith(x)) ? [p] : [];
  });
};

/** Every `type X = "a" | "b";` in one statement. Returns Map<"file|TypeName", Set<literal>>. */
export function findUnions(source, file) {
  const out = new Map();
  for (const m of source.matchAll(/\btype\s+([A-Za-z0-9_]+)\s*=\s*((?:\s*"[^"]*"\s*\|)+\s*"[^"]*")\s*;/g)) {
    const lits = new Set(strings(m[2]));
    if (lits.size >= 2) out.set(`${file}|${m[1]}`, lits);
  }
  return out;
}

/** Every array literal made only of strings. Returns Map<"file|Name@line", Set<literal>>. */
export function findStringArrays(source, file) {
  const out = new Map();
  for (const m of source.matchAll(/\[([^\[\]]*)\]/g)) {
    const inner = m[1];
    if (!inner.includes('"') && !inner.includes("'")) continue;
    const lits = strings(inner);
    if (lits.length < 2) continue;
    // pure? After removing the strings, only commas, whitespace and `as const` may remain.
    if (inner.replace(STR, "").replace(/[\s,]|as\s+const/g, "")) continue;
    const line = source.slice(0, m.index).split("\n").length;
    const head = source.slice(Math.max(0, m.index - 200), m.index);
    const names = [...head.matchAll(/(?:const|let|var)\s+([A-Za-z0-9_]+)[^=]*=\s*(?:Object\.freeze\s*\(\s*)?$/g)];
    const name = names.length ? names[names.length - 1][1] : `<anon>@${line}`;
    out.set(`${file}|${name}@${line}`, new Set(lits));
  }
  return out;
}

/**
 * Scan a tree and pair unions against string arrays in the same module.
 *
 * Returns counts plus two lists:
 *   identical   — same set. A second truth.
 *   overlapping — share at least two literals but are not equal. Could be a
 *                 deliberate named subset, could be drift. A human decides.
 */
export function analyze({ root, extensions = [".ts", ".tsx"], ignoreDirs = ["node_modules", "dist", ".git"] } = {}) {
  const unions = new Map();
  const arrays = new Map();

  for (const p of walk(root, extensions, ignoreDirs).map((f) => f.replaceAll("\\", "/"))) {
    const src = fs.readFileSync(p, "utf8");
    for (const [k, v] of findUnions(src, p)) unions.set(k, v);
    for (const [k, v] of findStringArrays(src, p)) arrays.set(k, v);
  }

  const identical = [];
  const overlapping = [];
  for (const [ukey, ulits] of [...unions].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [up, uname] = ukey.split("|");
    for (const [akey, alits] of arrays) {
      const [ap, aname] = akey.split("|");
      if (ap !== up) continue; // the same MODULE
      const onlyUnion = [...ulits].filter((x) => !alits.has(x)).sort();
      const onlyArray = [...alits].filter((x) => !ulits.has(x)).sort();
      if (!onlyUnion.length && !onlyArray.length) {
        identical.push({ file: up, type: uname, value: aname, literals: [...ulits].sort() });
      } else if ([...ulits].filter((x) => alits.has(x)).length >= 2) {
        overlapping.push({ file: up, type: uname, value: aname, onlyUnion, onlyArray });
      }
    }
  }

  return { unions: unions.size, arrays: arrays.size, identical, overlapping };
}
