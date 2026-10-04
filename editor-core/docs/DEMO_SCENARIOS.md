# Demo Scenarios (Minimal Set for Acceptance)

> S066 current-state override: this is a legacy/target scenario set, not proof of current acceptance. The current app does not restore a complete Vanilla reference from default GitHub raw metadata. For S066, use a user-uploaded official `full` ZIP that passes the version/channel/critical-file gates in `README.md` and `docs/VANILLA_RESOURCE_PACK_JA.md`. Site and Minecraft Bedrock device acceptance remain separate.

LAST_UPDATED_UTC: 2026-02-02T00:00:00Z
SCOPE_VERSION: v0 (initial release)

This document defines a **minimal, reproducible** set of demo scenarios used as evidence for the acceptance checklist in `docs/ACCEPTANCE_CHECKLIST.md`.

## Conventions

- **DS-###**: Demo scenario ID
- **COVERS_ACCEPTANCE**: Acceptance checklist items covered by this scenario
- **Inputs**: Files you need before starting (resource pack ZIPs, etc.)

## Test fixtures

All scenarios that require a resource pack ZIP assume a valid Bedrock **resource pack** structure:

- `manifest.json` (required)
- `pack_icon.png` (commonly required/expected)
- `ui/` directory (for JSON UI)

Official documentation notes that `manifest.json` is the only required file and shows example manifests where the resource pack module type is `"resources"`. (See `PROJECT/reference/S003_WEB_SOURCES_USED.tsv`.)

### Fixture Option A (recommended): build a tiny UI-only resource pack ZIP

This option produces a small pack that is sufficient for DS-010/020/040/050/060.

**Create a folder** named `rp_fixture_minimal/` with this structure:

```
rp_fixture_minimal/
  manifest.json
  pack_icon.png
  ui/
    _ui_defs.json
    _global_variables.json
    my_ui/
      demo_screen.json
```

**1) manifest.json** (template)

> Replace the UUID placeholders with two different generated UUIDs.

```json
{
  "format_version": 2,
  "header": {
    "name": "JSONUI Fixture (Minimal)",
    "description": "Minimal pack for JSONUI Web Editor demos",
    "uuid": "<UUID_HEADER>",
    "version": [1, 0, 0],
    "min_engine_version": [1, 21, 0]
  },
  "modules": [
    {
      "type": "resources",
      "uuid": "<UUID_MODULE>",
      "version": [1, 0, 0]
    }
  ]
}
```

**2) pack_icon.png**

- You may reuse the provided icon in this repo:
  - `PROJECT/reference/input_files/S001/importData_extracted/ResourcePack/pack_icon.png`

**3) ui/_ui_defs.json**

```json
{
  "ui_defs": [
    "my_ui/demo_screen.json"
  ]
}
```

**4) ui/_global_variables.json**

```json
{
  "$demo_text_color": [1.0, 1.0, 1.0]
}
```

**5) ui/my_ui/demo_screen.json** (intentionally JSONC-friendly)

This file includes a comment and a trailing comma to validate JSONC parsing.

```jsonc
{
  // demo screen for JSONUI Web Editor
  "namespace": "my_ui",

  "demo_screen": {
    "type": "panel",
    "size": ["100%", "100%"],
    "controls": [
      {
        "title": {
          "type": "label",
          "text": "menu.play",
          "localize": true,
          "color": "$demo_text_color",
          "anchor_from": "top_left",
          "anchor_to": "top_left",
          "offset": [16, 16]
        }
      },
      {
        "logo": {
          "type": "image",
          "texture": "textures/ui/White",
          "anchor_from": "top_left",
          "anchor_to": "top_left",
          "offset": [16, 56],
          "size": [64, 64]
        }
      }
    ],
  }
}
```

**6) Zip it**

From the parent directory of `rp_fixture_minimal/`:

```bash
zip -r rp_fixture_minimal.zip rp_fixture_minimal
```

