// Type/value duplication for second-lists to find. Three shapes, on purpose.

// ── 1. THE DEFECT: the same set written twice ───────────────────────────────
// Add a fourth status to one of these and the other silently disagrees.
// second-lists reports this pair as IDENTICAL.
export type OrderStatus = "placed" | "shipped" | "delivered";
export const ORDER_STATUSES = ["placed", "shipped", "delivered"] as const;

// ── 2. THE FIX: derived, so it cannot drift ─────────────────────────────────
// second-lists is BLIND to this by design. A derived type is the solution, not
// the finding — there is only one truth here, so there is nothing to report.
export const PAYMENT_METHODS = ["card", "invoice", "prepaid"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// ── 3. NOT A DEFECT: a deliberate named subset ──────────────────────────────
// These share two literals but are not equal. second-lists reports it as
// OVERLAPPING and refuses to judge — because it cannot tell a deliberate subset
// from drift. This is the column a human has to read.
export type ShipmentState = "shipped" | "delivered" | "returned";
export const ACTIVE_SHIPMENTS = ["shipped", "delivered"] as const;
