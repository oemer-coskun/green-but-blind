// ─────────────────────────────────────────────────────────────────────────────
// control-chars — raw control characters in source, as a shrinking ratchet.
//
// ── THE OCCASION ─────────────────────────────────────────────────────────────
//
// A patch script wrote `\b` as an actual BACKSPACE character (0x08) into a
// regular expression. The expression could never match. Every gate let it
// through: the type checker was green (it is a valid expression), and `grep`
// showed the line looking perfectly normal — a terminal EXECUTES a backspace
// instead of showing it.
//
// Seven more incidents followed in a single working session. All were caught by
// this tool, none by attention. Two of them reported SUCCESS while silently
// truncating: an upload API cut two files off at the first NUL byte and said OK.
//
// That is why this is a gate and not a report. A rule that relies on care is,
// here, demonstrably the wrong kind of rule.
//
// ── WHAT IT FINDS ────────────────────────────────────────────────────────────
//
// Raw code points from a CLOSED set: C0 controls except tab/newline/carriage
// return, DEL, the C1 block, zero-width characters, and the bidirectional
// override characters known as the "Trojan Source" class.
//
// No guessing, no heuristic, no allow-list of patterns. It reads code points and
// compares against a fixed set. This is why it is defensible as a gate where a
// regex-based tool would not be: it cannot produce false negatives by failing to
// parse something.
//
// ── WHAT IT DOES NOT FIND ────────────────────────────────────────────────────
//
//   • AN ESCAPE THAT IS WRONG. `\x08` written as an escape sequence is invisible
//     to this tool and can still be a defect. It finds the RAW character, not the
//     wrong expression. It would have caught the incident above; it does not
//     catch every defect of that kind.
//   • FILES OUTSIDE THE CONFIGURED ROOTS AND EXTENSIONS. A root is always missing
//     until something has escaped through it.
//   • INTENT. Whether a character is meant, suspicious or broken is a human
//     decision. The baseline is where that decision is recorded WITH A REASON,
//     and an entry without a reason is rejected.
//
// A hit is solid. A non-hit only means: not in these roots, not in these
// extensions, not as a raw character.
//
// ── THE RATCHET ──────────────────────────────────────────────────────────────
//
//   • a NEW hit (new file, new code point, or more of them)  → RED
//   • one hit FEWER without updating the baseline            → RED  (shrink pressure)
//   • a baseline entry that no longer exists                 → RED  (same reason)
//   • the baseline is missing or unreadable                  → RED
//
// The last one is the subtlest: a guard that turns GREEN when its subject
// disappears guards nothing. Delete the baseline and you do not have a clean
// state, you have a blind one.
//
// ── THE IDENTITY OF A HIT: FILE + CODE POINT + COUNT ─────────────────────────
//
// Deliberately NOT file + line + column. A line number shifts as soon as someone
// inserts something above it, and the baseline would go red on every harmless
// edit — a gate that fires for the wrong reason gets switched off. File +
// character + count is stable and still sharp: a second zero-width space in the
// same file changes the count and is caught.
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const DEFAULT_EXTENSIONS = Object.freeze([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".json", ".html", ".md", ".txt", ".yml", ".yaml",
]);

export const DEFAULT_IGNORE_DIRS = Object.freeze(["node_modules", "dist", "build", ".git", "coverage"]);

/** Allowed because they structure source text: tab, line feed, carriage return. */
const ALLOWED_C0 = new Set([0x09, 0x0a, 0x0d]);
const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);
/** The "Trojan Source" class: they reverse the DISPLAY without changing the meaning. */
const BIDI = new Set([0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);

const NAMES = Object.freeze({
  0x00: "NUL", 0x07: "BEL", 0x08: "BACKSPACE", 0x0b: "VERTICAL TAB", 0x0c: "FORM FEED",
  0x1b: "ESC", 0x7f: "DEL", 0x200b: "ZERO WIDTH SPACE", 0x200c: "ZWNJ", 0x200d: "ZWJ",
  0x2060: "WORD JOINER", 0xfeff: "BOM / ZWNBSP", 0x200e: "LRM", 0x200f: "RLM",
  0x202a: "LRE", 0x202b: "RLE", 0x202c: "PDF", 0x202d: "LEFT-TO-RIGHT OVERRIDE",
  0x202e: "RIGHT-TO-LEFT OVERRIDE", 0x2066: "LRI", 0x2067: "RLI", 0x2068: "FSI", 0x2069: "PDI",
});

export const name = (cp) => NAMES[cp] ?? "(unnamed)";
export const hex = (cp) => `0x${cp.toString(16).toUpperCase().padStart(4, "0")}`;

export const suspicious = (cp) =>
  (cp < 0x20 && !ALLOWED_C0.has(cp)) || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f) || ZERO_WIDTH.has(cp) || BIDI.has(cp);

