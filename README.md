# green-but-blind

Four command-line scanners that look for tests which pass without testing
anything, and for control characters that break code invisibly.

*Deutsche Fassung: [README.de.md](README.de.md)*

---

## Why these exist

I went through a project of mine to check whether the guards were actually
guarding. Not whether the tests passed — they all passed — but whether any of
them would notice if the thing they claimed to protect quietly broke.

Several of them would not have.

The clearest one was a test that filtered a ledger for a category of event, then
asserted something about what it found. The filter was wrong. Production never
wrote events under that name, so the filter matched nothing, so the assertion
compared an empty set against an empty set. It passed. It had always passed. It
would have passed forever, no matter what the code underneath it did.

It was not a weak test. It was not a test at all. And nothing in my toolchain
could tell me that: it ran, it was green, it even showed up as coverage, because
it *did* execute the production code — it just never asserted anything about the
result.

That is the shape this repository is about. Not tests that fail, and not tests
that are missing. Tests that are **present, green, and blind**.

> **On the anecdote above:** I can't show you that codebase, so please treat the
> story as a story. Everything from here down is checkable in this repository,
> and every number below comes with the command that produces it. That asymmetry
> is deliberate — a repo about unverifiable claims should not open with one.

## The two rules that came out of it

**1. A guard is not effective until you have watched it fire.**

Write the guard, then deliberately break the thing it protects, and confirm the
suite goes red. Once. Before you trust it. This takes a minute and it is the only
evidence that the guard is connected to anything. `mutation-proof` is that minute,
automated.

**2. Red is not proof until you have checked *which* assertion tripped.**

A run can go red for a reason that has nothing to do with your guard — a
different assertion, earlier in the same test, failing first. "The suite went
red" and "my guard fired" are different claims, and only one of them is evidence.

There is a live example of exactly this mistake in this repository. While writing
the baseline for the control-character gate, I claimed two named tests would fail
if a constant were emptied. I measured it. Two tests did fail — **and one of them
was not the one I had named.** The count matched; the identity did not. The
corrected reasoning is in `control-chars.baseline.json`, and you can reproduce
the measurement in one command.

## A rule these tools keep

Three of the four report **findings**. The fourth reports a **verdict**, and it
is allowed exactly two:

```
FIRED     a test went red while the code was mutated
UNCLEAR   this tool could not see what happened
```

There is no third verdict. In particular there is no "does not fire", because
the tool cannot distinguish *"no test failed"* from *"I could not read the
output"* — and a claimed absence is the more dangerous error. A missing guard
eventually announces itself, because a defect gets through. A guard falsely
reported as missing never does: everything keeps working, and you are simply
holding a wrong map of your own system, confidently.

An earlier version of this tool did report absences. It called three existing
guards missing because it could not parse the test runner's coloured output. All
three were fine. The parsing is fixed now — it reads TAP and vitest JSON instead
of scraping text — but the rule stayed, because *correct* is not *omniscient*.

## The four tools

Each runs standalone, each takes `--help`, and each states its own limits in its
file header rather than in a footnote.

| | finds | is not |
|---|---|---|
| **`mutation-proof`** | guards that do not fire, by breaking the code on purpose | a full mutation-testing framework |
| **`dead-filters`** | assertions that filter on an event nobody writes | a parser — it searches string literals |
| **`second-lists`** | the same strings written twice, once as a type and once as a value | a parser — single-statement unions only |
| **`control-chars`** | raw control and zero-width characters in source | a check for *wrong escapes*, which stay invisible |

Three of them are **tools**, one is a **gate**, and the difference is deliberate.

A gate must be complete; a tool must be honest. `dead-filters` and
`second-lists` both work by searching text, so they have blind spots by
construction — as gates they would report green without having measured, which is
the exact defect this repository exists to find. So they never fail a build. They
print findings, they exit 0, and their headers say what they miss.

`control-chars` is a gate because it can be: it reads code points and compares
them against a closed set. No guessing, nothing to fail to parse.

## Try it without a codebase

There is a small example project under `fixtures/example-project` with one
planted defect per tool. **All nine of its tests pass** — that is the point.

