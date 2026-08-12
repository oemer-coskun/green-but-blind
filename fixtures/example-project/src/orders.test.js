// Tests for orders.js. Three of them pass. One of them measures nothing.
//
// All four are green. That is the point of this file: `node --test` cannot tell
// you which one is worthless, and neither can a coverage report — the vacuous
// test does execute the production code, it just never asserts anything about it.

import test from "node:test";
import assert from "node:assert/strict";
import { placeOrder, shipOrder } from "./orders.js";

test("rejects an order without an id", () => {
  assert.throws(() => placeOrder([], {}), /order\.id is required/);
});

test("rejects an empty id", () => {
  assert.throws(() => placeOrder([], { id: "" }), /order\.id is required/);
});

test("writes a created event", () => {
  const ledger = [];
  placeOrder(ledger, { id: "A1" });
  assert.equal(ledger.filter((e) => e.type === "event.order.created").length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// THE PLANTED DEFECT — this is what dead-filters finds.
//
// The intent was: every order event carries an id. The prefix is wrong, though —
// production writes "event.order." (singular), this filters on "event.orders."
// (plural). The filter matches nothing, the loop body never runs, and the test
// asserts precisely nothing.
//
// It is green today. It will be green after someone deletes the `id` from the
// event. It cannot go red. Run:
//
//   node bin/mutation-proof.mjs --spec fixtures/example-project/mutations.json
//
// and watch the "order id is written" mutation come back UNCLEAR.
// ─────────────────────────────────────────────────────────────────────────────
test("every order event carries an id", () => {
  const ledger = [];
  placeOrder(ledger, { id: "A1" });
  shipOrder(ledger, "A1");
  for (const e of ledger.filter((x) => x.type.startsWith("event.orders."))) {
    assert.ok(e.id, "event without id");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// NOT a defect — and the reason dead-filters has a second column.
//
// This test invents an event type that production never writes, on purpose: the
// whole point is to check that unknown events are ignored. A tool looking only
// for "test filters on something production does not write" would flag this and
// bury the real defect above among noise.
//
// What separates them: this test WRITES the literal itself, through the property
// named by --writer-key. So the filter matches by construction. dead-filters
// puts it in the "written by the test ITSELF" column and moves on.
// ─────────────────────────────────────────────────────────────────────────────
test("ignores event types it does not know", () => {
  const ledger = [{ type: "event.synthetic.probe", id: "X1" }];
  placeOrder(ledger, { id: "A1" });
  const known = ledger.filter((e) => e.type.startsWith("event.synthetic."));
  assert.equal(known.length, 1, "the synthetic event survives untouched");
});
