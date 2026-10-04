# Architecture Overview (S007)

> Current-state override: this document contains target/legacy statements. The shipping candidate vendors runtime dependencies locally and activates Vanilla only from a user-uploaded ZIP whose critical files parse. A structurally complete reference with unknown version metadata is usable with an explicit warning; a declared version/channel mismatch is blocked. `GITHUB_RAW` metadata alone is not restored automatically. Current behavior is authoritative in `README.md` and `docs/VANILLA_RESOURCE_PACK_JA.md`.

This document defines the **high-level architecture** and **module boundaries** for the **JSONUI Web Editor**.

The editor is a **static, fully client-side** web application (no server-side processing). It must import/export Minecraft Bedrock Resource Pack ZIPs, edit JSON UI via GUI, and provide a Bedrock-aligned preview.

> Note: This doc focuses primarily on **logical modules and interfaces** so implementation can be reorganized without changing behavior.

---

## Repository layout (locked in S009)

The snapshot defines the baseline folder layout under `PROJECT/`:

```text
PROJECT/
  app/      # Static web assets to serve (index.html, CSS, JS entrypoints)
  src/      # Application source code (ES modules)
  docs/     # Architecture/spec/user docs
  tests/    # Unit tests (browser-runnable harness planned)
  vendor/   # Pinned third-party libs (vendored or referenced with SRI)
  SPEC/     # Locked requirements and specs
  reference/# Research logs and user-provided reference inputs
```

### Static hosting approach

- **Baseline (no build step):** use native browser ES modules (`<script type="module">`).
- **Import maps are allowed** for mapping "bare" module specifiers to URLs when needed.
- **Bundler:** **TBD**. If later required for performance or DX, adopt a bundler, but keep the output as a static site.

---

## 1) Goals and non-goals

### Goals

- A **modular architecture** with clear responsibilities, minimal cross-module coupling, and testable pure-logic components.
- Deterministic behavior:
  - stable parsing/serialization behavior,
  - deterministic asset resolution and export packaging.
- Performance safety:
  - **never fully extract** ZIPs,
  - enforce limits and bounded caches,
  - keep the UI responsive (chunk work / optional workers).
- Security safety:
  - treat all imported content as **untrusted input**,
  - prevent XSS by avoiding unsafe DOM sinks,
  - enforce ZIP-bomb and path normalization rules.

### Non-goals (in this step)

- No detailed implementation.
- No pixel-perfect parity to the Bedrock engine preview (this is developed incrementally via milestones).
- No undo/redo support (locked policy).

---

## 2) Locked policy decisions and constraints

These are locked in `PROJECT/SPEC/decisions.md` and drive architecture.

- `EXPORT_PACKAGING_POLICY=UI_PLUS_DEPS`
  - Export a minimal valid RP ZIP: always `ui/`, `manifest.json` (auto-generate/update), `pack_icon.png` (auto-provide), plus only referenced `textures/`, `texts/`, `font/`.
- `MOBILE_EDITING_SCOPE=FULL_EDITING`
  - Mobile best-effort full editing; PC recommended; not acceptance-tested.
- `UNDO_REDO_POLICY=NONE`
  - No undo/redo system; state store is simpler (no history).
- `VANILLA_REFERENCE_FALLBACK=USER_UPLOAD_VANILLA_ZIP`
  - Vanilla assets loaded from GitHub raw by default; fallback to user-uploaded Vanilla ZIP.

Primary constraints (from `PROJECT/SPEC/requirements.md` and `PROJECT/SPEC/nonfunctional.md`):

- **Client-only**: no server processing or storage.
- Potentially large packs (~500MB): must be **lazy** and **bounded**.
- Vanilla reference cannot be hosted on same domain; must fetch remote or user-upload.

---

## 3) High-level module map

### 3.1 Core modules

