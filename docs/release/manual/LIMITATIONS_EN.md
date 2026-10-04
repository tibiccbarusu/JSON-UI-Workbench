# JSON UI Workbench 0.16.1 — Limitations and cautions

日本語: [注意事項・対応範囲](LIMITATIONS_JA.md) · [User guide](USER_GUIDE_EN.md) · [Technical specification](TECHNICAL_SPEC_EN.md)

This document explains what a preview can and cannot establish. The target is **Classic JSON UI for Minecraft: Bedrock Edition**. The tool evaluates supported features outside the game, using the state and assets you provide.

## 1. Classic UI only; smartphones are unsupported

**This tool targets Classic UI development on desktop systems. Running the tool on a smartphone, or rendering and testing Pocket or touch-oriented UI, is unsupported.** Use a desktop environment with Node.js and local file access.

UI identified as Pocket can be listed and inspected as source, but its preview stops with `POCKET_PREVIEW_BLOCKED`. Setting the viewport to phone dimensions does not reproduce Pocket layout, touch input, device safe areas, or other mobile behavior.

This is a limitation of the renderer. It does not, by itself, determine whether Minecraft on a particular mobile device offers a Classic profile or whether an individual add-on works there. Treat the Classic/Pocket profile, device, and input method as separate conditions.

OreUI and Script API Data-Driven UI (DDUI) execution and rendering are also unsupported. Changing a local toggle with `interact()` does not execute DDUI Observables or reactive forms inside Minecraft.

## 2. Support matrix

“Supported” means the stated implementation exists. “Conditional” requires suitable inputs, assets, and structures. “Unsupported” means the tool does not provide that operation. “Unverified” is separate from implementation status: the release checks did not verify that behavior.

| Area | Status | Scope and conditions |
|---|---|---|
| Classic JSON UI import and definition selection | Supported | Resource packs within ZIP / MCPACK / MCADDON. Explicitly select among multiple RPs or definitions. |
| JSON frame output | Supported | Evaluated properties, layout, and diagnostics; not an image rendered with actual assets. |
| SVG output | Supported | A diagnostic view of layout and bounds; not final game text and texture rendering. |
| PNG output | Conditional | Requires a supported canvas backend, required textures/fonts/models, and evaluable state. |
| Bindings, collections, inheritance, and generated controls | Conditional | Implemented expressions and generation rules with supplied state; not every game-specific mechanism. |
| Animation at a specified time | Conditional | Samples supported tracks at absolute time; does not reproduce the native clock or actual event order. |
| Local state changes through `interact()` | Conditional | Explicit `activate` / `escape` on a node and supported input mappings. The applied effect is `localTogglePatch`. |
| Sound resolution through CLI / Node / HTTP | Conditional | Returns references, format checks, hashes, and related metadata for registered short OGG Vorbis / PCM16 WAV. No playback. |
| Audio in the experimental GUI | Conditional | Uses a Node connection and Web Audio to attempt supported short-sound playback. Browser permission and decoding support also apply. |
| Source editing, undo / redo, and selected export | Conditional | Operations and dependencies that can be established safely. Drafts, source history, and preview state are distinct. |
| PowerPoint-style GUI editing | Experimental | Incomplete; shared definitions, inheritance, and generated controls impose restrictions. |
| Pocket / touch UI preview | Unsupported | Indexing and source inspection only. |
| Smartphone use of the tool | Unsupported | A desktop Node.js environment is the target. |
| OreUI / DDUI | Unsupported | No OreUI renderer or DDUI Script API runtime. |
| Minecraft or Behavior Pack script execution | Unsupported | Importing an MCADDON does not execute its BP as a game. |
| Real inventory, crafting, trading, or item transfer | Unsupported | Supplied mock state can be displayed; game inventory and the world are not changed. |
| Native form submission/reopening and server responses | Unsupported | An interaction effect can be described without being executed in the game. |
| Complete 3D rendering of every block, item, or entity | Unsupported | Limited to individual supported model paths, assets, and preview states. |
| Minecraft device comparison and audible playback for this release | Unverified | Separate from internal regression checks. |
| Actual Windows startup and browser audio output for this release | Unverified | Linux / Node checks do not automatically establish either. |

## 3. What “success” and “complete” mean

A saved image or API response with `ok: true` does not establish correct behavior in Minecraft. Check the relevant quality axes and diagnostics.

