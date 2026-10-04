# Third-party notices

This file records the components used by JSON UI Workbench 0.16.1. It is not a
replacement for their license texts and does not relicense upstream files.

| Component | Version | License | Source / retained notice |
|---|---|---|---|
| zip.js | 2.8.16 | BSD-3-Clause | [upstream](https://github.com/gildas-lormeau/zip.js), `editor-core/vendor/zip.js-2.8.16/LICENSE` |
| jsonc-parser | 3.3.1 | MIT | [upstream](https://github.com/microsoft/node-jsonc-parser), `editor-core/vendor/jsonc-parser-3.3.1/LICENSE.md` |
| pngjs | 7.0.0 | MIT | [upstream](https://github.com/pngjs/pngjs), `local-node/vendor/pngjs/LICENSE` |
| @napi-rs/canvas | 0.1.100 | MIT package | [upstream](https://github.com/Brooooooklyn/canvas); installed by npm, not included as a native binary in the public source archive |

Browser dependency file hashes and source versions are retained in
`editor-core/vendor/THIRD_PARTY_LOCK.tsv`. Those records originate in r41; the
public distribution manifest independently records the shipped file hashes.
The canvas package's license designation does not replace notices for its
transitive native components. If distributing an installer or binary in the
future, collect the notices from the exact installed dependencies first.

## Minecraft compatibility information

The renderer contains compatibility identifiers, item-to-texture aliases,
property names, numeric identifiers where available, hashes, and authored
interpretation logic. They describe the external format; they are not game
textures or a complete Minecraft runtime.

Existing compatibility tables identify Mojang/bedrock-samples commit
`736072450c26a7c67f07b1661f29d9a5ebaa14b1`; other tables identify their own pinned
source versions. Preserve those source comments. Compatibility with one snapshot
does not prove compatibility with every version of the game.

The [Mojang/bedrock-samples license](https://github.com/Mojang/bedrock-samples/blob/main/LICENSE.md)
retains Mojang's rights and refers to the [Minecraft EULA](https://www.minecraft.net/en-us/eula).
It is **not** an MIT license. The public package excludes the supplied native
player model/skin, copied native UI/controller fixtures, vanilla packs, game
fonts, and historical game screenshots. Users supply their own authorized packs.

## Demonstration assets

The small demonstrations under `examples/revision12/pack` and
`examples/revision13/pack` are identified in their supplied `CREDITS-ja.md` files
as original test graphics, limited test glyphs, and synthesized audio. The
public builder uses only those credited asset paths. Their provenance does not
constitute an additional blanket license; the project rights status still
applies. Unknown historical fixture ZIPs are rebuilt from these credited sources
for public distribution rather than republished unchanged.

## Project source

The r41 archive is the source of the inherited renderer and did not contain a complete authorship record or project-wide license. In 0.16.1 the publisher adopts PolyForm Noncommercial License 1.0.0 for original portions they own or are authorized to license. It does not relicense upstream components, compatibility data subject to upstream terms, game assets or user content. Describe the project as noncommercial source-available software. See [LICENSE.md](LICENSE.md).

The tutorial in `docs/release/manual/examples/build-demo.mjs` generates original JSON definitions and a solid-color test image, and reuses the credited synthesized OGG audio; it copies no game fonts or textures. Its project-authored contents are covered by the project license within the scope in `LICENSE.md`.

[日本語の権利表示](THIRD_PARTY_NOTICES-JA.md).
