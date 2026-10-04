# JSON UI Workbench 0.16.1 Technical Specification

[日本語](TECHNICAL_SPEC_JA.md) · [English user guide](USER_GUIDE_EN.md) · [Limitations and notices](LIMITATIONS_EN.md)

This document specifies the public inputs, outputs, and implementation boundaries of release 0.16.1. Version 0.16.1 updates documentation and licensing while preserving the 0.16.0 execution implementation. Proposed future features are outside the current specification. A `passed` result applies only to the scope of that particular check.

## 1. Scope and entry points

The target is Minecraft Bedrock **Classic JSON UI**. The renderer imports packs, selects definitions, and computes layout, rendering, and diagnostics using explicitly supplied state. It does not execute Minecraft, Behavior Packs, Script API, or native screen controllers.

Pocket JSON UI can be listed, read, and edited, but its preview is blocked. OreUI, DDUI, and smartphone Pocket/touch UI reproduction are outside scope. Support for the Classic rendering profile does not imply support for using the tool on a smartphone.

| Entry point | Status | Execution and state lifetime |
|---|---|---|
| CLI `local-node/cli.mjs` / `npm start` | Primary | Owns a loopback server/Worker for one invocation; stops them at exit. Settings and authored edits persist in session JSON |
| Node SDK `local-node/api.mjs` | Supported | `createRenderer()` owns a server/Worker and retains imported packs until another `import()` or `close()` |
| HTTP `local-node/api-server.mjs` / `npm run api` | Supported | Persistent authenticated loopback API backed by one shared SDK renderer |
| Browser GUI `npm run gui` | Experimental | Explicit opt-in. Provides UI adapters for editing, pointer input, and browser audio; these are not evidence of native execution |

Node.js **22.14.0 or later** is required. Public modules are ESM. PNG requires the optional `@napi-rs/canvas` 0.1.100 dependency and the necessary pack assets. Importing the SDK module alone starts no browser or subprocess and does not edit or save files.

## 2. Pack and definition inputs

Inputs are local ZIP, MCPACK, and MCADDON files. The selected Resource Pack in a MCADDON is imported; its Behavior Pack is not executed. When multiple RPs are present, specify the RP manifest UUID. The public SDK does not provide URL downloads, direct directory import, or game-state acquisition.

A stack has at most two layers: `vanilla` and `imported`. Imported definitions and assets take precedence when both layers provide the same resource. UI definitions, global variables, references, and assets are cataloged before the selected definition is projected. `file` is a **pack-relative path**, such as `ui/example.json`; `pack` is the **archive path on the operating system**.

| Selector | Type and constraints | Used by |
|---|---|---|
| `file` | Nonempty string, at most 1,024 characters, no control characters | definitions / validate / render / interact |
| `definition` | Same string constraints; matches `id`, `rawKey`, `localName`, or `qualifiedName` | Same methods |
| `kind` | `imported` or `vanilla` | list / definitions / validate / render / interact |

`definitions()` lists the filtered catalog and returns `count` / `items` for zero or multiple matches. The following screen-selection rules apply to `validate`, `render`, and `interact`. Some selectors may be omitted when exactly one candidate remains. Multiple candidates produce `CLI_DEFINITION_AMBIGUOUS`; no candidate produces `UI_DEFINITION_NOT_FOUND`. Screens are not selected by guessing their names. Without `kind`, the higher-precedence record wins for the same file and qualifiedName. A recommended definition in typed-state diagnostics does not create missing definitions in an arbitrary pack.

## 3. Common Node SDK contract

```javascript
import { createRenderer, JsonUiApiError } from './local-node/api.mjs';
const renderer = await createRenderer({ language: 'en' });
try {
  await renderer.import({ pack: 'C:\\packs\\example.mcpack' });
  const result = await renderer.render({
    file: 'ui/example.json', definition: 'example.screen',
    format: 'json', frame: 0, strictSemantics: true,
  });
  console.log(result.quality);
} finally {
  await renderer.close();
}
```

All methods return Promises. Except for `close()`, their optional second argument is `{ signal: AbortSignal }`. A signal passed to `createRenderer()` applies only to initialization. Subsequent operations take their own signals. Passing a request or signal to `close()` is outside its contract.

Requests must be ordinary JSON-equivalent objects. Unknown fields, `undefined`, functions, nonfinite numbers, cycles, getters, symbol keys, sparse arrays, custom array properties, nonplain object instances, and `__proto__` / `prototype` / `constructor` keys are rejected. Requests are copied at admission; later mutations to the caller's object do not change the admitted operation.