| Module | Responsibility (must own) | Key inputs | Key outputs |
|---|---|---|---|
| `pack-io` | Import ZIP, list entries lazily, read files with limits, build file index. Provide abstraction for pack sources (imported ZIP + Vanilla reference + overlay). | User ZIP file; immutable remote metadata; Vanilla-derived workでは対象版の公式Vanilla `full` ZIP | File index; `PackSource` resolver; pack metadata |
| `model` | Internal representation of UI screens and supported elements. Normalization, defaults, unknown-field retention policy, stable serialization. | JSON UI (screen files), `_ui_defs.json`, `_global_variables.json` | In-memory UI model; deterministic JSON output |
| `editor` | UI state and GUI interactions: tree, selection, property editing, add/duplicate/delete, search, keyboard commands. | Model objects; user input events | Updated model; editor UI state |
| `preview` | Bedrock-aligned preview approximation: layout calculation, asset rendering (textures/fonts/texts), bindings evaluation subset, navigation simulation. | Model + mock data; resolved assets | Rendered preview; computed layout + hit testing |
| `validation` | Diagnostics pipeline: syntax/schema checks, reference checks (assets/vars/text keys), warnings for breaking changes, export gate (block on errors). | Model + pack sources + asset index | Diagnostics list (errors/warnings), “can export?” decision |
| `export` | Build minimal output RP ZIP per packaging policy, including dependency pruning. | Current project state; validation results; dependency graph | Exported ZIP blob + manifest updates |

### 3.2 Cross-cutting utilities (shared)

These are not “major modules” but are shared by multiple modules:

- `state-store`: central store + action dispatch + subscription; **no undo**.
- `diagnostics`: severity-tagged logging and error capture; safe rendering of messages.
- `i18n`: string table lookup and language toggle; no hard-coded strings.
- `path`: normalization utilities (case, separators, `..` rejection) for deterministic file resolution.
- `cache`: bounded LRU caches (text, images, fetched remote files).

---

## 4) Data flow (end-to-end)

### 4.1 Import and indexing

```text
User selects ZIP
  -> pack-io.ZipReader.openFromFile()
  -> pack-io.listEntries()  (NO full extraction)
  -> pack-io.validateLimits()  (size/count/ratio)
  -> pack-io.buildFileIndex()
  -> pack-io.detectPackMetadata()  (manifest.json, ui root, system files)
  -> state-store.setProject({ packMeta, fileIndex, sources })
```

Key points:

- `pack-io` enforces **zip-bomb limits** and **path normalization** before the rest of the app trusts file paths.
- `pack-io` returns *handles* to entries and reads content only on demand (`readText`, `readBlob`).

### 4.2 Load a UI screen for editing

```text
User selects screen
  -> pack-io.readText(screenPath)
  -> jsonc.parse() (JSON-with-comments)
  -> model.fromJson(screenJson)
  -> state-store.openFile(screenPath, model)
  -> editor renders tree + properties for current selection
```

### 4.3 Preview rendering loop

```text
state-store (model + editor state + mock data)
  -> preview.computeLayout(model, viewport)
  -> preview.resolveAssets(model, packSources)
  -> preview.render(layout, assets)
```

Notes:

- Layout and asset resolution are **derived** (computed) data.
- Expensive steps should be debounced and/or offloaded to workers later (performance hardening phase).

### 4.4 Validation and export gate

```text
On load / on edit / before export:
  -> validation.run(model, packSources)
  -> diagnostics.update(errors, warnings)

Before export:
  -> if diagnostics.hasErrors: block export
  -> else export.buildZip(model, deps, manifest)
```

## 5) State management

### 5.1 Store approach

Use a minimal, framework-agnostic state store:

- Single store object (`AppState`)
- Dispatch actions (`dispatch(action)`) that:
  - update state immutably or via controlled mutation,
  - notify subscribers.
- No undo/redo (policy `UNDO_REDO_POLICY=NONE`).

### 5.2 Proposed state shape (conceptual)

```text
AppState
  project:
    packMeta
    sources:
      importedPack: PackSource
      vanillaRef: PackSource
      overlay: PackSource
    fileIndex
    openFiles:
      currentFilePath
      filesByPath: { path -> FileModel }
  editor:
    selection: { nodeId, path }
    ui:
      leftPanelWidth
      rightPanelWidth
      activeTab
      searchQuery
  preview:
    viewport
    zoom
    pan
    computed:
      layoutTree
      hitMap
      assetCacheKeys
  diagnostics:
    entries: [ {severity, code, message, path?, line?, stack?} ]
  settings:
    language: 'en_US' | 'ja_JP'
    vanillaMode: 'REMOTE' | 'USER_ZIP'
```

