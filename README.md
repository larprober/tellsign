# tellsign

[![npm](https://img.shields.io/npm/v/tellsign)](https://www.npmjs.com/package/tellsign)
[![license](https://img.shields.io/npm/l/tellsign)](LICENSE)
[![dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)](package.json)
[![tests](https://img.shields.io/badge/tests-29%20passing-brightgreen)](test/run.js)

**Names the tell in machine-written JavaScript.**

Linters check whether code is valid. `tellsign` checks whether code was *finished* — it looks for the specific ways generated code goes wrong: a package that was never installed, a method that never existed, a guard that can never fire, a comment written to a person in a chat window.

It does not tell you a line is bad. It tells you **which kind of bad** — the way a virus scanner names the family instead of shrugging and saying "suspicious".

```
  tellsign  ·  payments-api  ·  38 files

  src/billing.js
     3  high    phantom-import    "stripe-helpers-v2" is imported but is not a dependency, a builtin, or installed
        const { charge } = require('stripe-helpers-v2');
    91  high    lost-await        forEach ignores the promise it gets back - the loop finishes before the work does
        invoices.forEach(async (invoice) => {
   140  medium  dead-guard        options was just assigned an object literal, so this check always goes the same way
        if (!options) {

  3 tells  ·  2 high  ·  1 medium

  phantom-import  ██████████████████ 1
  lost-await      ██████████████████ 1
  dead-guard      ██████████████████ 1
```

Zero dependencies. One file per rule. Node 18+.

## Install

```bash
npm install -g tellsign
```

Or run it without installing:

```bash
npx tellsign
```

## Use

```bash
tellsign
```

```bash
tellsign ./src --min medium
```

```bash
tellsign --only phantom-import,lost-await --fail-on medium
```

```bash
tellsign . --json > tells.json
```

| Option | |
| --- | --- |
| `--json` | machine-readable output |
| `--quiet` | summary only |
| `--only <families>` | keep only these families |
| `--ignore <families>` | drop these families |
| `--min <severity>` | `low` \| `medium` \| `high` (default `low`) |
| `--fail-on <severity>` | exit 1 at or above this (default `high`, `none` to disable) |
| `--list` | print every family and what it means |
| `--no-color` | plain output |

Exit code is `1` when something at or above `--fail-on` is found, so it drops into CI as-is.

Put paths in a `.tellsignignore` file to skip them:

```
test/fixtures
vendor
**/generated
```

## The families

**Things that will break**

| Family | What it means |
| --- | --- |
| `phantom-import` | Imports a module the project does not have — an uninstalled package, or a relative path pointing at no file. |
| `phantom-api` | Calls a method that does not exist: `fs.readFileAsync`, `Math.sum`, `Object.map`, `getElementById('#id')`. |
| `crossbreed` | An idiom from another language wearing JavaScript syntax: `JSON.dumps`, `len(x)`, `.strip()`, `.push_back()`. |
| `lost-await` | `await` inside a callback nothing waits for — `forEach(async …)`, an async `.filter` predicate, an async `new Promise` executor. |
| `dead-guard` | A defensive check on a value that was just assigned a literal, so the branch can never go the other way. |

**Things that were never finished**

| Family | What it means |
| --- | --- |
| `scaffold-residue` | `// ... rest of the code`, `TODO: implement`, `your-api-key`, "in a real application, you would". |
| `stale-doc` | A JSDoc block describing a different function than the one below it — a parameter that is not in the signature, a documented return from a function that returns nothing. |
| `mute-catch` | An error caught and dropped with no log, no re-throw, and no note saying why that is safe. |

**Things that accumulate**

| Family | What it means |
| --- | --- |
| `orphan` | Defined once, referenced nowhere. |
| `twin` | The same helper implemented byte-for-byte in two places. |
| `barnacle` | A runtime dependency in `package.json` that nothing imports. |
| `stale-recipe` | A pattern that was right years ago: `node-fetch`, `body-parser`, `new Buffer()`, `mkdirp`. |
| `echo-comment` | A comment that restates the line under it and carries no information. |
| `ai-voice` | Narration aimed at a chat reader: "as requested", "🚀 blazing fast", "note that this is a simplified version". |

`tellsign --list` prints all of them with a suggested fix.

## How it reads your code

There is no parser and no dependency tree. Every file goes through a single-pass scanner that produces a **masked** copy in which strings, template chunks, comments and regex literals are blanked out, with every byte offset preserved. Rules then match against the masked text, so:

- a `// TODO` inside a string is not a comment,
- a `/` inside a character class is not a division,
- `${ total + 1 }` inside a template is still live code,
- a commented-out `require` is not an import.

Anything the scanner cannot read confidently, it skips rather than guesses at. That is the whole precision story: **a rule that fires is meant to be worth reading.** Scanned across eight real projects during development, it reported between zero and three findings each, and every one of them was real.

## What it does not do

- It reads `.js .mjs .cjs .jsx .ts .tsx` files. Script tags inside HTML, and `.vue` / `.svelte` single-file components, are only read for the identifier names they mention (so a handler called from an `onclick` is not mistaken for an orphan).
- It does no type checking and no scope analysis. `orphan` counts identifier occurrences across the project; two different local variables with the same name look like one name to it.
- It is not a security scanner and not a formatter. It has one job.

## Development

```bash
node test/run.js
```

29 tests, no dependencies, no build step. `test/fixtures/slop` is a small project containing at least one instance of every family; `test/fixtures/clean` is written to look suspicious and must report nothing.

```bash
npm run self
```

runs `tellsign` on its own source, which is expected to stay silent.

## License

MIT