| Field | Meaning |
|---|---|
| `ok: true` | That API operation completed; not a Minecraft behavior pass. |
| `complete` | Completion of PNG resource/raster information, not comprehensive animation, playback, or native behavior verification. |
| `preview_complete` | Checks completed within the supported scope for assets, evaluation, collections, visual/input bindings, and recorded unsupported properties. |
| `quality.animation` | An independent axis for animation at the requested time. Do not infer it from `preview_complete`. |
| `quality.native_properties` | Checks recorded incompatibilities only; not conformance to the complete native schema. |
| `unknown` / `not_evaluated` | Uncertain or not checked. Do not reinterpret either as a pass. |
| `draft: true` | A diagnostic result allowing missing information or other partial conditions; not evidence of a complete screen. |
| `native_equivalence: 'not_evaluated'` / `native_parity_verified: false` | This result does not establish Minecraft device parity. |
| `playback: 'not_executed'` | Sound metadata or an intent exists, but that API did not produce audio. |

`--strict-semantics` applies strict checks to selected-projection resolution, evaluation, collections, visual/input bindings, recorded properties, and related evidence. `validate` does not evaluate an entire frame or produce PNG. Add `--strict-animation` to a preview when animation quality must also be an acceptance condition.

Ordinary PNG output stops when required information or supported rendering is missing. `--allow-partial` explicitly permits diagnostic partial rendering; it does not improve native compatibility and does not override the failure conditions of `--strict-semantics` or `--strict-animation`.

## 4. State, interactions, and animation boundaries

Forms, variables, collections, scroll positions, and time are supplied preview state. They are not necessarily the latest state read from Minecraft. If a title, body, row, or button changes in the game, provide the required state and inspect multiple previews.

`interact()` can update supported local toggles while retaining a form descriptor and `uiInstanceId`. This does not prove successful native input without closing and reopening the game form. Pass the returned `localToggleState` to the next request. Do not use saved local state to override an externally bound control or mix state from another UI.

`expectedRevision` checks consistency with the state supplied in the request. The server does not keep the latest snapshot, so an old snapshot paired with its old revision can be replayed. The caller must store the latest state and manage concurrent users when needed.

The interaction API applies only `localTogglePatch`. Described navigation, form submission, clipboard, or other effects are not executed by that API. It is not a drag/key replay system or a reproduction of the game's input loop. The GUI has individual interaction paths whose execution scope need not match API effect descriptions.

Animation is sampled at the requested time and event conditions. Native screen creation, clocks, event order, side effects, input latency, and server synchronization are unverified. Recorded combinations of `looping` on `uv` / `size` / `offset`, and some `flip_book` attachments, retain compatibility diagnostics. Successful numerical sampling does not remove those diagnostics.

## 5. OGG, WAV, and audible playback limits

Registered sound IDs resolve to assets in loaded packs. `resolveSound()` is not an arbitrary OS file reader and does not return audio bytes or play through speakers.

Supported short sounds are **OGG Vorbis or PCM16 WAV, 1 / 2 channels, 8,000–192,000 Hz, and no longer than 10 seconds**. Additional limits include a 4 MiB encoded file and an 8 MiB decoded PCM reservation. Even a sound under 10 seconds can be rejected because of its reservation, packet count, structure, or another limit.

Opus, FSB, chained OGG, and long streaming playback are unsupported. Renaming a file to `.ogg` does not convert it to Vorbis. If OGG and WAV share an ambiguous sound name, specify the extension in the sound definition.

Browser playback in the GUI does not reproduce Minecraft category volume sliders or positional 3D audio. Relevant definitions report `AUDIO_PREVIEW_CATEGORY_MIXER_NOT_APPLIED` / `AUDIO_PREVIEW_POSITIONAL_NOT_APPLIED`. Weighted candidate selection need not match the game's random sequence. Supported combined pitch is 0.5–2, output gain is capped at 1, and the GUI has a separate preview volume control.

Audio permission, disabled preview audio, zero volume, preparation time, decoding failure, concurrent voice limits, or memory budgets may prevent playback. Resolving an asset, passing format inspection, or requesting Web Audio playback does not prove sound was heard through speakers. Audible browser and native audio were not verified for this release.

## 6. Textures, fonts, items, and 3D models

The public source does not bundle Minecraft / Mojang textures, fonts, audio, skins, models, or complete UI. Load necessary bases and assets from appropriately licensed reference packs matching the target game version. Pack priority, content, language, UI scale, and viewport dimensions can change the result.

Missing assets or required inputs produce diagnostics. Strict PNG output does not fill missing assets with unrelated images and call the result complete. JSON / SVG bounds alone need not match PNG's final glyph measurement and reflow, native font metrics, or game layer order.

Numeric item ID tables depend on the target version. Not every custom item, auxiliary value, NBT state, dye, enchantment, or dynamic appearance is reproduced. If an item reports `NATIVE_ITEM_MODEL_REQUIRED`, do not interpret a face texture as a finished item icon.

Supported player / horse model paths are not a renderer for every entity's game pipeline. Player previews use model and skin data from reference packs; they do not automatically retrieve the user's account skin. Cameras, materials, controllers, and states outside the implementation are diagnosed or unsupported.