| Public method | Accepted first-argument fields; all other fields are rejected |
|---|---|
| `createRenderer()` | `settings`, `language` |
| `import()` | `pack`, `vanilla`, `resourcePack` |
| `list()` | `kind` |
| `definitions()` | `file`, `definition`, `kind` |
| `status()` | None / `{}` |
| `validate()` | Selectors + `settings`, `state`, `strictSemantics` |
| `render()` | Selectors + `settings`, `state`, `format`, `width`, `height`, `uiScale`, `fps`, `frame`, `allowPartial`, `strictSemantics`, `strictAnimation`, `drawEvidence`, `frameSummary`, `uiInstanceId`, `localToggleState` |
| `interact()` | Selectors + `settings`, `state`, `width`, `height`, `uiScale`, `fps`, `frame`, `uiInstanceId`, `localToggleState`, `expectedRevision`, `nodeId`, `event`, `inputSource` |
| `resolveSound()` | `soundId`, `selectionSeed`, `contextSampleRate` |
| `close()` | None |

`strictAnimation` is **render-only**. Interact internally requires strict semantic checks and does not accept a `strictSemantics` field itself. `resolveSound()` does not accept arbitrary file paths, `settings`, or audio bytes.

### Creation, imports, and listing

`language` is `ja` or `en`, defaulting to `ja`. `settings` follows the next section. Import requires at least one of `pack` and `vanilla`; the SDK requires an absolute OS path string, at most 32,768 characters. `resourcePack` is an RP UUID used with `pack`.

**SDK import replaces the entire stack.** `import({pack})` does not retain a previously imported vanilla layer. Specify both layers each time if both are needed. CLI import instead replaces only the supplied layers and retains unspecified layers.

Success schemas are `jsonui-api-import-v1`, `jsonui-api-list-v1`, `jsonui-api-definitions-v1`, and `jsonui-api-status-v1`. Import returns `sources` with kind/name/size_bytes/checksum_sha256 and, where applicable, resource_pack_uuid, plus file_count, definition_count, and diagnostics. Lists return count/items/diagnostics. Status returns import state, pending operations, Worker information, capabilities, and raster-backend availability. The status request itself is included in `pending` while it executes.

## 4. Settings and CLI mappings

`createRenderer({settings})` defines instance defaults. Settings supplied to validate/render/interact merge for that call only; they are not saved for later requests. CLI `settings --file` merges and saves settings into its session. Top-level dimension/timing request fields override the corresponding settings values.

| Settings key | Default | Accepted value and purpose | SDK / CLI override |
|---|---|---|---|
| `width`, `height` | 1920, 1080 | Output pixels; integers 1–16,384. PNG has additional lower limits | `width`, `height` / `--width`, `--height` |
| `ui_scale` | `auto` | `auto` or integer 1–8; logical-to-output pixel scale | `uiScale` / `--ui-scale` |
| `target_engine_version` | `1.26.40` | Valid engine version for vanilla-only 3D previews; an imported RP's manifest min_engine_version takes priority | Settings only |
| `fps` | 60 | Finite number 1–240 for frame-to-seconds conversion, not a video-encoding option | `fps` / `--fps` |
| `locale` | `ja_JP` | `[a-z]{2}_[A-Z]{2}`; pack strings and fonts | Settings only |
| `language` | `ja` | `ja` or `en`; tool explanations and diagnostics | Factory options / CLI `--language` |
| `visibility` | `safe` | `safe` or `structure`; visibility evaluation or structural inspection. Structure is not native-display validation | Settings only |
| `mock_data` | `{}` | Explicit binding values; ordinary object, at most 1 MiB | Settings only |
| `collections` | `{}` | Collection rows; ordinary object, at most 1 MiB | Settings only |
| `variables` | `{}` | Resolver `$` variables; ordinary object, at most 1 MiB | Settings only |
| `scroll` | `{}` | Explicit scroll state keyed by node ID; at most 1 MiB | Settings only |
| `event_factory_selections` | `{}` | Factory name to control_ids key mapping; at most 32 entries, safe names of 1–128 characters | Settings only |
| `ui_instance_id` | `jsonui-cli` | Nonempty ID up to 256 characters; no control characters or unsafe keys | `uiInstanceId` / Settings only |
| `local_toggle_state` | `null` | Local state described below; at most 1 MiB | `localToggleState` / Settings only |
| `animation_event` | `screen.entrance_push` | Selected event name up to 256 characters, no control characters | Settings only |
| `font_profile` | `bitmap` | `bitmap` or `observed-smooth` | Settings or state.font_profile |