You now have a pack ZIP for import.

### Fixture Option B: reconstruct from the provided `ResourcePack` fragments

The repository includes a `ResourcePack/` folder under:

- `PROJECT/reference/input_files/S001/importData_extracted/ResourcePack/`

Note: UI files are provided as `ui.zip` for safety in the imported bundle.
If you choose this option:

1. Create a working folder `rp_fixture_from_bundle/`.
2. Copy `manifest.json` and `pack_icon.png` from the provided `ResourcePack/` folder.
3. Unzip `ui.zip` into `rp_fixture_from_bundle/ui/`.
4. Zip `rp_fixture_from_bundle/` into `rp_fixture_from_bundle.zip`.

This option is useful if you want many UI screens for browsing.

---


## DS-009: Mobile viewport smoke subset (best-effort)

Mobile/touch is supported as **best-effort** (PC is recommended). Mobile is **not** acceptance-tested.

### Steps (Chrome DevTools)
1. Open the app (local static server or hosted).
2. Open DevTools → Toggle Device Toolbar.
3. Pick a phone preset (e.g. iPhone 12 / 390×844) and refresh the page.
4. Run this minimal flow:
   - Import a small fixture RP ZIP (see **Test fixtures** above).
   - Open a UI screen from the tree.
   - Select an element → edit a numeric property (e.g. `size` or `offset`) in Inspector.
   - Drag-reorder a child in the tree using the drag handle (`≡`).
   - Open the tree context menu via the `⋯` button, then close it with `Esc`.
   - Export a resource pack ZIP.
5. Expected observations:
   - The editor remains usable on the narrow viewport (no overlapping panels that block interaction).
   - Dragging the tree reorder handle does **not** scroll the page.
   - Tap targets for small controls (drag/menu/disclosure) are large enough to hit reliably.
   - Context menu is keyboard-navigable (ArrowUp/ArrowDown/Home/End) and returns focus to the opener on close.

## DS-010: Import pack ZIP and open a screen

COVERS_ACCEPTANCE: AC-Q070-02

**Inputs**
- `rp_fixture_minimal.zip` (Fixture Option A) OR any valid RP ZIP containing `ui/` and `manifest.json`.

**Steps**
1. Serve the app via a local static server (once the app exists):

   ```bash
   python -m http.server 8000
   ```

2. Open the app in Chrome.
3. Use the Import flow to select and open the pack ZIP.
4. Confirm the pack file index is shown (at least manifest + UI files).
5. Open a UI screen and confirm the element tree populates.

**Expected results**
- Import completes successfully for valid packs.
- `manifest.json` is parsed (name/version visible in UI).
- `ui/` is detected and system files are recognized (`_ui_defs.json`, `_global_variables.json` if present).
- The chosen screen is displayed as a tree of elements.

---

## DS-020: Basic GUI editing operations (create/move/edit/delete)

COVERS_ACCEPTANCE: AC-Q070-03

**Inputs**
- A successfully imported pack from DS-010.

**Steps**
1. In the tree, select an element (e.g., `title`).
2. In the properties panel, change a simple property (e.g., label text, offset, size).
3. Add a new element from the palette (choose at least 3 different types over the run).
4. Reorder children in the tree (drag and drop).
5. Duplicate an element.
6. Delete an element.
7. Confirm the raw JSON/debug view updates accordingly (read-only).

**Expected results**
- All operations succeed without requiring manual JSON edits.
- The selection state stays consistent across tree/canvas/properties.
- The raw JSON view reflects the model after each change.

---

## DS-030: Preview fidelity (images/fonts/language/bindings/navigation)

COVERS_ACCEPTANCE: AC-Q070-04

**Inputs**
- An imported pack (DS-010).
- A user-uploaded official Vanilla `full` ZIP whose declared version/channel exactly match the target and whose critical files parse. Default GitHub raw restoration is not a current S066 path.