## 7. Diagnostics are narrow compatibility checks

Current recorded-property diagnostics include these cases:

| Authored field | Diagnostic scope |
|---|---|
| `label.vertical_alignment` | Recorded native rejection. Preserved in source; not used for preview vertical placement. |
| `focus_enabled` on passive `panel` / `image` | Presence is diagnosed even when `false`. This is not a ban on all input-capable types. |
| `collection_index` inconsistent with a concrete immediate parent | Narrow row-ownership and parent-context checks. Not a blanket ban on standalone templates or all collection reads. |
| `looping` on specific animation types and related cases | Compatibility uncertainty in animation quality. Not a blanket ban on every `looping` or `flip_book`. |

This is not a complete schema validator that prohibits every unknown property. Absence of a diagnostic does not establish that all properties, including those in future game versions, are valid.

Binding resolution through a global fallback and missing collection context can report concerns independently from successful calculation. Scanning and observation limits produce `unknown` or incomplete-observation evidence. Omitted diagnostics do not mean no issues exist.

## 8. Large UIs, editing, and outputs

Node counts, generated controls, depth, draw rectangles, image memory, request time, and response size are bounded. Major examples include 50,000 model nodes, 5,000 PNG rectangles, 8,192 px per PNG dimension, 16 Mi pixels total, and a 24 MiB frame response. These are renderer budgets, not Minecraft UI capacity limits or FPS guarantees. See the [technical specification](TECHNICAL_SPEC_EN.md) for the full list and scope.

`--frame-summary` requests a JSON summary of a large frame. It does not return full diagnostic text, a renderable frame, or PNG, and it does not bypass generation or evaluation limits. Passing each isolated part of a screen does not substitute for passing the entire screen.

Experimental GUI edits can affect multiple controls using the same shared definition. A generated cell may have no independent source. Moving, deleting, or detaching inheritance cannot always be applied independently to any chosen element. Distinguish draft review, committing to source, and export.

Source undo / redo is bounded and does not reverse every preview click, settings change, or UI selection. CLI source history retains at most 64 entries / 8 MiB, with an additional session-wide limit. Dropped history or an oversized individual edit can make undo unavailable.

The design keeps original archives unchanged and writes to a separate output. Still inspect source, diagnostics, and reimported output to confirm the intended result. Do not bypass output protections to write over the input.

## 9. Before publishing an add-on

1. Record the game version, Classic profile, input method, reference pack, language, dimensions, and UI scale.
2. Inspect necessary states after buttons, toggles, rows, scrolling, and animation time change, as well as the initial screen.
3. Apply strict options to the scope you intend to check. Read `quality`, missing information, `unknown`, and any partial-render indicators.
4. Separately check game display, input, form responses, scripts, inventory, and audio in Minecraft and its Content Log when relevant.
5. Inspect code and assets included in the distribution and the contents of shared diagnostic files. Diagnostics can contain pack content, names, and local paths.

These steps distinguish what the renderer output establishes from what requires in-game confirmation.

## 10. Licensing, assets, and references

Use project code and documentation under the distribution's [license document](../../../LICENSE.md). Check that document and the formal license for the precise scope of noncommercial use, modification, redistribution, and restrictions on commercial use. Audio, images, Minecraft assets, and third-party libraries retain their owners' independent terms. Import support does not grant redistribution rights to an add-on's assets.

This is an independent development tool, not an official Mojang / Microsoft product. See [third-party notices](../../../THIRD_PARTY_NOTICES.md).

The [user guide](USER_GUIDE_EN.md) and [technical specification](TECHNICAL_SPEC_EN.md) are the current references for operation, inputs, and outputs. Counts and limits in older verification records describe those versions. See [0.16.0 verification scope](../VERIFICATION_0160_JA.md) for the preceding changes, and [interaction/audio API](../INTERACTION_AUDIO_JA.md), [asset policy](../ASSET_POLICY.md), [item rendering](../item-rendering.md), and [evaluation limits](../limits-performance.md) for individual historical details.

Primary references checked for external specifications on 2026-10-04 UTC:

- [Microsoft Learn: JSON UI](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/jsonuireference/examples/jsonuilist?view=minecraft-bedrock-stable)
- [Microsoft Learn: Introduction to DataDriven UI](https://learn.microsoft.com/en-us/minecraft/creator/documents/scripting/intro-to-ddui?view=minecraft-bedrock-stable)
- [Microsoft Learn: Creating and Adding Custom Sounds](https://learn.microsoft.com/en-us/minecraft/creator/documents/addcustomsounds?view=minecraft-bedrock-stable)
- [Mojang: sound definitions schema](https://github.com/Mojang/bedrock-schemas/blob/main/schemas/rp/sounds/index.schema.json)

Support claims are based on this tool's implementation. They do not imply support for every Minecraft feature documented by those sources.
