// Tests for normalize.js.
//
// THE RAW CHARACTER IN THIS FILE IS DELIBERATE. The zero-width space below is
// written raw, not as an escape, because it IS the test datum: it is what
// stripInvisible has to remove. Writing it as an escape would test the escape,
// not the character.
//
// That is exactly the kind of decision control-chars wants recorded rather than
// forbidden. It is in control-chars.baseline.json with a reason, and the count
// is pinned: add a second raw character here and the gate goes red.
//
// Verified: replace the constant below with an empty string and two tests fail.

import test from "node:test";
import assert from "node:assert/strict";
import { stripInvisible, hasInvisible } from "./normalize.js";

/** A RAW zero-width space (U+200B). The one justified raw control character here. */
const ZWSP = "​";

test("strips a zero-width space", () => {
  assert.equal(stripInvisible(`a${ZWSP}b`), "ab");
});

test("detects a zero-width space", () => {
  assert.equal(hasInvisible(`a${ZWSP}b`), true);
});

test("leaves clean input alone", () => {
  assert.equal(stripInvisible("ab"), "ab");
  assert.equal(hasInvisible("ab"), false);
});

test("hasInvisible is not stateful across calls", () => {
  const dirty = `x${ZWSP}y`;
  assert.equal(hasInvisible(dirty), true);
  assert.equal(hasInvisible(dirty), true, "a shared /g/ regex would return false here");
});
