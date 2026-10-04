# JSON UI Workbench 0.16.1 — User guide

[日本語](USER_GUIDE_JA.md) · [Technical specification](TECHNICAL_SPEC_EN.md) · [Limitations](LIMITATIONS_EN.md) · [License](../../../LICENSE.md)

This application reads **Classic JSON UI** from Minecraft Bedrock resource packs so you can inspect its appearance and representative states outside the game. It does not start Minecraft or execute an add-on's JavaScript. Start with the small included example to learn the sequence: import, select a screen, preview, edit, and export.

**Preview support is limited to Classic UI. Pocket UI, including the touch-oriented UI commonly used on smartphones, cannot be previewed.** This distribution runs on a PC with Node.js; it is not a smartphone application. A device type and Minecraft's UI profile are separate conditions. See [Limitations](LIMITATIONS_EN.md) for the precise scope.

## 1. Choose an entry point

| Method | Entry point | Suitable work |
|---|---|---|
| Type commands in a terminal | CLI; the default in this guide | Validation, images, source editing, pack export |
| Call repeatedly from a program | Node API | Repeated rendering of one pack; AI integration |
| Send HTTP requests from Python or another language | HTTP API | Requests to a persistent local service |
| Inspect and edit with a mouse | Experimental GUI | Manual inspection and editing; review the unfinished features' results |

`npm start` **prints CLI guidance and exits**. Use `npm run gui` to open the browser interface. The existing `start.bat` is also a compatibility entry for the GUI. CLI and API calls do not automatically open a browser.

## 2. Install and prepare