```bash
git clone https://github.com/WestMoneyDE/green-but-blind
cd green-but-blind

node --test "fixtures/example-project/src/*.test.js"   # 9 tests, 9 pass
```

Now find the defect that green suite is hiding:

```bash
node bin/dead-filters.mjs   --root fixtures/example-project/src
node bin/second-lists.mjs   --root fixtures/example-project/src
node bin/control-chars.mjs  --report --root fixtures/example-project
node bin/mutation-proof.mjs --spec  fixtures/example-project/mutations.json
```

What each of those should print, and which of the hits are *not* defects, is
walked through in [`fixtures/example-project/README.md`](fixtures/example-project/README.md).

The short version: `mutation-proof` reports **3 FIRED, 2 UNCLEAR**. One of those
UNCLEAR results deletes a field from an event — while a test named *"every order
event carries an id"* sits right there in the suite and stays green.

## On your own project

```bash
node bin/dead-filters.mjs --root src --prefix "event." --writer-key type
node bin/second-lists.mjs --root src
node bin/control-chars.mjs --report --root src --root docs
```

`dead-filters` needs to know your conventions: `--prefix` is the common start of
your event literals, `--writer-key` is the property through which an event is
written (`{ type: "…" }`, `{ kind: "…" }`). Both matter — see below.

For `mutation-proof`, write a spec listing what to break:

```json
{
  "cwd": ".",
  "cmd": "node --test \"test/*.test.js\"",
  "kind": "node",
  "mutations": [
    {
      "name": "the auth guard rejects an empty token",
      "file": "src/auth.js",
      "from": "if (!token) throw new Error(\"unauthorized\");",
      "to":   "if (false) throw new Error(\"unauthorized\");"
    }
  ]
}
```

`kind` is `node` (TAP) or `vitest` (JSON). The file is always written back, even
if the run crashes. If `from` does not appear in the file, the result is UNCLEAR —
never a silent skip.

## What these tools do not find

This section is longer than the feature list on purpose.

**A hit is solid. A non-hit is not.** Every count these tools print is a lower
bound. Three of the four work by searching text, and text search has blind spots
that no amount of care removes:

- **`dead-filters`** sees string literals. Events built from template literals
  (`` `event.${domain}.created` ``) are invisible to it, on both sides. So are
  events held in constants — and that form is the *better* one, precisely because
  it cannot drift. **A project that names all its events through constants will
  get zero hits here, and that is blindness, not a clean bill of health.**
  It also counts literals inside comments, and permission scopes, and namespaces,
  because to a literal search they all look identical. Read the lines; do not
  read the number.

- **`second-lists`** matches single-statement unions. A union wrapped across
  lines, or with a comment inside it, escapes entirely. Derived types
  (`type X = (typeof LIST)[number]`) are also invisible — deliberately, since
  that is the fix rather than the finding.

- **`control-chars`** finds *raw* characters. An escape sequence that is wrong
  (`\x08` where you meant `\b`) is invisible to it and can still be a defect. It
  would have caught the incident that prompted it; it does not catch every defect
  of that kind.

- **`mutation-proof`** proves that *a* test went red. Whether it was *your* test
  is a question it hands back to you, with names.

## Requirements

Node 20 or newer. No dependencies — the tools use only Node built-ins.

`second-lists` reads TypeScript *as text* and never executes it, so no TypeScript
toolchain is needed.

## Eating its own cooking

```bash
npm run check     # the control-chars gate, then the test suite
```

71 tests cover the four tools, including tests that assert the tools **miss**
things — the blind spots above are written down where they can be checked, so
nobody reads a clean run as "there is nothing there".

The repository's own control-character baseline has exactly one entry: a
deliberate zero-width space in a fixture, with a reason and a verified count.

## Authors

**Ömer Coskun** ([@WestMoneyDE](https://github.com/WestMoneyDE)) — the tools, the
incidents behind them, and the rules that came out of both.

Built with [Claude Code](https://claude.com/claude-code), which did the work of
lifting them out of the project they were written in and into something that runs
somewhere else.

## Licence

MIT — see [LICENSE](LICENSE).