Numeric settings also coerce numeric strings. SDK top-level fields such as width/height/fps/frame require JSON numbers. Unknown settings keys are rejected. Separate runtime maps being below 1 MiB does not remove the additional 1 MiB combined-frame-state limit.

`uiScale:'auto'` uses calibration in the RP's build-info.json or the Classic default scale of 4. Width and height describe physical output pixels; logical_width/logical_height describe the canvas before scaling. This does not detect smartphone GUI scale or touch layout.

## 5. Typed state

`state` is preview JSON, not live game state. Normalization validates the entire input and does not partially apply invalid state. Accepted top-level keys are:

`mockData`, `collectionData`, `furnace`, `brewing`, `trade`, `form`, `messageContext`, `inventory`, `slots`, `anvil`, `enchanting`, `horse`, `book`, `font_profile`, `eventFactorySelections`.

**The names differ:** raw values in state use `mockData`/`collectionData`; raw settings use `mock_data`/`collections`. Supplying state replaces default runtime data and clears variables/scroll/local state. In the same request, settings containing mock_data/collections/variables/scroll/event_factory_selections/local_toggle_state cause `API_STATE_CONFLICT`, even if those fields are empty. Nonruntime settings such as dimensions and language can be combined with state.

State can be combined with explicit `uiInstanceId`/`localToggleState`; these are applied after typed-state normalization. Explicit fields cannot be combined with ui_instance_id/local_toggle_state in settings.

| State branch | Input structure and limits |
|---|---|
| `mockData` | Binding-value object. `__collections` is forbidden; use collectionData |
| `collectionData` | Collection name → array of row objects. A row's `__collections` contains nested collections |
| `inventory` | main up to 27, hotbar 9, armor 4, offhand 1, container up to containerSize. containerSize is 1–256, default 27 |
| `slots` | Arbitrary collection name → item/null array; at most 128 collections, each up to 256 rows |
| `furnace` | progress/fuel in 0–1; input/fuelItem/output are items |
| `brewing` | progress/fuel/bubbles in 0–1; input/fuelItem and up to 3 output items |
| `anvil` | input/material/output are item/null; name/costText strings; costRed/costGreen/invalid booleans |
| `enchanting` | input/lapis item/null; up to 3 offers containing runes/cost/hoverText strings and available boolean |
| `horse` | equipment/container item/null arrays; equipmentSize/containerSize 1–256, defaults 2/15 |
| `book` | title/author strings, up to 256 page strings, editable boolean |
| `trade` | Up to 256 offers, each with required input/output items, optional secondInput item/null, unlocked/available booleans. title/tierName strings; selected is a zero-based integer within range, default 0. Empty offers require selected:0 |
| `form` | ActionForm or ModalForm described below |
| `messageContext` | Requires form; locale identifier and explicit translations object |
| `font_profile` | bitmap or observed-smooth |
| `eventFactorySelections` | Explicit factory branch mapping corresponding to settings |

Item fields are id/count/name/texture/atlasKey/variant/selected. Count is an integer 0–999, default 1; selected is boolean. Texture is a safe pack-relative textures/... reference. Texture and atlasKey are mutually exclusive. Variant requires atlasKey and is an integer 0–4,095. Unknown IDs produce diagnostics instead of being substituted with an arbitrary known item. Branches supporting empty slots normalize null or omitted trailing entries into empty rows. Supplying a renderable item does not establish native slot admission or recipe behavior.

Common limits are 1 MiB of UTF-8 JSON, depth 24, 20,000 elements, 65,536 characters per string, 256 rows per collection, 128 collections per map, and 2,048 rows total including nested collections. Raw mockData/collectionData are applied after typed branches and may explicitly override the same keys.

### Form state

| Type | Specification |
|---|---|
| ActionForm | type:'action', also default when omitted; title/body strings or supported RawMessage; buttons array of {text,icon?}. Buttons and elements are mutually exclusive |
| ActionForm elements | {type:'button',text,icon?}, {type:'header',text}, {type:'label',text}, {type:'divider'}. At most 256 display rows. Selection counts only buttons and differs from display-row index |
| ModalForm | type:'modal', title, submitText, submitVisible:boolean, required elements with 1–256 rows. Empty content is rejected |
| Modal elements | label/header/divider/toggle/slider/step_slider/dropdown/input; common text/tooltip support RawMessage |
| toggle | value:boolean, enabled:boolean; defaults false/true |
| input | value:string, placeholder, enabled:boolean; defaults empty/empty/true |
| slider | Legacy value:0–1 or range:{min,max,current,step?}, mutually exclusive. Range requires min<max, current within range, step>0, default 1. valueText/displayText are available with range |
| step_slider | 1–256 options, selected integer within range, optional enabled |
| dropdown | 1–256 options, selected integer within range |