### 5.3 Action boundaries

- `pack-io` is the only module allowed to:
  - open ZIPs,
  - fetch remote Vanilla files,
  - read blobs/text with limits.
- `model` is the only module allowed to:
  - normalize/serialize UI models.
- `editor` can update state only through actions such as:
  - `selectNode`, `updateProperty`, `addElement`, `deleteElement`, `reorderChildren`.
- `preview` must be pure with respect to layout calculation (inputs -> computed outputs). Rendering may be side-effectful but should be isolated.
- `validation` must be pure with respect to analysis (inputs -> diagnostics).

---

## 6) Key interfaces (contract-first)

These interfaces define the boundaries and make unit testing feasible.

### 6.1 Pack sources and overlay

```ts
interface PackSource {
  listFiles(prefix?: string): Promise<string[]>;
  readText(path: string): Promise<string>;   // enforces MAX_TEXT_FILE_BYTES_FOR_PARSE
  readBlob(path: string): Promise<Blob>;     // enforces per-entry decode limits
  exists(path: string): Promise<boolean>;
}

interface OverlayPackSource extends PackSource {
  // Reads from override first (imported), then fallback (vanilla)
  resolve(path: string): Promise<'override'|'fallback'|'missing'>;
}
```

### 6.2 UI model

```ts
interface UiNode {
  id: string;          // stable internal id (may map to JSON name)
  type: string;        // panel, label, button, ...
  props: Record<string, unknown>;
  bindings?: Record<string, unknown>;
  children?: UiNode[];
  unknown?: Record<string, unknown>; // preserve unknown JSON fields per spec
}

interface UiScreenModel {
  formatVersion?: string;
  root: UiNode;
  toJson(): object;    // deterministic
}
```

### 6.3 Validation

```ts
type Severity = 'ERROR'|'WARN'|'INFO';

interface Diagnostic {
  severity: Severity;
  code: string;              // stable identifier
  message: string;           // safe for textContent
  filePath?: string;
  location?: { line: number; column: number };
}

interface Validator {
  run(model: UiScreenModel, sources: PackSource): Promise<Diagnostic[]>;
}
```

### 6.4 Export

```ts
interface Exporter {
  buildResourcePackZip(params: {
    modelFiles: Record<string, string>;  // ui/ JSON outputs
    deps: { textures: string[]; texts: string[]; fonts: string[] };
    baseManifest?: object;
  }): Promise<Blob>;
}
```

---

## 7) Performance and threading strategy

- **Lazy-read always**:
  - list entries and build an index first,
  - only read file content when requested.
- Bounded caches (per `PROJECT/SPEC/nonfunctional.md`):
  - text cache bytes cap,
  - image decoded bytes cap (desktop vs mobile),
  - derived UI model size hints.
- Main-thread safety:
  - chunk expensive loops,
  - debounce preview recompute on rapid edits.
- Optional Web Workers:
  - ZIP operations, JSON parsing, and heavy validation can move to workers in later hardening steps.

---

## 8) Security boundaries

- Treat imported pack content as **untrusted**:
  - no `innerHTML` for any user-controlled text,
  - render raw JSON/logs as escaped text.
- ZIP security:
  - enforce max compressed size, max entry count, max total uncompressed size,
  - reject encrypted ZIPs,
  - sanitize paths (`..`, absolute paths, NUL byte rejection).
- Network security:
  - Vanilla fetch allowlist only (GitHub raw default),
  - timeouts + retries + session cache.

---

## 9) Testability and verification strategy

- Prefer pure-logic modules for:
  - path normalization,
  - JSONC parse + deterministic stringify,
  - asset resolution rules,
  - validation rules.
- Keep UI code thin and rely on:
  - contract tests for module interfaces,
  - unit tests for “model <-> JSON” round trips,
  - fixture packs for import/export smoke testing.

---

## 10) Implementation sequence alignment

This architecture is designed to align with the planned steps:

- S008: formalize internal data models.
- S009+: lock repository layout and start implementing store, panels, pack-io, parser, diagnostics.
- S039+: validation v1/v2.
- S050+: export ZIP.