1. Extract the entire distribution ZIP. Do not run files directly inside the ZIP. For example, use `C:\Tools\jsonui-workbench-0.16.1`.
2. Obtain a compatible **Node.js 22.14.0 or later**, with npm, from the [official Node.js website](https://nodejs.org/en/download). The baseline validation environment is Node.js 22.14.0.
3. On Windows, open the extracted folder in File Explorer, type `powershell` in the address bar, and press Enter. The terminal now starts with this folder as its working directory.
4. Run these commands one at a time.

```powershell
node --version
npm --version
npm ci --ignore-scripts
node local-node/cli.mjs help
```

`npm ci` installs the dependencies recorded in the included `package-lock.json`. `--ignore-scripts` disables dependency installation scripts. Initial package downloads require a network connection. **`npm ci` replaces an existing `node_modules` directory**, so run it in this application, not an unrelated project. JSON and SVG inspection are distinct from PNG rendering: PNG requires the optional `@napi-rs/canvas` dependency.

If Windows refuses `npm.ps1` under its execution policy, use `npm.cmd`, for example `npm.cmd ci --ignore-scripts` or `npm.cmd run gui` in the same folder. No execution-policy change is needed.

If Windows says `node` is not recognized, reopen the terminal after installation and check `node --version`. If `start.bat` has installed the application's private Node executable, use `.\.jsonui\runtime\node.exe` instead of `node`. Running the GUI launcher alone does not establish that npm and the PNG dependency have been installed.

On macOS/Linux, open a terminal, `cd` to the extracted directory, and use the same `node` and `npm` commands. The `/` separators in the commands below work in PowerShell and POSIX shells. Windows-specific commands such as `Get-Content` and `Invoke-RestMethod` are not POSIX shell commands.

## 3. Understand paths and names

| Example | Meaning |
|---|---|
| `outputs/manual-demo.mcpack` | An input pack on your PC. Ordinary relative paths are based on the current working directory |
| `outputs/manual-session.json` | The CLI working record: source paths and hashes, settings, and source edits |
| `ui/manual_demo.json` | A UI file **inside the pack**; it need not exist as a separate PC file |
| `manual.screen` | A UI definition: namespace `manual` combined with definition `screen` |
| `/screen/controls/2/card` | A JSON Pointer identifying a location in the authored JSON |

Quote paths containing spaces, for example `"C:\My Packs\sample.mcpack"`. Use the same `--session` file throughout one task. Without it, the CLI uses `.jsonui-cli/session.json` in the current working directory.

## 4. Produce your first preview with the included example

The tutorial uses original JSON, a white 1-pixel image, and an included synthetic OGG sound. It needs no Minecraft image or font. Its small screen contains no text, making it useful for checking PNG setup. **It is a renderer tutorial, not a complete add-on that opens an in-game form.**

```powershell
node docs/release/manual/examples/build-demo.mjs
node local-node/cli.mjs import --pack outputs/manual-demo.mcpack --session outputs/manual-session.json
node local-node/cli.mjs list --session outputs/manual-session.json
node local-node/cli.mjs definitions --file ui/manual_demo.json --session outputs/manual-session.json
node local-node/cli.mjs settings --file docs/release/manual/examples/settings-demo.json --session outputs/manual-session.json
```

`build-demo.mjs` creates a new `outputs/manual-demo.mcpack`. It stops if that file already exists and does not overwrite it. To repeat the exercise, choose a different name.

```powershell
node docs/release/manual/examples/build-demo.mjs outputs/manual-demo-2.mcpack
```

After confirming `ui/manual_demo.json` and `manual.screen` in the listings, run:

```powershell
node local-node/cli.mjs validate --file ui/manual_demo.json --definition manual.screen --strict-semantics --session outputs/manual-session.json
node local-node/cli.mjs preview --file ui/manual_demo.json --definition manual.screen --frame 0 --format json --strict-semantics --out outputs/manual-frame.json --session outputs/manual-session.json
node local-node/cli.mjs preview --file ui/manual_demo.json --definition manual.screen --frame 0 --format svg --strict-semantics --out outputs/manual-frame.svg --session outputs/manual-session.json
node local-node/cli.mjs preview --file ui/manual_demo.json --definition manual.screen --frame 0 --format png --strict-semantics --out outputs/manual-frame.png --session outputs/manual-session.json
```

Open `outputs/manual-frame.png`. It shows a dark background, a horizontal banner, a card on the left, and a switch below it. The detail area on the right stays hidden until the switch is activated. The settings use a 640 × 360 output with UI scale 2. At scale 2, one UI unit corresponds to approximately two output pixels.

| Output | Purpose |
|---|---|
| JSON | Inspect resolved values, frames, rectangles, bindings, and diagnostics |
| SVG | Inspect element boundaries and placement; it is not a textured or font-rendered image |
| PNG | An image rendered with supported textures, fonts, and other assets |

By default, an existing output file stops the command. Add `--force` only when you intend to replace your own output. **Even `--force` cannot make a source pack or the session file an output destination.**

## 5. Inspect your own packs and states

Follow the same sequence. Change the `import` input to your ZIP/MCPACK/MCADDON, then use `list` and `definitions` to find **actual** file and definition names. Use `--pack` for a regular pack and `--vanilla` for a vanilla reference pack; you may supply both together. You must have the right to use any reference assets.

```powershell
node local-node/cli.mjs import --pack "C:/MyPacks/addon.mcaddon" --vanilla "C:/MyPacks/reference.zip" --session outputs/my-session.json
node local-node/cli.mjs list --session outputs/my-session.json
```

When an MCADDON contains multiple resource-pack candidates, use `--resource-pack` with the header UUID reported by the diagnostic. The renderer does not automatically choose the first candidate. Default PNG output stops if required reference assets or glyphs are missing. Inspect the structure with JSON/SVG, or supply authorized assets before retrying.

Provide representative states for values the renderer cannot obtain from the running game. For example, save this as UTF-8 `outputs/state.json`:

```json
{
  "form": {
    "type": "action",
    "title": "Sample",
    "body": "Choose an item",
    "buttons": [{ "text": "Continue" }, { "text": "Close" }]
  }
}
```

```powershell
node local-node/cli.mjs settings --state-file outputs/state.json --replace-state --session outputs/my-session.json
```

This is **preview data**. It does not open a native form or create definitions missing from the imported pack. `--replace-state` replaces previous representative data and local toggle state. Advanced raw data uses the settings fields `mock_data` and `collections`. Check the [Technical specification](TECHNICAL_SPEC_EN.md) for typed `state` syntax and input conflicts.

Animation time is `frame / fps` seconds. `--frame 30 --fps 60` selects 0.5 seconds; `--frame 0` selects the start. If PNG time is omitted, it uses approximately one second after the start, so specify time explicitly for comparisons. Add `--strict-animation` to stop when animation quality remains unsupported or uncertain.

## 6. Read validation results

The CLI normally returns one JSON result. `ok: true` with exit code 0 means the command succeeded; `ok: false` with a nonzero code means it failed. PowerShell exposes the code as `$LASTEXITCODE` immediately after a command. Use `help` for human-readable guidance and `--language en` for English console descriptions.

Inspect `quality`, `stage_diagnostics`, and `diagnostics`, even when an image exists. `passed` means evaluated within the supported scope; `unknown` means unsupported behavior or incomplete observations remain; `failed` means a detected inconsistency; `not_evaluated` means no evaluation. `quality.native_properties` checks **recorded unsupported properties**, not the complete Minecraft specification.

`--strict-semantics` refuses uncertain resolution, collection-row references, visual/input bindings, and related checks for the selected UI. Default PNG output also stops on unresolved assets and other covered conditions. Use `--allow-partial` only for a deliberately incomplete diagnostic image. Explicit strict gates take precedence: this flag alone does not bypass a strict failure. `complete` and `preview_complete` **do not certify matching native pixels, interactions, or sound**.

## 7. Edit source, undo, and export

First move the tutorial card 12 UI units to the right.

```powershell
node local-node/cli.mjs edit --operation docs/release/manual/examples/move-demo.json --session outputs/manual-session.json
node local-node/cli.mjs preview --file ui/manual_demo.json --definition manual.screen --frame 0 --format png --strict-semantics --out outputs/manual-edited.png --session outputs/manual-session.json
node local-node/cli.mjs undo --session outputs/manual-session.json
node local-node/cli.mjs redo --session outputs/manual-session.json
```

The included `move-demo.json` sets the `offset` at `/screen/controls/2/card` to `[36, 56]`. Offset is relative to the anchors, not an absolute screen-pixel coordinate. The edit is saved in the session; **the input MCPACK remains unchanged**.

To edit the whole file in your own editor, extract the authored source:

```powershell
node local-node/cli.mjs read --file ui/manual_demo.json --out outputs/manual-authored.json --session outputs/manual-session.json
```

Edit `outputs/manual-authored.json`, save it as UTF-8, and apply it:

```powershell
node local-node/cli.mjs edit --file ui/manual_demo.json --text-file outputs/manual-authored.json --session outputs/manual-session.json
```

Rejected syntax and other rejected changes preserve the last committed edit. A new committed edit clears redo history. Undo has count and size limits; settings changes and UI selection are outside source undo.

Finally inspect dependencies and export a new pack:

```powershell
node local-node/cli.mjs export --file ui/manual_demo.json --definition manual.screen --plan --out outputs/manual-export-plan.json --session outputs/manual-session.json
node local-node/cli.mjs export --file ui/manual_demo.json --definition manual.screen --out outputs/manual-selected.mcpack --session outputs/manual-session.json
```

Export includes the **selected UI and its required dependencies**. It is not a full copy of an add-on's files, BP scripts, world, or player state. Unresolved dependencies stop export. The [Technical specification](TECHNICAL_SPEC_EN.md) covers the operation contract; the [legacy CLI reference in Japanese](../../../local-node/CLI-ja.md) provides additional pack-metadata and operation-JSON examples.

## 8. Use the GUI manually

```powershell
npm run gui
```

If the browser does not open automatically, use the local URL in the startup log. Do not double-click `editor-core/app/index.html` as a substitute. Keep the terminal open: it is running the server.

1. In the left-hand **“1 · パックを読み込む”** section (load a pack), select a ZIP/MCPACK. You can practice with the generated `outputs/manual-demo.mcpack`.
2. Select `ui/manual_demo.json` under **“JSON UIファイル”** (JSON UI file), select `screen` in the definition list below it, and press **“選択したUIをプレビュー”** (preview selected UI).
3. Use preview mode to inspect placement. Switch to **“編集モード”** (edit mode) to change it, and check the target and affected scope. Flow layout, dynamic offsets, and animated positions may prevent dragging; edit the source instead.
4. Commit pending canvas edits with **“JSON UIに確定”** (commit to JSON UI). Apply source-field edits with **“検証して反映”** (validate and apply). A failed commit or apply is not a saved edit.
5. Add the current UI under the **“書き出し”** (export) tab, inspect its dependencies, and save a pack. **Reloading the page loses the loaded pack and edits**, so export anything you need beforehand.
6. Use **“ログ・診断”** (logs and diagnostics) or the diagnostic bundle if something fails. Stop the server with Ctrl+C in its terminal.

The GUI is experimental. After visual editing, import its exported pack into a **separate CLI session**, then check `validate` and strict PNG at an explicit time. GUI memory is not automatically shared with a CLI session. The labels above are the source-verified Japanese controls; interface translation availability does not change these steps.

## 9. Node API: change the same UI's state

The included program is runnable. First generate the pack in section 4 and install the PNG dependency.

```powershell
node docs/release/manual/examples/sdk-demo.mjs
```

It creates `before.png`, `after.png`, and `result.json` in a new `outputs/sdk-demo` directory. It activates the switch once and passes the returned state to the next render, making the purple detail area appear on the right in `after.png`. The renderer closes in `finally`. Choose another output directory if it already exists:

```powershell
node docs/release/manual/examples/sdk-demo.mjs outputs/manual-demo.mcpack outputs/sdk-demo-2
```

The sequence is `createRenderer()`, `import()`, `render()`, `interact()`, `render()`, and `resolveSound()`. `interact()` returns the updated local toggle state. Carry `uiInstanceId`, the current `localToggleState`, and its `revision` into subsequent requests. The server does not retain the latest interaction state for you.

`audioIntent` **describes a playback request**. `resolveSound()` reports the registered OGG reference, hash, and preflight inspection. **This Node/CLI/HTTP example does not produce speaker output.** It is separate from the GUI's audio player. It does not execute arbitrary game commands or submit a native form. See the [Technical specification](TECHNICAL_SPEC_EN.md) for supported input and audio behavior.

## 10. HTTP API: call it from PowerShell

Run this in the first terminal and leave it running:

```powershell
node local-node/api-server.mjs --connection-file outputs/http-connection.json
```

Open another PowerShell in the project folder and run the following. Do not print the token or paste it into Git, shared files, or support logs.

```powershell
$connection = Get-Content outputs/http-connection.json -Raw | ConvertFrom-Json
$headers = @{ Authorization = "Bearer $($connection.token)" }
$importBody = @{ pack = (Resolve-Path outputs/manual-demo.mcpack).Path } | ConvertTo-Json
$importResult = Invoke-RestMethod -Method Post -Uri "$($connection.base_url)/api/renderer/v1/import" -Headers $headers -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($importBody))
$renderBody = @{
  file = "ui/manual_demo.json"
  definition = "manual.screen"
  format = "json"
  frame = 0
  width = 640
  height = 360
  uiScale = 2
  strictSemantics = $true
} | ConvertTo-Json -Depth 30
$renderResult = Invoke-RestMethod -Method Post -Uri "$($connection.base_url)/api/renderer/v1/render" -Headers $headers -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($renderBody))
$renderResult.result.quality
```

The service binds to loopback `127.0.0.1` and refuses ordinary browser requests carrying an Origin. It is not a server for other PCs or smartphones. Its workspace is in memory, separate from CLI session files. Stop it with Ctrl+C in the server terminal. The [entry-point guide](../../../docs/release/ENTRYPOINTS_JA.md#6-http-api-を使う) contains additional PowerShell examples, and the bilingual [Technical specification](TECHNICAL_SPEC_EN.md) documents the HTTP contract, including base64 PNG output.

## 11. Troubleshooting

| Symptom or code | Next step |
|---|---|
| No browser opens with `npm start` | Expected. Use `npm run gui` for the GUI |
| `RASTER_BACKEND_UNAVAILABLE` | Run `npm ci --ignore-scripts` in the project root; check the optional dependency for your OS/CPU |
| Missing fonts or textures | Supply an authorized reference pack; compare with this guide's font-free example |
| `CLI_DEFINITION_AMBIGUOUS` | Specify the complete `rawKey` from `definitions`; do not guess the first result |
| `POCKET_PREVIEW_BLOCKED` | Pocket rendering is unsupported; choose a Classic definition |
| `CLI_SOURCE_CHANGED` | The pack differs from the imported content; restore it or import into a new session |
| `CLI_SESSION_LOCKED` | Wait for the other session operation to finish; do not delete an active lock |
| `API_REIMPORT_REQUIRED` | Explicitly reimport the required packs after Worker recovery |
| An image differs from the game | Check scope, state, time, scale, and asset diagnostics; verify natively separately |

Save diagnostics with `node local-node/cli.mjs diagnostics --out outputs/diagnostics.json --session outputs/manual-session.json`. A standalone call records **this invocation**, not events from processes that already exited. Use a CLI workflow to capture related operations within one shared invocation; see the [Technical specification](TECHNICAL_SPEC_EN.md) and the [legacy Japanese CLI reference](../../../local-node/CLI-ja.md).

## 12. Terms and further reading

The project's original portions use **PolyForm Noncommercial License 1.0.0**. Read [LICENSE](../../../LICENSE.md) for permitted noncommercial use, modification, redistribution, and required notices. This is not a license for commercial use. Dependencies and imported assets retain their separate conditions. If combining the renderer with selling your work, check whether that purpose satisfies the license.

- [Technical specification](TECHNICAL_SPEC_EN.md): inputs, outputs, internal processing, and interaction API contracts.
- [Limitations](LIMITATIONS_EN.md): Classic/Pocket, rendering, states, sound, editing, and other boundaries.
- [Legacy detailed commands and operation JSON (Japanese)](../../../local-node/CLI-ja.md); use the new English specification for the current English contract.
- [Official Node.js downloads](https://nodejs.org/en/download) and [official npm ci documentation](https://docs.npmjs.com/cli/commands/npm-ci/): environment preparation.

Success with this guide does not establish complete compatibility with every Minecraft UI, version, or device. Test completed add-ons in the game separately.
