# /tests

Unit tests for **pure logic** modules.

Design constraints:
- Buildless: runnable in a browser using native ES modules.
- No external deps.
- Prefer modules under `/PROJECT/src/` that do **not** touch DOM APIs.

## How to run

1) Serve the `/PROJECT` folder with a local static server.

Example (Python):

```bash
cd PROJECT
python -m http.server 8000
```

2) Open the tests page:

- `http://localhost:8000/tests/`

Expected: `status=PASS` and all tests listed as `PASS`.

## What is covered (S059)

- JSONC parsing (`/src/json/jsonc.js`)
- Deterministic stringify (`/src/json/stable-stringify.js`)
- Path normalization (`/src/path/normalize-zip-path.js`, `/src/path/normalize-pack-path.js`)
- Pack source overlay resolution (`/src/pack-io/overlay-pack-source.js`)
- Bindings evaluator subset (`/src/bindings/bindings-evaluator.js`)
- Regression guards:
  - `overrideProps` crash in canvas layout compute when `propsByIdOverride` is provided
  - Asset indexer async builder export exists and matches sync summary output
