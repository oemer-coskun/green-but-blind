// Strips invisible characters out of user input.
//
// Every character in this file is written as an ESCAPE. That is the rule
// control-chars enforces: name the character, do not type it. The one place in
// this example project where a RAW character is justified is normalize.test.js,
// where the character IS the test datum — and that is recorded in the baseline
// with a reason.

/** Zero-width characters and the bidirectional overrides of the "Trojan Source" class. */
const INVISIBLE_SOURCE = "[\u200B\u200C\u200D\u2060\uFEFF\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069]";

/** Remove zero-width and bidirectional-override characters. */
export const stripInvisible = (s) => String(s).replace(new RegExp(INVISIBLE_SOURCE, "g"), "");

/**
 * True if the string contains anything invisible.
 *
 * A fresh RegExp each call, deliberately: a shared /g/ regex carries lastIndex
 * between calls, so `.test()` on it returns alternating answers for the same
 * input. That bug is invisible in a green test suite, which makes it rather
 * on-topic for this repository.
 */
export const hasInvisible = (s) => new RegExp(INVISIBLE_SOURCE).test(String(s));
