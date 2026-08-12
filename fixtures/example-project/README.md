# The example project

A deliberately tiny project with one planted defect per tool. Nothing here is
real code; everything here is broken on purpose so you can run the tools without
having a codebase of your own to point them at.

**All nine of its tests pass.** That is the point. Run them yourself:

```
node --test "fixtures/example-project/src/*.test.js"
```

A green suite, a clean coverage story — and one of those tests measures nothing
at all.

## What is planted, and what each tool should say

Run these from the **repository root**.

### 1. A test that cannot go red

`src/orders.test.js` contains a test named *"every order event carries an id"*.
It filters the ledger for `event.orders.` — plural. Production writes
`event.order.` — singular. The filter matches nothing, the loop body never runs,
and the test asserts precisely nothing.

```
node bin/dead-filters.mjs --root fixtures/example-project/src
```

Expected: **2 hits** in the "FILTER ONLY" column and **2** in "written by the
test ITSELF".

Read all four lines, because two of them are not defects:

- The hit on **line 44** is the real one.
- The hit on **line 29** is inside a *comment* that quotes the wrong prefix while
  explaining the bug. A literal search cannot tell prose from code. This is
  false-positive class 3 from the tool's own header, demonstrated live.
- The two "written by the test ITSELF" hits are a deliberate synthetic event.
  Not a defect — and the reason that second column exists at all.

### 2. The same defect, caught dynamically

```
node bin/mutation-proof.mjs --spec fixtures/example-project/mutations.json
```

Expected: **3 FIRED, 2 UNCLEAR**, and **exit code 1** — on purpose, because
UNCLEAR means a human still has to look.

The interesting line is *"the id written into the created event"*. It deletes
the `id` from the event that `placeOrder` writes. A test literally named *"every
order event carries an id"* exists, and stays green. The suite claims to guard
this. It does not.

`_expect` fields in the spec say what each mutation should produce and why.

### 3. Red is not proof

The mutation named *"the zero-width test datum"* is worth running on its own:

```
node bin/mutation-proof.mjs --spec fixtures/example-project/mutations.json --only "the zero-width test datum"
```

It reports FIRED with two red tests — but **not the two you would guess**.
`strips a zero-width space` stays green, because with an emptied constant its
assertion reads `"ab" === "ab"`. A red run tells you *something* tripped, not
that *your* guard tripped. Check the names.

### 4. Two truths in one module

`src/status.ts` holds three shapes on purpose:

```
node bin/second-lists.mjs --root fixtures/example-project/src
```

Expected: **1 identical** pair, **3 overlapping**.

- `OrderStatus` / `ORDER_STATUSES` — the defect. The same set, written twice.
- `PAYMENT_METHODS` / `PaymentMethod` — the fix. Derived, so it cannot drift, and
  **invisible to the tool by design**.
- `ShipmentState` / `ACTIVE_SHIPMENTS` — a deliberate subset, reported as
  overlapping and explicitly not judged.

Three overlapping rather than one, because the tool pairs *every* union against
*every* array in the module. That is honest output, not a bug: it cannot know
which pairing you meant.

### 5. A raw control character, justified

`src/normalize.test.js` contains one raw ZERO WIDTH SPACE. It is deliberate: the
character **is** the test datum for the function that strips it. Writing it as an
escape would test the escape, not the character.

```
node bin/control-chars.mjs --report --root fixtures/example-project
```

That decision is recorded in `control-chars.baseline.json` at the repository root
with its reason and a verified count. Add a second raw character to that file and
the gate goes red.
