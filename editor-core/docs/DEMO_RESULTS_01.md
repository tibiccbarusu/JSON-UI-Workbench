# Demo Results 01 (S064)

Generated_UTC: 2026-02-14T08:08:15Z
Base_Snapshot: PROJECT_SNAPSHOT_STEP_S063.zip
Scenario_Source: docs/DEMO_SCENARIOS.md

This file records the end-to-end demo scenario results for the project **as executed during step S064**.

## Execution environment

- Runner: automated build container (CLI-only)
- Outbound internet access: **not available in this environment**
  - Note: the app (release/app/index.html) loads several dependencies from CDNs (e.g., zip.js and jsonc-parser). Without network access, the interactive UI flows (ZIP import/export, in-app editing) cannot be executed here.

Because of the above constraints, this step records:
- What **was** executed in this environment (static serving smoke checks, Node-based unit test run)
- What **could not** be executed here (interactive browser steps)
- User-provided evidence for failures observed outside this environment (screenshot)

## Evidence and logs

- Release static-server smoke test (HTTP 200 checks):
  - /REPORT/release_smoke_S064.log
- Node-based unit test run output:
  - /REPORT/unit_tests_node_S064.log
- User-provided screenshot showing the canvas preview issue (textures not visible):
  - /PROJECT/reference/input_files/S064/スクリーンショット 2026-02-14 155949.png

## Scenario results summary

Legend:
- STATUS: PASS | FAIL | PARTIAL | NOT_RUN
- SEVERITY (for FAIL/PARTIAL): HIGH | MEDIUM | LOW | INFO

| ID | Scenario | Status | Severity | Notes |
|---:|---|---|---|---|
| DS-009 | Launch and load Vanilla reference (GitHub raw) | NOT_RUN | INFO | Blocked by no internet access (cannot fetch GitHub raw). |
| DS-010 | Import pack ZIP | NOT_RUN | INFO | Blocked by no internet access (CDN deps not loadable; zip.js not available). |
| DS-020 | Edit UI registry (_ui_defs.json) | NOT_RUN | INFO | Depends on DS-010 interactive flow. |
| DS-030 | Open screen and preview render (images/text) | FAIL | HIGH | User reports canvas preview shows only bounding boxes; textures not rendered (see screenshot). |
| DS-040 | Validation and diagnostics | PARTIAL | MEDIUM | Unit tests ran; 1 regression test failed (validator dynamic warning summary). No in-app validation run possible here. |
| DS-060 | Export resource pack ZIP | NOT_RUN | INFO | Depends on DS-010 interactive flow and zip.js. |
| DS-070 | Search and navigation | NOT_RUN | INFO | Depends on in-app screen loading. |

## Per-scenario notes

### DS-009 — Launch and load Vanilla reference (GitHub raw)

- Result: **NOT_RUN**
- Blocker: No outbound network access in this environment.
- Manual verification for the user:
  1. Serve /PROJECT/release/ (see commands in /REPORT/STEP_REPORT.txt).
  2. Open the app and choose "Use Vanilla Reference".
  3. Confirm a known vanilla UI file can be fetched (example: ui/hud_screen.json) and is cached (repeat load should not re-fetch).

### DS-010 — Import pack ZIP

- Result: **NOT_RUN**
- Blocker: No outbound network access in this environment (CDN dependency zip.js is required for ZIP import).
- Manual verification for the user:
  1. Serve /PROJECT/release/.
  2. In the app: Import → choose fixture ZIP: app/fixtures/s025-minimal-resource-pack.zip
  3. Confirm manifest.json is detected and ui/ files appear.

### DS-020 — Edit UI registry (_ui_defs.json)

- Result: **NOT_RUN**
- Dependency: DS-010.
- Manual verification for the user:
  1. After importing a pack, open the UI Definitions panel.
  2. Add/remove/reorder entries.
  3. Confirm JSON output remains valid.

### DS-030 — Open screen and preview render (images/text)

- Result: **FAIL (HIGH)**

Observed (user-provided):
- The canvas preview renders element bounding boxes, but **image textures are not visible** (everything appears as transparent blocks).
- Evidence: /PROJECT/reference/input_files/S064/スクリーンショット 2026-02-14 155949.png

Expected:
- For image elements, the UI property `texture` should resolve relative to the resource pack's `textures/` folder.
  - Example: a texture string like `ui/test` should resolve to `textures/ui/test.png` if present.

Suggested minimal reproduction (user-run):
1. Import fixture: app/fixtures/s025-minimal-resource-pack.zip
2. Open screen: ui/sample_screen.json
3. Confirm the test.png texture appears at the expected position.

Notes:
- Microsoft Learn confirms the `texture` field is relative to the resource pack textures folder, which matches the project spec and fixture assumptions.

### DS-040 — Validation and diagnostics

- Result: **PARTIAL (MEDIUM)**

Executed in this environment:
- Node-based unit tests were executed (see /REPORT/unit_tests_node_S064.log).
- Outcome: **1 failing regression test**:
  - "validator treats vanilla-style dynamic references as non-blocking (summary warnings only)"
  - Failure reason (from log): "Expected PROP_DYNAMIC summary warning"

Not executed in this environment:
- In-app validation flows (blocked by DS-010 / network).

### DS-060 — Export resource pack ZIP

- Result: **NOT_RUN**
- Dependency: DS-010.

### DS-070 — Search and navigation

- Result: **NOT_RUN**
- Dependency: DS-030.

## Overall assessment

- This environment cannot execute browser-interactive demos due to lack of network access (CDN dependencies).
- Two actionable issues were recorded:
  1. **Canvas preview textures not visible** (user-reported, HIGH) → should be addressed in S065.
  2. **Unit test regression** in validator summary warnings (MEDIUM) → should be addressed in S065.
