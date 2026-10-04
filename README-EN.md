# JSON UI Workbench 0.16.1

Version 0.16.1 is a documentation and licensing release. Rendering implementation remains at 0.16.0. Paired Japanese and English manuals, specifications, limitations and license explanations are now available. Start with the original tutorial in the user guide; it needs no game assets.

**Classic UI only. Pocket/touch UI and use of this tool on smartphones are outside the supported scope.**

| Document | English | 日本語 |
|---|---|---|
| Human-readable instructions | [User guide](docs/release/manual/USER_GUIDE_EN.md) | [説明書](docs/release/manual/USER_GUIDE_JA.md) |
| Operations, inputs, outputs and internal processing | [Technical specification](docs/release/manual/TECHNICAL_SPEC_EN.md) | [仕様書](docs/release/manual/TECHNICAL_SPEC_JA.md) |
| Unsupported, limited and unverified features | [Limitations](docs/release/manual/LIMITATIONS_EN.md) | [注意事項](docs/release/manual/LIMITATIONS_JA.md) |
| Use, modification and redistribution | [License explanation](LICENSE-EN.md) | [ライセンス説明](LICENSE-JA.md) |
| Offline browser handbook | [English HTML](docs/release/manual/HANDBOOK_EN.html) | [日本語 HTML](docs/release/manual/HANDBOOK_JA.html) |

[Document index](docs/release/manual/INDEX.md) · [Historical 0.16.0 verification](docs/release/VERIFICATION_0160_JA.md)

An independent Classic JSON UI renderer and diagnostic tool for Minecraft: Bedrock Edition. **CLI is the default entry point.** A reusable Node.js API and a loopback HTTP API support repeated rendering from scripts and AI tools. The unfinished visual editor is retained as an explicitly launched experimental GUI.

Not an official Minecraft product; not approved by or associated with Mojang or Microsoft.

[日本語 / full guide](README.md) · [CLI / API guide in Japanese](docs/release/ENTRYPOINTS_JA.md) · [CLI reference](local-node/CLI-ja.md) · [Publishing](docs/release/GITHUB_EN.md) · [Rights](LICENSE.md)

## Setup and entry points

Install Node.js 22.14.0 or later, extract the entire archive, then run from the project root:

```sh
npm ci --ignore-scripts
npm start
npm run cli -- features --json
```

`npm start` displays CLI help and exits; it does not launch a browser.

| Use | Entry point | Lifetime |
|---|---|---|
| CLI rendering, validation, editing and export | `npm run cli -- <command>` | Persistent session JSON |
| Repeated calls from Node.js | `createRenderer()` from `local-node/api.mjs` | Until `close()` |
| Calls from Python or other HTTP clients | `npm run api -- --connection-file .jsonui-api/connection.json` | Until server shutdown |
| Experimental visual editing | `npm run gui` | GUI workspace |

The Node API reuses its own local processing server and worker without spawning the CLI. The HTTP API is bound to `127.0.0.1` and requires a Bearer token from the connection file. Do not expose it as a public backend. Stop it with Ctrl+C. The connection file is not a persistent rendering session.
It remains after shutdown; the stopped server no longer accepts its token. Use a
new connection-file path on restart, or verify and remove your own old file first.
Existing files are never overwritten. Automatic deletion is avoided so a file
replaced by another process cannot be removed accidentally.

For direct machine-readable CLI stdout, call `node local-node/cli.mjs ...`; npm may add its own script messages. The CLI `workflow` command can batch operations into one process and pack load.

The optional pinned `@napi-rs/canvas` dependency enables PNG rendering. JSON evaluation and SVG layout inspection do not require it. SVG does not rasterize textures, pack fonts or 3D models.

See the [0.16.0 verification record in Japanese](docs/release/VERIFICATION_0160_JA.md) for observed checks and untested native environments.

## First CLI render

```sh
node local-node/cli.mjs import --pack packs/addon.mcpack --session outputs/session.json
node local-node/cli.mjs list --session outputs/session.json
node local-node/cli.mjs definitions --file ui/example.json --session outputs/session.json
node local-node/cli.mjs preview --file ui/example.json --definition example.screen --format json --out outputs/frame.json --session outputs/session.json
```

Replace the input pack and UI names with actual paths and names from the catalog. Import an authorized vanilla reference pack separately with `import --vanilla` when required. Game assets are not bundled.

## API and experimental GUI

Import `createRenderer` from `./local-node/api.mjs`, then call `import`, `list`, `definitions`, `validate`, `render`, `interact`, `resolveSound` and `status`. Always call `close` in `finally`. PNG results contain a Buffer and SVG results a string; the caller controls file saving. The [entry-point guide](docs/release/ENTRYPOINTS_JA.md) includes complete Node.js and HTTP examples.
The [runnable SDK example](local-node/examples/api-preview.mjs) accepts a request
JSON and saves PNG with protected input paths and no overwrite:
`node local-node/examples/api-preview.mjs request.json`. See the guide for its
request fields and optional PNG dependency.

Imported API packs do not expire after 30 minutes of inactivity; they remain
until another import or close. If Worker recovery returns
`API_REIMPORT_REQUIRED`, explicitly re-import the required pack combination.

Run `npm run gui` to try the experimental preview/editor. The legacy `start.bat`, `start.cmd` and `start.sh` scripts also launch the experimental GUI. Windows bootstrap execution remains unverified in this Linux environment. Visual editing is incomplete, especially changes involving shared definitions, inheritance or generated controls.

## Scope and quality

The renderer evaluates supported bindings, collections, layout and animation using supplied state. It does not execute Minecraft, Script API, native form submission or inventory logic. Pocket UI is indexed but not rendered. Read `quality`, diagnostics and completeness information instead of treating request success as native compatibility.

Strict PNG rendering stops on unresolved resources or unsupported drawing. Explicit `allowPartial: true` / `--allow-partial` permits an investigative partial image, not a certified native screenshot. Missing native 3D item models are diagnosed rather than replaced with incorrect flat sprites. The original imported pack is not overwritten.

Node and HTTP APIs hold state only for their current lifetime. They do not persist CLI sessions. API `import` replaces the complete pack stack;
provide `pack` and `vanilla` together when both are required. Calls on one Node API instance are serialized; use separate instances and sessions for independent work.

## Develop and distribute

```sh
npm run test:release
npm run check:package
node scripts/release/audit-public.mjs
python scripts/release/package_public.py --output-dir dist
```

Python 3.11+ is required only for ZIP packaging. Older verification documents describe their recorded release, not certification of the new API. Excluded asset-dependent tests and unexecuted Windows or Minecraft checks are not counted as passed.

The shared engine remains in `editor-core/`; removing it would break CLI and API rendering. Historical documentation is preserved. This README and the new user guide, specification and limitations above define current behavior. Historical verification reports describe their recorded release.

The publisher offers original portions they own or are authorized to license under **PolyForm Noncommercial License 1.0.0**. Permitted noncommercial use, modification and redistribution are allowed; commercial purposes are not permitted. This is noncommercial source-available software rather than OSI open-source software. Read [LICENSE.md](LICENSE.md) and the [English explanation](LICENSE-EN.md). Third-party libraries, game assets and imported add-ons retain their own terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the [asset policy](docs/release/ASSET_POLICY.md).