function* walk(dir, extensions, ignoreDirs) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!ignoreDirs.includes(e.name)) yield* walk(p, extensions, ignoreDirs);
      continue;
    }
    if (extensions.some((x) => e.name.endsWith(x))) yield p;
  }
}

/**
 * All findings, grouped by file + code point.
 *
 * Reads CODE POINTS, not bytes: a byte-wise scan splits UTF-8 sequences and
 * reports a zero-width character as three harmless bytes.
 */
export function scan({ roots, extensions = DEFAULT_EXTENSIONS, ignoreDirs = DEFAULT_IGNORE_DIRS, cwd = "." } = {}) {
  const acc = new Map();
  // Overlapping roots (`--root . --root src`) would otherwise read the same file twice and
  // double every count — a gate going red because of how it was invoked, not what it found.
  const seen = new Set();
  let files = 0;
  for (const root of roots) {
    try { if (!statSync(root).isDirectory()) continue; } catch { continue; }
    for (const file of walk(root, extensions, ignoreDirs)) {
      const id = resolve(file);
      if (seen.has(id)) continue;
      seen.add(id);
      files++;
      const text = readFileSync(file, "utf8");
      const rel = relative(cwd, file).replace(/\\/g, "/");
      let line = 1, col = 1;
      for (const ch of text) {
        const cp = ch.codePointAt(0);
        if (suspicious(cp)) {
          const k = key(rel, cp);
          const e = acc.get(k) ?? { file: rel, codePoint: cp, count: 0, where: [] };
          e.count++;
          if (e.where.length < 6) e.where.push(`${line}:${col}`);
          acc.set(k, e);
        }
        if (ch === "\n") { line++; col = 1; } else { col += ch.length; }
      }
    }
  }
  return { files, found: [...acc.values()].sort((a, b) => a.file.localeCompare(b.file) || a.codePoint - b.codePoint) };
}

/**
 * Read and validate the baseline.
 *
 * Returns `{ ok: true, entries }` or `{ ok: false, error }` — it does NOT exit.
 * The caller decides, which is what makes this testable.
 */
export function loadBaseline(file, readFile = readFileSync) {
  let raw;
  try {
    raw = readFile(file, "utf8");
  } catch {
    return {
      ok: false,
      error: `the baseline ${file} is missing or unreadable.\n` +
        "A guard that turns green when its subject disappears guards nothing.",
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `${file} is not valid JSON — ${e.message}` };
  }
  if (!Array.isArray(parsed)) return { ok: false, error: `${file} must be an array.` };

  for (const [i, e] of parsed.entries()) {
    const ok = e && typeof e.file === "string" && typeof e.codePoint === "number"
      && typeof e.count === "number" && typeof e.reason === "string" && e.reason.trim().length > 0;
    if (!ok) {
      return {
        ok: false,
        error: `baseline entry ${i} is incomplete. Every entry needs file, codePoint, count and a\n` +
          "non-empty `reason` — an entry without a reason is not a decision, it is a tolerance.",
      };
    }
  }
  return { ok: true, entries: parsed };
}

/** The identity of a hit. U+0001 as the separator, WRITTEN AS AN ESCAPE: it cannot occur in a file
 *  name, and typing it raw would be exactly the defect this tool catches. */
const key = (f, cp) => `${f}\u0001${cp}`;

/** Compare a scan against a baseline. Three ways to be red, all of them returned. */
export function compare(found, baseline) {
  const base = new Map(baseline.map((e) => [key(e.file, e.codePoint), e]));
  const actual = new Map(found.map((f) => [key(f.file, f.codePoint), f]));

  const newHits = [];
  const changed = [];
  const gone = [];

  for (const [k, f] of actual) {
    const b = base.get(k);
    if (!b) { newHits.push(f); continue; }
    if (b.count !== f.count) changed.push({ entry: b, now: f.count });
  }
  for (const [k, b] of base) if (!actual.has(k)) gone.push(b);

  return { newHits, changed, gone, clean: !newHits.length && !changed.length && !gone.length };
}