If a slider current value or upper endpoint does not align with step, the renderer warns without rounding the input. Drag interaction and native rounding remain separate. Default recommended definitions are server_form.long_form for ActionForm and server_form.custom_form for ModalForm. Explicit long_form/custom_form in eventFactorySelections.server_form_factory instead recommends the corresponding ancestor server_form.main_screen_content.

RawMessage supports the implemented subset of text/rawtext/translate/with. Translation uses only explicit messageContext.translations and does not query game translations or scores. Supported placeholders include %s and %%1. Missing translations, missing arguments, and unsupported syntax are rejected. Separate limits include 64 KiB per expansion, 1 MiB aggregate output, depth 24, and 4,096 nodes.

## 6. Validate, render, and output formats

Validate checks the projected UI model. Render additionally evaluates a frame. Validate does not evaluate runtime collection rows, visual/input bindings, or raster assets. Recorded static native-property incompatibilities are also diagnosed by validate.

| Render field | Default and constraints |
|---|---|
| `format` | json/svg/png, default json |
| `width`, `height` | From settings; JSON-number integers 1–16,384 |
| `uiScale` | From settings; auto or integer 1–8 |
| `fps` | From settings; finite number 1–240 |
| `frame` | Zero-based integer. API admission cap 864,000, further pipeline cap fps×3,600. Default 0 for JSON/SVG, round(fps) for PNG |
| `strictSemantics` | Boolean, default false. Stops on nonpassed semantics/evaluation/rows/visual-input bindings/recorded native properties |
| `strictAnimation` | Boolean, default false. Stops on nonpassed animation quality |
| `allowPartial` | Boolean, default false, PNG-only. Permits an incomplete diagnostic PNG; never overrides strict checks |
| `drawEvidence` | Boolean, default false, PNG-only. Adds bounded final draw-input evidence |
| `frameSummary` | Boolean, default false, JSON-only; incompatible with strictAnimation. Counts/truncation diagnostics only, renderable:false |
| `uiInstanceId` | Local-state instance ID, otherwise from settings |
| `localToggleState` | Requires explicit uiInstanceId when supplied |

Time is frame/fps seconds. PNG's default capture is approximately one second after entrance animation starts. Set frame:0 for the initial instant. FPS may be fractional; frame itself must be an integer.

| Format | SDK result and meaning | CLI / HTTP |
|---|---|---|
| JSON | schema:'jsonui-api-render-v1', ok:true, format:'json'; viewport/time/selected/projected document/validation/frame IR/quality/stage_diagnostics. No rendered pixels | CLI stdout or .json; HTTP object within result |
| SVG | Same render schema, format:'svg', svg:string plus metadata. Layout rectangle diagram, not a complete texture/glyph/3D image | CLI requires --out .svg; HTTP result.svg is a string |
| PNG | Same render schema, format:'png', png:Buffer plus metadata. Resource/font measurement and necessary reflow precede raster drawing | CLI requires --out .png; HTTP uses the base64 object below |
| Validate | schema:'jsonui-api-validation-v1', ok:true, validation/quality/stage_diagnostics. Validation errors throw | CLI JSON; HTTP within result |

PNG metadata includes complete/preview_complete/draft/diagnostics/native_equivalence/provenance/final_frame_summary plus animation/binding/collection quality. Final-frame summary contains bounded counts, frame/hash/box digest, and reflow information after actual resource measurement. It is not a full-frame sidecar. JSON coordinates precede resource measurement; final PNG geometry follows measurement.

## 7. Quality axes and failures

| Quality axis | Scope |
|---|---|
| `semantic` | Selected projection inheritance/reference resolution, not unrelated catalog-wide validity |
| `native_properties` | Properties rejected in supplied native evidence, not exhaustive JSON UI schema verification |
| `evaluation` | Completion of bounded expansion, traversal, and evaluation |
| `collection` | Row ownership, indices, and references for collection_panel/stack_panel/grid |
| `bindings` | Resolution of visual/input state, including supplied local-state snapshots |
| `animation` | Supported animation sampling and observation at an explicit time |
| `state` | Typed-input normalization, not complete live game state |
| `assets` | Prepared PNG resources; not_evaluated for JSON/SVG |
| `interaction` | Normal rendering does not execute Script API or game input; not_evaluated |
| `native_comparison` | Minecraft pixel comparison; normally not_evaluated |

