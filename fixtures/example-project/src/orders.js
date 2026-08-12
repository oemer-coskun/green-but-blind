// Production code for the example project. Deliberately small.
//
// Two things matter here:
//   1. `placeOrder` has a GUARD (the id check). mutations.json breaks it on
//      purpose to show mutation-proof reporting FIRED.
//   2. It writes events as string literals starting with "event.order." — the
//      prefix that dead-filters compares the tests against.

export const EVENTS = {
  CREATED: "event.order.created",
  SHIPPED: "event.order.shipped",
};

/**
 * Append a "created" event to the ledger.
 *
 * Throws on a missing id. That throw is the guard whose effectiveness
 * mutation-proof demonstrates.
 */
export function placeOrder(ledger, order) {
  if (!order || typeof order.id !== "string" || order.id.length === 0) {
    throw new Error("order.id is required");
  }
  ledger.push({ type: "event.order.created", id: order.id });
  return order.id;
}

/** Append a "shipped" event. No guard — nothing here claims otherwise. */
export function shipOrder(ledger, id) {
  ledger.push({ type: "event.order.shipped", id });
  return id;
}
