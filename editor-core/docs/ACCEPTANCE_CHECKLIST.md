# Acceptance Checklist (Aligned to Questionnaire Q070)

LAST_UPDATED_UTC: 2026-02-02T00:00:00Z
SCOPE_VERSION: v0 (initial release)
SOURCE_QID: Q070

This document defines **acceptance criteria** for the JSONUI Web Editor.
It is intentionally written to be **test-execution oriented**:

- Each acceptance item includes concrete **steps** and **expected results**.
- Each acceptance item maps to at least one demo scenario in `docs/DEMO_SCENARIOS.md`.

## References (within this repository)

- `SPEC/requirements.md` (requirements mirror)
- `SPEC/decisions.md` (locked policy tokens)
- `docs/DEMO_SCENARIOS.md` (step-by-step demos used as acceptance evidence)

## Test environment assumptions

- Browser: Chrome (stable)
- Device: PC recommended
- Mobile: supported **best-effort** (see `SPEC/decisions.md` → `MOBILE_EDITING_SCOPE=FULL_EDITING`), but **not acceptance-tested**
- Static hosting: fully client-side; serve files via a local static server during testing (see demo scenarios)

## Q070 Acceptance Items

> NOTE: The following 8 items are a direct, testable elaboration of the Q070 deliverables acceptance bullets.
> Each item MUST be **PASS** for release acceptance.

### AC-Q070-01: Avoid memory exhaustion via lazy loading (MUST)

DEMO_SCENARIO_IDS: DS-070

**Objective**
- The app must remain usable on large packs by avoiding unnecessary full extraction/loading.

**Steps**
1. Run DS-070 (large-pack performance/memory smoke).
2. During import and basic navigation, observe whether the browser tab becomes unresponsive or crashes.

**Expected results**
- The tab does not crash (no browser “Aw, Snap!” / out-of-memory / forced reload).
- The UI stays responsive enough to complete DS-070 steps (no permanent hang).
- Memory usage is not obviously unbounded after closing the imported pack (no continuous growth when idle).

---

### AC-Q070-02: Correctly import a Resource Pack ZIP containing JSON UI (MUST)

DEMO_SCENARIO_IDS: DS-010

**Objective**
- The user can import a valid resource pack ZIP containing UI JSON and the editor can index UI files.

**Steps**
1. Run DS-010 (import and open screen).

**Expected results**
- The import flow completes without errors for a valid pack.
- Pack `manifest.json` is detected and parsed.
- The editor detects the UI root (`ui/` folder) and system UI files (e.g., `_ui_defs.json`).
- At least one screen file can be opened and displayed in the element tree.

---

### AC-Q070-03: GUI-only create/place/move/edit/delete UI elements (MUST)

DEMO_SCENARIO_IDS: DS-020

**Objective**
- All core editing operations are available via GUI (no mandatory raw JSON editing).

**Steps**
1. Run DS-020 (GUI editing operations).

**Expected results**
- The user can:
  - add elements (from the supported palette),
  - select elements via tree and canvas,
  - move/reorder elements (tree and/or canvas interactions),
  - edit properties via the properties panel,
  - duplicate/delete elements.
- Raw JSON view exists for inspection/debugging and reflects the edited model.
- Editing does not require manual JSON edits.

---

### AC-Q070-04: Bedrock-aligned preview reflects images/fonts/language/bindings/navigation (MUST)

DEMO_SCENARIO_IDS: DS-030

**Objective**
- The preview approximates Bedrock UI well enough to validate layout and behavior.

**Steps**
1. Run DS-030 (preview fidelity demo).

**Expected results**
- Images: UI image elements render using resolved textures (Vanilla-first with overrides).
- Fonts: text renders using the selected font when available; otherwise an explicit fallback is used.
- Language: switching language updates localized text (with clear missing-key indicators).
- Bindings: modifying mock data causes bound properties to update in the preview (within the supported evaluator subset).
- Navigation: configured screen transitions can be simulated (at least basic screen switching/back).

---

### AC-Q070-05: Validation beyond syntax (schema + dependency/Bedrock consistency) (MUST)

DEMO_SCENARIO_IDS: DS-040, DS-060

**Objective**
- The editor detects errors early and prevents exporting invalid packs.

**Steps**
1. Run DS-040 (validation + diagnostics).
2. Run DS-060 (export gate checks).

**Expected results**
- Syntax validation:
  - JSON-with-comments input is accepted for import (JSONC) and syntax errors are reported with file + location.
- Schema/type validation:
  - Unsupported element types/properties are reported.
- Reference validation:
  - Missing textures/fonts/text keys/variables are detected and listed.
- Policy enforcement:
  - Export is **blocked** when there are errors.
  - Export is **allowed** (with warnings visible) when only warnings exist.

---

### AC-Q070-07: Errors in code/preview/interaction are reported clearly (MUST)

DEMO_SCENARIO_IDS: DS-040

**Objective**
- Failures are visible and actionable; the user is not left with silent breakage.

**Steps**
1. Run DS-040 (validation + diagnostics).

**Expected results**
- A diagnostics panel exists showing:
  - errors,
  - warnings,
  - logs (with module/component context where feasible).
- Rendering of diagnostics is safe (no HTML injection from user-controlled strings).
- The user can export a debug log file from the UI.

---

### AC-Q070-08: Export a valid Resource Pack ZIP with required minimal companion files (MUST)

DEMO_SCENARIO_IDS: DS-060

**Objective**
- The editor exports a valid RP ZIP that includes required structure and respects packaging policy.

**Policy**
- Must follow `SPEC/decisions.md` → `EXPORT_PACKAGING_POLICY=UI_PLUS_DEPS`.

**Steps**
1. Run DS-060 (export pack).

**Expected results**
- The exported ZIP contains at minimum:
  - `manifest.json`
  - `pack_icon.png`
  - `ui/` directory containing the edited UI JSON (and any referenced UI JSON that must ship)
- The exported `manifest.json` is valid for a resource pack (module type `resources`).
- Dependency-aware pruning is applied:
  - only referenced pack-owned dependencies are included (textures/texts/font as needed)
  - unreferenced content is excluded

## Coverage matrix (Q070 → demo scenarios)

| Q070 acceptance item | Demo scenarios |
|---|---|
| AC-Q070-01 | DS-070 |
| AC-Q070-02 | DS-010 |
| AC-Q070-03 | DS-020 |
| AC-Q070-04 | DS-030 |
| AC-Q070-05 | DS-040, DS-060 |
| AC-Q070-06 | DS-050 |
| AC-Q070-07 | DS-040 |
| AC-Q070-08 | DS-060 |