Complete describes raster-resource completeness. Preview_complete covers supported resources/evaluation/collections/visual-input bindings/recorded native properties. Animation has its own strictAnimation axis. Neither ok:true nor passed nor preview_complete:true certifies all native pixels, input behavior, or audible playback.

Representative error codes are CLI_SEMANTIC_GATE_FAILED, CLI_EVALUATION_INCOMPLETE, CLI_COLLECTION_GATE_FAILED, CLI_NATIVE_PROPERTY_GATE_FAILED, CLI_BINDING_GATE_FAILED, CLI_ANIMATION_GATE_FAILED, RASTER_BACKEND_UNAVAILABLE, and NODE_FRAME_REPLY_LIMIT. Codes are identifiers; messages are display text.

Recorded incompatibilities include vertical_alignment on labels, focus_enabled on passive panel/image nodes, and collection_index beneath an ordinary immediate parent. Unknown future fields are not globally deleted or forbidden. Looping on offset/size/uv is a separate animation diagnostic. Truncated observations are not treated as complete evidence; an unknown or other appropriate status is retained.

## 8. Interact and local state

Interact is a **stateless projection with caller-owned state**. It does not store the latest UI session on the server. Each request projects the supplied definition/state/local state and evaluates an input. Required fields are uiInstanceId/nodeId/expectedRevision and enough selectors to identify one definition.

| Field | Specification |
|---|---|
| `uiInstanceId` | Nonempty safe ID up to 256 characters |
| `nodeId` | Node ID present in the current JSON frame, up to 1,024 characters; not a caption or array index |
| `expectedRevision` | Nonnegative safe integer matching the supplied local state's revision |
| `localToggleState` | Optional; omission evaluates the initial state of the UI |
| `event` | activate or escape, default activate |
| `inputSource` | mouse or keyboard; default mouse for activate, keyboard for escape |

Local-state format:

```json
{
  "version": 1,
  "instanceId": "inspection-1",
  "revision": 0,
  "values": { "current-node-id": false }
}
```

Values map current writable local-toggle IDs to booleans, with at most 20,000 entries. Obtain current local IDs from JSON render's frame.bindings.localToggleState. A toggle managed by an external binding cannot be overwritten with local state. Radio exclusivity is limited to explicit groups under the same parent.

Input mappings match button.menu_select/pressed for mouse activate and menu_cancel/menu_exit/global for keyboard escape. Input_mode_condition must be absent or not_gamepad; touch/gamepad/gaze is not inferred. Multiple actions with an unknown execution order are not executed. Hidden/disabled/ignored/not-rendered targets are blocked; unknown actions are unsupported.

Results use schema:'jsonui-api-interaction-v1', ok:true, execution:'stateless_preview_projection', selected/node_id/ui_instance_id/previous_revision, projection/form-descriptor SHA-256 values, interaction/status/effects/diagnostics, localToggleState, audioIntent, quality, stage_diagnostics, effects_executed, and playback/native_equivalence. Blocked or unsupported input may still be a successfully evaluated API result; ok alone does not mean the requested action occurred.

Only **localTogglePatch** effects are applied. Each applied patch increments revision by 1. MockPatch/collectionPatch/close/navigate/chooseNavigate/clipboard and other finite-adapter effects are descriptors; the SDK does not execute them. It neither submits native form responses, closes/reopens forms, nor saves state to a BP. Pass the returned local state to subsequent interact/render calls to change the appearance of the same preview UI instance.

Foreign instances, mismatched revisions, and unknown/read-only IDs are rejected. However, **an old snapshot can be reevaluated when accompanied by its matching old expectedRevision**. This is not complete server-owned stale-operation prevention. Clients must implement latest-state storage and concurrency control when needed.

Audio intent is limited to valid mouse-activate targets. Keyboard/escape is not converted into an audio request. Unresolved sound_name/volume/pitch bindings, incomplete observation, disabled state, or hidden state do not generate an intent from a residual old value. SoundName/soundVolume/soundPitch/originScreenId/interactionId describe the request. Audio intent and action support are independent, so an unsupported unknown action can still return an intent when its authored sound_name is valid. An intent is not a sound-resolution or playback-completion result.

## 9. ResolveSound and audio

SoundId identifies a sound registered in sounds/sound_definitions.json: at most 256 characters, no control characters or $/#. SelectionSeed is an optional string up to 256 characters, default empty. ContextSampleRate is an integer 8,000–192,000, default 48,000.

Definitions resolve from imported first, then vanilla if the imported layer does not own that ID. Sound files are searched independently, imported then vanilla. If a higher layer contains no candidate for the referenced path, the same reference may resolve from a lower layer. An existing higher-layer format conflict, ambiguity, unsupported file or failed preflight is not bypassed by falling back. Definition and file ownership can differ, and the result records both. An explicit extension selects that format. Extensionless names require a unique OGG/WAV file with that stem.

