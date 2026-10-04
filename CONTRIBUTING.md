# Contributing to JSON UI Workbench

Please read [LICENSE.md](LICENSE.md) first. The project uses PolyForm Noncommercial License 1.0.0 within the publisher's authority; third-party and imported content retain their own terms. Unless separately agreed with the publisher, submit project-authored contributions on these same project terms. Contributors retain their copyright; no copyright assignment is required. Do not submit material you lack permission to license.

For a bug report, include the tool version, Node.js version, platform, a minimal
JSON UI example, expected behavior, observed behavior, and whether the evidence
comes from this renderer or Minecraft itself. Remove personal paths and tokens.
Only attach packs and screenshots that you are authorized to share.

For code changes:

1. Keep native JSON UI identifiers and wire protocols compatible.
2. Add a minimal authored fixture for the behavior being changed.
3. Run `npm run test:release`. Run `node scripts/release/audit-public.mjs` on a
   clean public-source tree; for a working tree with private assets or runtime
   logs, first build a new public distribution and audit that directory.
4. State which result is a model simulation, native-log finding, pixel comparison,
   or unverified assumption. Self-render/reimport equality is not native parity.
5. Preserve vendor notices. Do not commit game assets or real user logs.

All contributors retain any rights they hold in their contributions unless they
separately agree otherwise. Do not submit third-party code under terms that you
cannot grant. Discuss licensing with the repository owner before merging code
that introduces new license obligations.

## 日本語

[ライセンス](LICENSE.md)を先に確認してください。本体は公開者が許諾できる範囲で PolyForm Noncommercial License 1.0.0 を使い、第三者や入力素材は元の条件を維持します。公開者と別途合意しない限り、独自の貢献は本体と同じ条件で提出してください。著作権の譲渡は求めません。許諾する権限のない素材は提出しないでください。

不具合報告には本体・Node.js の版、OS、共有できる最小の JSON UI、期待した動作と実際の動作、証拠がレンダラー由来か実機由来かを記載します。個人の経路やトークンを除き、共有が許されたパック・画像だけを添付します。

変更時は識別子・通信形式の互換性を維持し、自作の最小例で検査してください。`npm run test:release` と公開内容の監査を実行します。私的な素材やログがある作業場所では、新しい公開配布を作ってその場所で監査します。シミュレーション・実機ログ・画像比較・未検証の推測を区別し、第三者表示を保持し、ゲーム素材や実ユーザーのログを含めません。新たなライセンス義務を持つ部品は導入前に公開者と相談してください。
