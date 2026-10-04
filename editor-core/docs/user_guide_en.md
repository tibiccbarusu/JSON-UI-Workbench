# JSONUI Web Editor — User Guide (EN)

This guide explains how to import a Minecraft Bedrock **Resource Pack**, edit **JSON UI** files using the GUI, preview (Canvas), validate, and export.

> Scope note: This is a **static, client-side** application. No server-side processing is used. Large packs are handled via indexing + lazy reads where possible.

## 1. Recommended environment

- **Recommended**: PC + Chrome (latest stable)
- **Supported**: tablet/phone browsers use a vertically stacked, page-scrollable layout. A desktop is still recommended for large packs.
- Runtime ZIP/JSONC dependencies are vendored. Use an uploaded Vanilla ZIP for
  a complete, indexed Vanilla reference; remote metadata alone is not a verified restore path.

## 2. Run locally

Serve the repository root with any static server.

Example:

```bash
cd PROJECT
python -m http.server 8000
```

Then open:

- `http://localhost:8000/app/`

## 3. Editor layout

The main Editor route uses a three-panel layout:

- **Left**: Tree (UI element hierarchy)
- **Center**: Tabs (Canvas / Preview)
- **Right**: Properties (forms) + Raw JSON / Debug (depending on tab)

Top navigation:

- **Editor**: main workflow (import, open files, edit)
- **Help**: quick links to docs and known limitations
- **Logs & diagnostics**: searchable runtime logs, errors, warnings, version/display context, and safe downloads

## 4. Import a Resource Pack ZIP

1. Open **Editor**.
2. In the Import section, choose a `...resourcepack.zip` file.
3. The app reads `manifest.json`, indexes pack entries, and detects UI files under `ui/`.

Expected results:

- The app shows pack metadata (name/version) when available.
- The UI file list becomes available for selection.

### 4.1 Vanilla reference (Vanilla-first resolution)

This editor resolves assets and UI includes using a **Vanilla-first** policy:

- If the imported pack overrides a path, the override is used.
- Otherwise, the app tries to resolve from a Vanilla reference source.

Verified Vanilla reference source:

1. **User-uploaded Vanilla Resource Pack ZIP**

Upload the matching official full Vanilla ZIP from the pack composition section in the left panel.

## 5. Open and manage system UI files

Bedrock JSON UI commonly uses these system files:

- `ui/_ui_defs.json`: screen registry (which screen JSON files are part of the pack)
- `ui/_global_variables.json`: global variables used by UI (colors, sizes, localized string keys, etc.)

In the Editor UI you can:

- View and edit `_ui_defs.json` entries (add/remove/reorder)
- View and edit global variables in `_global_variables.json`

## 6. Open a screen and inspect the tree

1. Pick a screen file from `_ui_defs.json` or the screen picker.
2. The app parses JSON-with-comments (JSONC) and builds an internal model.
3. The left tree shows the control hierarchy (ids/types when available).

Notes:

- Vanilla UI heavily uses **templating and inheritance** (`name@namespace.template`).
- Some nodes may not show a `type` directly because the type is inherited.

## 7. Editing controls (GUI)

Typical workflow:

1. Select a node in the tree.
2. Edit fields in the **Properties** panel.
3. Observe changes in the **Preview** tab (Canvas-based).
4. Use context actions (duplicate/delete) when available.

Key capabilities depend on the supported subset of element types:

- Supported (GUI): `panel`, `label`, `button`, `image`, `stack_panel`, `grid`, `scroll_view`, `edit_box`
- Not yet supported: renderer-driven/custom/factory controls (common in Vanilla HUD)

## 8. Preview (Canvas-based)

The editor currently provides its interactive preview via a Canvas-based renderer:

- Layout boxes / bounding outlines
- Selection highlight
- **Display zoom** changes only the on-page magnification.
- **UI scale** converts physical Minecraft pixels to Classic UI logical coordinates (`Auto`, or `1×` through `6×`).
- **Device resolution** selects the physical viewport (HD, Full HD, QHD, or 4K).
- **Fit UI** changes display zoom so the current UI bounds fit the preview.
- Pan

The left panel has its own vertical scrolling region. Its header buttons make the panel narrower, wider, or restore the default width.

Some vanilla files use runtime collections, factories, and game-state bindings that a browser cannot reproduce exactly. Unknown branches fail closed in normal view and remain inspectable in structure view.

## 9. Validation and Logs & diagnostics

The editor runs validation on load and before export.

- **Errors** block export.
- **Warnings** do not block export.

Important: Vanilla HUD screens often contain many advanced patterns:

- dynamic string references (`"$var"`, `"#binding"`, `"@..."`)
- template inheritance (missing `type` on derived nodes)
- unsupported control types (`custom`, `factory`)

For these patterns, the validator is designed to be **vanilla-friendly**:

- Dynamic references are treated as valid (not fully expanded/evaluated), and reported compactly.
- Inherited nodes without `type` are not treated as errors.

Use **Logs & diagnostics** to view and download:

- runtime logs
- parse errors
- validation issues (with file/node context)

## 10. Export a Resource Pack ZIP

Export creates a minimal valid Resource Pack per policy:

- includes edited `ui/` files
- generates/updates `manifest.json`
- includes `pack_icon.png`
- includes only referenced dependencies where possible (textures/texts/font)

If export is blocked:

- open the validation list
- fix **Errors** first (warnings can be ignored)

## 11. Known limitations (high-level)

- **Undo/Redo**: not implemented (policy: NONE)
- **Mobile**: the panels stack vertically; very large packs are still easier to inspect on desktop
- **Vanilla HUD editing**: many nodes are unsupported (renderer-driven/custom/factory)
- **Dynamic values**: `$var` / `#binding` / `@...` may not be evaluated in preview; values are preserved for export
- **Inheritance/Vanilla base expansion**: not complete; complex HUD files may remain box-oriented

## 12. Additional references

- Demo scenarios: `docs/DEMO_SCENARIOS.md`
- Acceptance checklist: `docs/ACCEPTANCE_CHECKLIST.md`