Supported files are short **Ogg Vorbis** and **WAV PCM16**. Limits: encoded sound 4 MiB, duration 10 seconds, mono/stereo, 8,000–192,000 Hz, PCM reservation 8 MiB. Definitions are limited to 8 MiB/50,000 IDs/64 candidates per sound. Streaming, FSB, MP3, Opus, and chained OGG are unsupported. Candidate pitch is 0.5–2, volume is a nonnegative finite number, and weight is an integer 1–1,000,000. Definition-level volume/pitch is unsupported by this resolver.

Multiple candidates use soundId and selectionSeed in the deterministic SHA-256 weighted policy sha256-weighted-v1. This does not claim parity with Bedrock's RNG. OGG preflight checks headers/pages/CRC/sequences/packets/EOS/duration/PCM reservation. It is **not a complete Vorbis decoder** or a hard cap on native decoder allocations.

The result is schema:'jsonui-api-sound-v1', ok:true, a sound object using jsonui-sound-v2, playback:'not_executed', and native_equivalence:'not_evaluated'. Sound metadata includes definition/file pack IDs and paths, codec/container, channels/sampleRate/duration, encodedBytes, contentRevision as file SHA-256, candidate/index/selection policy, volume/pitch/category/is3D, and warnings. **No audio bytes are returned; SDK/HTTP/CLI do not play through speakers.**

The GUI player separately attempts browser decode/playback. Game category mixing and positional/distance audio are not applied and remain warnings. AudibleVerified/nativeVerified/gameMixerVerified remain false. Inspection or successful decoding alone does not certify that playback was heard.

## 10. HTTP transport

`createRendererServer({port?,signal?})` is the public factory in local-node/api-server.mjs. Port is an integer 0–65,535, default 0 for automatic allocation. Bind is fixed to 127.0.0.1. Its connection descriptor contains schema/base_url/token/pid; close is an idempotent shutdown Promise. Signals are not embedded in JSON requests.

| Route | Authentication/body |
|---|---|
| GET /health | No token or body; readiness only |
| POST /api/renderer/v1/import | SDK import object |
| POST /api/renderer/v1/list | SDK list object / {} |
| POST /api/renderer/v1/definitions | SDK definitions object |
| POST /api/renderer/v1/validate | SDK validate object |
| POST /api/renderer/v1/render | SDK render object |
| POST /api/renderer/v1/interact | SDK interact object |
| POST /api/renderer/v1/sound | SDK resolveSound object |
| POST /api/renderer/v1/status | {} |

Except for health, requests require Authorization:Bearer followed by a 64-character hexadecimal token and Content-Type:application/json. Host must exactly match the assigned 127.0.0.1:port. Requests containing Origin, or browser sec-fetch-site values other than none, are rejected. This is not a CORS or remote-publication endpoint.

Success is {schema:'jsonui-renderer-http-v1',ok:true,correlation_id,result}; failure uses the same schema with ok:false/error and a non-2xx status. Error contains code/message/category/retryable/correlation_id/details/context. SDK results are not additionally nested in a result envelope.

PNG result.png is {encoding:'base64',media_type:'image/png',size_bytes,checksum_sha256,data}; SVG is result.svg as a string. HTTP provides no output-path write API. Limits are 8 simultaneous requests, 32 connections, 16 MiB request JSON, 64 MiB response JSON, and 30 seconds to receive a body. Base64 increases size, so large PNG output may exceed the HTTP response limit. Responses include no-store/nosniff/request-ID headers and Connection:close.

Representative statuses: 401 unauthenticated, 403 Host/Origin rejection, 404 unknown route, 405 wrong method, 415 wrong content type, 413 size limit, 429 overload, 408 body timeout, 504 operation timeout, and 499 cancellation. This is not an exhaustive fixed mapping for all errors; inspect the actual code/context.

The CLI server's connection-file is create-only. It remains after shutdown, but its token ceases to work when the server stops. File existence is not proof that the server is running. Restart with a new path, or verify the old server is stopped and the descriptor is yours before deleting it. Unix mode 0600 does not guarantee complete control of Windows ACLs.

## 11. CLI operations and persistent state

CLI success/failure envelopes use jsonui-cli-result-v1. Regular stdout contains one JSON object. Help is human-readable text; help --json returns JSON. Failure exits nonzero. Default session is .jsonui-cli/session.json, overridable with --session. Console-language precedence is --language, JSONUI_LANGUAGE, saved language, then ja.