**Steps**
1. Open `demo_screen` (from the minimal fixture).
2. Confirm the preview renders:
   - a label for `menu.play` (localized)
   - an image using `textures/ui/White`
3. Switch preview language (EN/JA) and observe the label text changes.
4. Fonts:
   1) Change the label font_type (if exposed in the properties panel) to another available font.
   2) Confirm the preview updates and a fallback font is used when the chosen font is unavailable.
5. Bindings (using the app’s supported evaluator subset):
   1) Create or select an element with a binding that drives visibility (or a numeric property).
   2) Open the mock-data panel, change the bound value.
   3) Confirm the preview updates.
6. Navigation:
   1) Create a second screen (e.g., `second_screen`) using the UI defs manager.
   2) Configure a button action (or equivalent) to navigate from `demo_screen` → `second_screen`.
   3) Trigger the action in the preview and confirm the screen changes.
   4) Use back/forward controls (if provided) to return.

**Expected results**
- Images resolve via Vanilla-first logic (and render when available).
- Language switching updates localized text; missing keys are visibly indicated.
- Binding-driven changes are reflected live in preview (within the supported subset; no crashes).
- Screen navigation works and does not corrupt editor state.

---

## DS-040: Validation + diagnostics

COVERS_ACCEPTANCE: AC-Q070-05, AC-Q070-07

**Inputs**
- An imported pack.

**Steps**
1. Trigger a **missing asset** warning:
   - Set an image texture to a clearly missing path (e.g., `textures/ui/THIS_DOES_NOT_EXIST`).
2. Run validation (or observe automatic validation if it runs on change).
3. Confirm the validation panel lists the missing asset.
4. Trigger a **syntax error**:
   - Import a second pack where one UI file is intentionally broken JSON (e.g., delete a closing brace).
5. Confirm the app reports the syntax error with file context.
6. Trigger a controlled runtime error (if a built-in "sample error" action exists) and confirm it is captured.
7. Export a debug log file from the diagnostics UI.

**Expected results**
- Missing assets are detected and listed with where they were referenced.
- Syntax errors are shown with file and location (line/column if available).
- Diagnostics show errors/warnings/logs without unsafe HTML rendering.
- Debug log export succeeds.

---

## DS-060: Export a minimal RP ZIP (UI_PLUS_DEPS)

COVERS_ACCEPTANCE: AC-Q070-05, AC-Q070-08

**Inputs**
- An imported pack with no validation errors.

**Steps**
1. Ensure validation has no **errors**.
2. Export a Resource Pack ZIP.
3. Inspect the exported ZIP contents:

   ```bash
   unzip -l exported_pack.zip | head -n 50
   ```

4. Confirm required top-level files exist (`manifest.json`, `pack_icon.png`) and UI files exist under `ui/`.
5. Confirm dependency pruning is applied:
   - if your UI only references **vanilla** assets (like `textures/ui/White`), the export should not include large `textures/` folders unless the pack provides overrides.

**Expected results**
- Export is blocked if validation has errors.
- Exported ZIP contains required files and edited UI JSON.
- Output size is reasonable (not bloated with unreferenced content).

---

## DS-070: Large-pack performance/memory smoke test

COVERS_ACCEPTANCE: AC-Q070-01

**Inputs**
- A larger resource pack ZIP (ideally hundreds of MB; up to the project target of ~500MB).

**Steps**
1. Start a timer.
2. Import the large pack ZIP.
3. Navigate to the UI file list and open at least one screen.
4. Measure time-to-first-usable (TTFU): the point where the user can select a screen and the tree appears.
5. Observe responsiveness during:
   - listing entries,
   - opening a screen,
   - switching between panels.

**Expected results**
- No crash/out-of-memory.
- TTFU is within the project target (120 seconds) on a typical PC network setup.
- The app does not fully extract the whole ZIP into memory; it should behave as “lazy load”.
