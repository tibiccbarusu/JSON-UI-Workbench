# Review Notes (S063)

GENERATED_UTC: 2026-02-14T07:21:16Z
SCOPE: Structured file review (structure/docs/secrets/size/consistency) + critical preview fix.

## Checklist

### 1) Repository / release structure
- [x] Top-level project folders are present: `/PROJECT/app`, `/PROJECT/src`, `/PROJECT/docs`, `/PROJECT/release`.
- [x] Release bundle mirrors source structure (`diff -qr PROJECT/src PROJECT/release/src` shows no diffs; same for `/app`).
- [x] Fixtures exist under `/app/fixtures/` for import/preview validation.

### 2) Documentation completeness
- [x] Core docs exist: `docs/ARCHITECTURE.md`, `docs/DEMO_SCENARIOS.md`, `docs/ACCEPTANCE_CHECKLIST.md`.
- [x] User docs exist in both languages: `docs/user_guide_en.md`, `docs/user_guide_ja.md`.
- [x] SPEC docs exist: `/PROJECT/SPEC/*` (decisions, nonfunctional, preview milestones, etc.).

### 3) Secrets / sensitive data scan
- [x] No `.env`, `*.pem`, `*.key`, or private key files found.
- [x] Grep scan for common credential patterns (AWS keys, GitHub tokens, Slack tokens, OpenAI keys, "password=", "api_key=") returned no matches.
- [x] Known hosting URL strings remain flagged as `[POTENTIAL_PII]` where applicable.

### 4) Size / binary review
- [x] Project directory size is small (~5–6 MiB for `/PROJECT/`), excluding external uploaded bundles.
- [x] No unexpectedly large binaries found (no files > 5 MiB inside `/PROJECT/`).
- [x] Large user-provided bundles (e.g., `importData.zip`) are treated as external inputs and not embedded in snapshots.

### 5) Dependency pinning / supply-chain notes
- [x] CDN dependencies are pinned by version in `app/index.html`:
  - `@zip.js/zip.js@2.8.16`
  - `jsonc-parser@3.3.1`
- [ ] Subresource Integrity (SRI) attributes are not currently included.
  - This is documented as a deployment-time hardening recommendation (see `SPEC/nonfunctional.md` and `release/DEPLOYMENT_CHECKLIST.md`).

### 6) Consistency / duplication
- [x] `/PROJECT/src/*` and `/PROJECT/release/src/*` are kept identical (source and release parity).
- [x] `/PROJECT/app/*` and `/PROJECT/release/app/*` are kept identical.

### 7) Critical functional fix (exception allowed by S063 scope)
- [x] Fixed a canvas preview regression where image/text rendering could silently fail due to an undefined `propsByIdOverride` reference in `drawCanvasNow()`.
  - Root cause: the texture/font draw-info builders referenced `propsByIdOverride` without defining it in scope; the surrounding `try/catch` swallowed the error, resulting in empty image/text overlays (only bounding boxes visible).
  - Fix: cache `propsByIdOverride` on the canvas state (`cs.propsByIdOverride`) during full renders, and read it inside `drawCanvasNow()`.
- [x] Added one-time Diagnostics capture for texture/font draw-info build failures (instead of silent `catch {}`), so future regressions are visible.
- [x] Fixed argument order for `syncPreviewEditBoxOverlayPosition(...)` to prevent future overlay positioning errors.

## Follow-up verification (manual)
- Serve `/PROJECT/release/` with a static server.
- Import `app/fixtures/s025-minimal-resource-pack.zip`.
- Open `ui/sample_screen.json` and confirm:
  - The image using `texture: "ui/test"` renders (not just a box).
  - Diagnostics shows actionable warnings if a referenced texture is missing.