| Command | Input, behavior, and main output |
|---|---|
| import | --pack/--vanilla/--resource-pack; replaces supplied layers and resets their source overrides and editing history |
| list / definitions / read | Lists files/definitions/layers; read returns authored text. Read --out accepts .json/.jsonc |
| settings | Saves raw --file settings or typed --state-file state, mutually exclusive. Existing runtime replacement requires --replace-state |
| validate / preview | Selectors and strict flags. Preview accepts --format json/svg/png, --out, frame/fps/size/scale |
| interact / resolve-sound | --request-file uses the SDK JSON contract. Returned operation state is not automatically persisted into the session. --out is JSON |
| draft | --operation plus selectors; computes uncommitted frame JSON without changing source/session/history. Draft PNG is unavailable |
| edit | --operation, direct --text-file replacement, or set/move/add/inherit/planDelete/delete authored operations. Changes persist as session overrides |
| undo / redo | Restores saved history; refuses mismatched source revisions |
| export | Single --file/--definition/--kind or --selections; dependency planning and validation, then --out .mcpack/.zip. --plan returns only the plan |
| diagnostics / status | Current invocation's diagnostics or saved state. Status --live additionally checks source hashes and workspace |
| workflow | Executes file.commands in order, sharing one server and saving successful changes. Failure reports completed operations and failed_index |
| features / help | Capability boundaries / help |

Authored pointers use JSON Pointer. Set value is JSON; move value maps to offset; add/inherit specify parent-pointer/name/base-ref/index. Screen-scoped operations check generated-control, unresolved-reference, and inheritance boundaries. Deletion uses a prior plan and any required cascade rather than an unverified broad removal. Existing [CLI details](../../../local-node/CLI-ja.md) also document versioned operation-object contracts.

Export selections contain 1–256 entries. Pack-options permit name up to 120 characters, description 1,024, version as three integers 0–65,535, and up to 16 authors of 80 characters each. Pack-icon is a PNG up to 1 MiB/2,048 pixels per side; CRC is checked before conversion into a 256×256 image with transparent padding. Unresolved dependencies are not silently dropped to report success.

Sessions contain absolute source archive paths, SHA-256, size, authored overrides, settings, selection, and history. Changed archive bytes stop restoration. History is bounded to 64 entries/8 MiB; discarded oldest entries are reported in status. Session locks reject simultaneous use of the same file.

## 12. Internal processing and rendering scope

1. Inspect archive sizes/entries/paths/CRC and register the input for processing.
2. Build UI/variable/asset catalogs; choose the precedence layer and one definition.
3. Project inheritance, controls, variables/defaults/conditionals, supported modifications, and explicit factory branches while retaining provenance and dependency diagnostics.
4. Run model validation and recorded native-property checks.
5. Evaluate explicit mock/collection/local state and absolute animation time, then generate layout boxes/frame IR.
6. Return IR for JSON or its layout diagram for SVG. PNG loads pack assets/localization/fonts, measures them, reflows where necessary, and rasterizes the final frame.
7. Return final quality/diagnostics/digests. File output and session persistence are separate CLI/caller responsibilities.

The ordinary palette contains screen/panel/collection_panel/label/button/dropdown/image/input_panel/stack_panel/grid/scroll_view/edit_box/toggle/scroll_track/scrollbar_box. Recognition and preservation of custom/factory/tooltip_trigger does not mean generic reproduction of all associated runtime behavior. Unknown fields survive in the model, but faithful drawing of unsupported features is not guaranteed. A model parsed from JSONC does not retain comments; projected/generated output is not byte-identical source preservation.

Bindings evaluate the implemented subset of public global/collection/view conventions using explicit state. Opaque game renderer data, full Molang, and values generated by native controllers are not executed. Collection_index must match the immediate collection owner and row context; an intervening ordinary panel is not bypassed by searching arbitrary ancestors.

Images use supported pack resources such as PNG/JPEG, texture sidecars, and implemented UV/nine-slice drawing contracts. Strict PNG stops when real font assets are missing instead of silently using OS fonts to hide missing resources. Bitmap and observed-smooth profiles are explicit; the latter is an observed approximation. Proprietary Minecraft font/texture/model collections are not bundled in the public release.

Native-renderer previews include bounded safe surrogates for implemented item/progress/model cases. Resource-backed player/horse/book 3D previews are deterministic orthographic snapshots, not the full Bedrock shader/lighting/Molang/render pipeline. Missing geometry/textures, unsupported features, and resource limits are diagnosed.

