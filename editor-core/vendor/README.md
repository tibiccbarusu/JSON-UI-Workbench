# /vendor

Third-party client-side dependencies.

This project is **client-only** and should be deployable as a **static site**.

Production policy:

- Runtime dependencies are vendored here so ZIP import/export and JSONC parsing
  do not depend on a third-party network request.
- Versions, source package hashes, emitted file hashes, and licenses are recorded
  in `THIRD_PARTY_LOCK.tsv`.
- `app/index.html` loads only the local pinned files.

Notes:

- Dependency choices and pinned versions are tracked in `PROJECT/SPEC/dependencies.md`.
- If a bundler is adopted later (TBD), vendored modules may become part of the build pipeline.
- Do not replace a vendored file without updating the lock, license, dependency
  specification, and import/export regression evidence.
