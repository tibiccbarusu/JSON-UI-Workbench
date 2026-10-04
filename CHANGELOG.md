# Changelog

## 0.16.1 — 2026-10-05

- Add paired Japanese/English human-readable user guides, technical specifications and limitations, plus offline HTML handbooks and a runnable original tutorial.
- Adopt PolyForm Noncommercial License 1.0.0 for original portions the publisher owns or is authorized to license. Retain the unchanged official English terms and separate third-party notices. Describe the project as noncommercial source-available software.
- Reconcile current entry-point, publishing, contribution and package-license metadata. Preserve historical verification reports.
- Renderer/runtime behavior is unchanged from 0.16.0. Documentation example and distribution checks are recorded separately from historical renderer tests. Native game, Windows PowerShell and actual GUI/audio checks were not rerun for this documentation release.
- 日英の説明書・仕様書・注意事項と、非商用ライセンス説明を整備。ゲーム素材なしで試せる教材と閲覧用 HTML を追加。描画実装は 0.16.0 のままです。

## 0.16.0 — 2026-10-04

- Apply recorded native-property incompatibility diagnostics to concrete
  validation projections and add a separate `quality.native_properties` axis.
  Strict validation, JSON, SVG and PNG now share the known-property guard.
  Preserve the existing collection gate precedence and 0.15.1 animation guard.
- Diagnose unknown, non-toggle and externally owned local-state IDs. Draft
  previews retain known values but report incomplete binding quality; strict
  previews refuse contaminated state. Bound diagnostics without claiming that
  omitted observations passed.
- Add stateless `interact()` and registered `resolveSound()` operations to the
  Node, authenticated loopback HTTP and CLI APIs. Reuse the shared interaction
  engine and apply only local toggle patches; return other effects as descriptors.
- Share audio-intent construction with the GUI. Unresolved sound bindings cannot
  reuse stale authored sound properties. Preserve category/spatial limitations in
  sound-resolution and browser-player metadata.
- Generalize public-package auditing to detect opaque scratch session paths
  instead of a single historical workspace identity.
- Document caller-owned state/revision checks, metadata-only sound resolution,
  experimental GUI scope and unverified native/audio behavior.

Native Minecraft rendering, audible browser playback and Windows startup remain
unverified. See `docs/release/VERIFICATION_0160_JA.md` for recorded scope.

## 0.15.1 — 2026-10-04

- Retain legacy collection-index sampling but diagnose authored indices below
  ordinary panels or other non-collection owners. An ancestor collection alone
  no longer makes that shape pass the collection quality gate. Immediate
  collection-owner children and internally materialized grid/factory rows remain
  supported. Strict JSON and default strict PNG refuse the invalid context.
- Diagnose offset animations carrying `looping`, as rejected by the supplied
  Expedition Control 1.0.1 native Content Log. Explicit positive-duration `next`
  cycles remain sampleable. Keep animation quality separate and opt-in strict
  animation enforcement unchanged.
- Bound native-context evidence and mark an omitted observation incomplete.
- Add asset-independent regression tests for the observed failures, generated
  grid templates, legitimate fixed rows, strict output refusal and `next` cycles.

These are narrow compatibility guards, not a complete Minecraft UI schema.
No native layer-order or font-rendering equivalence is certified. Test results
belong to `docs/release/VERIFICATION_0151_JA.md`.

## 0.15.0 — 2026-10-04

- Make CLI the default product entry. `npm start` prints CLI help and exits;
  `npm run gui` explicitly launches the unfinished experimental editor.
- Add a reusable Node.js `createRenderer()` API for pack import, catalogs,
  validation and JSON / SVG / PNG rendering through the shared preview pipeline.
- Add a loopback-only authenticated HTTP entry for clients in other languages,
  with explicit no-overwrite connection-file output. Retain that file on shutdown
  to avoid deleting another process's replacement; close owned listeners/workers.
- Retain API packs until reimport/close, require reimport after Worker recovery,
  and clean cancelled uploads by their preallocated ownership ID even before
  response-body admission. Close the owned environment if cleanup itself fails.
- Keep original packs read-only. API state lasts for one renderer/server lifetime;
  CLI session persistence and editing remain available through the CLI.
- Keep shared `editor-core` engine files and historical documentation; explain
  current entry points, typed state, quality metadata and experimental GUI limits.
- Preserve the existing project rights notice and third-party licenses.

The entry-point changes do not certify Minecraft native equivalence or the
unfinished GUI editor. Actual test outcomes belong to the accompanying
verification record, rather than this change description.

## 0.14.0 — 2026-09-28

First release under the formal name **JSON UI Workbench**, based on r41 / 0.13.6.

- Correct label internal vertical placement; preserve authored anchors and source.
- Diagnose observed UV/size looping incompatibilities and flipbook connection risks without rejecting standalone flipbooks.
- Fix view-source fallback crossing inactive local controls or unrelated collection rows.
- Record binding source scope; detect narrowly evidenced dropdown context and passive-focus issues.
- Reject explicitly empty modal payloads and sparse typed form data.
- Decode signed packed item IDs; provide current and legacy profiles; diagnose model-only assets.
- Reuse retained projection models for subsequent frames; retain binding/state evaluation.
- Separate evaluation completeness from resource availability and native parity.
- Add bounded frame summary, generation/workload counts and input/image geometry evidence.
- Preserve long evidence identities through reversible hash keys.
- Add a reproducible GitHub-oriented public source package, publication audit, CI, rights notices and Japanese/English publishing instructions.
- Keep imported player models usable without bundled Steve assets; make public font regression tests use original synthetic atlases.

No Minecraft native FPS, all-pixel equivalence or Windows bootstrap execution is certified by this release.
