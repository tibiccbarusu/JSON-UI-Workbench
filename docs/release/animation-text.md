# Animation and label placement corrections

現行 0.16.1 の対応範囲・`offset` を含む仕様は [仕様書](manual/TECHNICAL_SPEC_JA.md) と [注意事項](manual/LIMITATIONS_JA.md) を参照してください。以下は作成当時の記録です。

The uploaded CONCERT 88 incident report identified two separate preview gaps. These changes preserve the authored JSON and report compatibility uncertainty instead of silently rewriting a resource pack.

## Animation diagnostics

| Case | Result |
| --- | --- |
| `uv` or `size` animation with `looping`, including `false` | `ANIMATION_LOOPING_NATIVE_REJECTED`: this field/type combination was rejected in the supplied native Content Log. Local numerical sampling is still available; animation quality becomes `unknown`. |
| `flip_book` attached through `anims` | `ANIMATION_FLIPBOOK_ANIMS_NATIVE_UNVERIFIED`: the supplied example failed natively. This is a compatibility warning, not a universal ban. |
| A `next` chain containing `flip_book` | `ANIMATION_FLIPBOOK_CHAIN_NATIVE_UNVERIFIED` identifies each affected segment, including the first and last. |
| Standalone `flip_book` attached directly to `uv` | Still sampled, including `initial_uv`, `looping`, and reversible strips. No blanket `initial_uv` prohibition is introduced. |
| Ordinary `uv` chain using `from`, `to`, `duration`, and `next` | Still sampled at exact boundaries and after absolute seek. |

When the same animation appears in both `anims` and a direct property, attachment provenance is retained without compiling a duplicate track. The existing strict animation gate rejects the new `unknown` cases. Its scope remains the selected frame and requested preview event; this does not replace native parsing of the entire resource pack.

## Label text placement

The label rectangle is positioned by `anchor_from` / `anchor_to`. Text inside that rectangle begins at its top; a center anchor no longer adds an unrelated vertical centering operation. A natural-height centered label therefore remains centered through layout, while a tall label exposes the top-positioned text observed in the supplied screenshots. Horizontal `text_alignment` is unchanged. The native-invalid `label.vertical_alignment` field is preserved for editing but ignored by the preview.

This is an evidence-based placement correction, not a claim that all fonts, baseline metrics, device scales, or anchor combinations have been verified in Minecraft.

## Regression checks

Run:

```sh
node --test local-node/tests/animation-text-compatibility.test.mjs local-node/tests/preview-state-animation.test.mjs local-node/tests/animation-quality41.test.mjs editor-core/tests/view-source39.node.test.mjs
```

The new fixtures are original minimal definitions with synthetic glyph measurements. No Minecraft texture, font, or pack source is included. They test the reported invalid combinations, valid standalone flipbooks, ordinary UV replacements, segment boundaries, non-destructive behavior, and glyph origins for natural-height and fixed-height labels. Native game execution and native clock/event verification remain unperformed.

## References

- User-provided `concert88-incident-attribution-report-ja.md`, sections 3–6 and 9, accessed 2026-09-28. The report distinguishes actual native Content Logs from local numerical probes.
- [Microsoft Learn: UI Element](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/jsonuireference/examples/jsonuicomponents/ui_element?view=minecraft-bedrock-stable), accessed 2026-09-28: anchors describe element positioning; `text_alignment` describes horizontal text alignment.
- [Mojang: auto_save_info_screen.json](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/ui/auto_save_info_screen.json): standalone flipbook example linked by the incident report.
- [Mojang: test_anims_screen.json](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/ui/test_anims_screen.json): ordinary UV chain example linked by the incident report.
