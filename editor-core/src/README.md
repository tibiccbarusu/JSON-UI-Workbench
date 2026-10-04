# /src

Source code for the editor (plain JavaScript modules).

- Intended style: **framework-agnostic**, ES modules, small focused files.
- Prefer pure logic in `src/` that can be unit tested under `PROJECT/tests/`.

## Planned module areas (from docs/ARCHITECTURE.md)

- `state-store/` (added in S016)
- `pack-io/`
- `model/`
- `editor/`
- `preview/`
- `validation/`
- `export/`

Step **S015+** will introduce the actual entry module(s).