Animation implements supported alpha/offset/size/uv/color/wait/flip_book cases, finite next chains, and absolute-time sampling. Easing includes linear plus in/out/in_out variants of quad/cubic/quart/quint/sine/expo/circ/back/elastic/bounce. Limits: 2,048 definitions and tracks each, chain 64, aggregate definitions 2 MiB. Event side effects, activation/reset state, and native timing when an element becomes rendered have separate unsupported diagnostics.

## 13. Main limits and lifecycle

Limits are rejection boundaries, not guaranteed processing capacity. Multiple layers have separate limits; the first reached limit applies. A UI exceeding a renderer limit is not necessarily invalid in Minecraft.

| Scope | Main current limits |
|---|---|
| SDK JSON | 16 MiB, 20,000 elements, depth 32 |
| SDK admitted operations | 8 including the running operation; serial within one renderer |
| ZIP | 768 MiB input, 120,000 entries, 128 MiB central directory, 2,048 MiB total expanded, 64 MiB expanded / 128 MiB compressed per entry |
| Expansion ratio | Entries expanding to at least 8 MiB are blocked from reading above 200× as archive-bomb protection |
| Internal registrations/uploads | At most 4 registered packs while the public stack has at most 2 layers; working disk bytes 2,304 MiB; upload 300 seconds |
| Worker execution | Normal job 120 seconds, projection 30 seconds; batch operations have separate limits |
| Shared screen model | Default 20,000 nodes/depth 200, used by validate/interact model checks; satisfying only the frame limit is insufficient |
| Frame | 50,000 model nodes/depth 256, 5,000 layout boxes, 1 MiB combined state, 24 MiB reply |
| PNG | 8,192 pixels per side, 16,777,216 pixels, 128 MiB decoded resources, 512 assets, 64 font sheets, 131,072 characters, 120 seconds, 96 MiB encoded PNG |
| 3D surrogate | 256 bones, 2,048 cubes, 2,048 draw faces/work units, bone depth 64, 2 MiB motion mesh |
| Recorded-property diagnostics | 256 generated diagnostics, up to 64 quality-evidence entries; omitted count and capture completion reported separately |

SDK/HTTP packs are not automatically removed after 30 minutes of inactivity; they remain until import/close. Other worker/cache/capacity limits still apply. Worker recovery that changes the token/generation invalidates the stack and reports API_REIMPORT_REQUIRED or associated diagnostics. Reimport rather than reusing an old projection ID.

Cancellation signals are checked at admission, queue, and execution boundaries. A queued request can reject promptly on cancellation while its reserved queue slot is released only when the serial task reaches it. Immediate interruption of synchronous processing or OS operations is not guaranteed. Close stops admissions, cancels owned operations, and waits for its server/Worker and queue to finish. Repeated close calls share one Promise.

On import failure, new registrations are cleaned up and the previous stack is normally preserved. If cleanup fails and registrations cannot safely be tracked, the renderer closes and reports recreate_renderer_required/import_cleanup context. Cancellation may be reported before cleanup has finished.

HTTP clients share **one stack**. One client's import affects other clients. Use separate renderers/servers for independent packs. A disconnected request cancels that operation; closing the server stops the entire instance.

## 14. File protection, errors, and validation evidence

CLI checks output extensions/regular files/paths and rejects overwriting source archives, request files, and application files. Outputs are create-only by default; --force permits replacing generated artifacts. A sibling temporary file is synced before exposing the final name; parent-directory power-loss durability is not guaranteed. SDK/HTTP do not save outputs, so callers using writeFile must implement source protection and overwrite policy themselves.

SDK throws JsonUiApiError with code/message/category/retryable/correlation_id/details/context. An internal error is retained as a nonenumerable cause. Public diagnostics are sanitized, but that does not make arbitrary private input safe to publish. HTTP tokens and connection descriptors contain authentication information.

Historical 0.16.0 evidence records 3,163 successful Node tests and 39 skips, 533 successful shared-core tests, 28 strict PNG states, 39 operations, and full decoding of the sample OGG. These are **0.16.0 historical results**, not newly executed 0.16.1 tests or Minecraft/browser results. Consult the release report for the current distribution's documentation/package checks.

Implementation references: local-node/api.mjs, api-request.mjs, api-server.mjs, api-interaction.mjs, preview-settings.mjs, preview-pipeline.mjs, cli.mjs, cli-files.mjs, limits.mjs, frame-ir.mjs, frame-raster-assets13.mjs, sound-resolver.mjs, audio-preflight.mjs; and editor-core/src preview-state, preview-animation, local-toggle-state, native-property-diagnostics, and native-model-preview modules.
