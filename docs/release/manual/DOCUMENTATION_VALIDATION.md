# 文書整備と確認記録 / Documentation validation — 0.16.1

2026-10-05（日本時間） / 2026-10-05 (Japan). This is a documentation and licensing release. レンダラーの動作実装は 0.16.0 から変更していません。

## 作成した文書 / Documents created

| 文書 / Document | 日本語 / Japanese | English | 内容 / Coverage |
|---|---|---|---|
| 説明書 / User guide | [日本語](USER_GUIDE_JA.md) | [English](USER_GUIDE_EN.md) | 各12節。準備、教材、CLI、GUI、編集・書出し、SDK、HTTP、困ったとき / 12 sections each: setup, tutorial, CLI, GUI, editing/export, SDK, HTTP, troubleshooting |
| 仕様書 / Specification | [日本語](TECHNICAL_SPEC_JA.md) | [English](TECHNICAL_SPEC_EN.md) | 各14節。操作・動作・入力・出力・内部処理・制限 / 14 sections each: operations, behavior, inputs, outputs, internals, limits |
| 注意事項 / Limitations | [日本語](LIMITATIONS_JA.md) | [English](LIMITATIONS_EN.md) | 各10節。非対応・条件付き・未検証を区別 / 10 sections each, separating unsupported, conditional and unverified behavior |
| ライセンス説明 / License explanation | [日本語](../../../LICENSE-JA.md) | [English](../../../LICENSE-EN.md) | 同じ5節で許諾と条件を説明 / 5 equivalent sections explaining permissions and conditions |
| 閲覧用一冊版 / Offline handbook | [日本語 HTML](HANDBOOK_JA.html) | [English HTML](HANDBOOK_EN.html) | 説明書から正式ライセンスまで7章、外部素材・JavaScript不要 / 7 chapters through the governing license, no external assets or JavaScript |

Classic UI 専用・Pocket/タッチ向け UI とスマートフォン上でのツール利用が非対応であることを、README・説明書・仕様書・注意事項・HTML冒頭に記載しました。各 API のプレビュー状態と実機の処理、OGG の解決と実際の発音、調査用画像と実機一致を区別しています。

README, guides, specifications, limitations and HTML introductions state the Classic-only scope and unsupported Pocket/touch UI and smartphone tool execution. They distinguish preview state from native execution, OGG resolution from audible playback, and investigative previews from native equivalence.

## 今回実行した確認 / Checks executed for this release

| 確認 / Check | 結果 / Result | 範囲 / Scope |
|---|---|---|
| 教材のCLI手順 / CLI tutorial | 18/18成功 / passed | 自作パック生成、取込み・一覧・定義・設定・厳格検査・JSON/SVG/PNG・編集・undo/redo・原文・書出し・診断。Node.js 22.14.0、Linux / original pack build through import, strict previews, edits, export and diagnostics |
| 認証付きHTTP / Authenticated HTTP | import/render は HTTP 200 / both returned HTTP 200 | NodeによるHTTP要求。PowerShellでの実行ではない / requests sent from Node, not actual PowerShell execution |
| 最終教材のSDK再確認 / Final tutorial SDK | 成功 / passed | license URL・Required Notice付き教材で厳格 before/after PNG、revision 1 の状態変更、audioIntent と合成OGGの解決 / finalized credited demo, strict images, local interaction and sound metadata |
| 原本保護 / Input protection | 成功 / passed | 教材の入力ハッシュ不変・既存出力拒否 / unchanged input hash and refusal to overwrite output |
| 配布監査の回帰試験 / Public-manifest regression tests | 2/2成功、失敗0 / 2 passed, 0 failed | 未登録ファイル・重複・版のずれ等の拒否 / rejection of unregistered files, duplicates and version drift |
| 実装の維持 / Implementation preservation | 706ファイル同一 / 706 files byte-identical | 0.16.0のeditor-core/local-nodeと比較。文書であるCLI-ja.mdを除外 / compared with baseline, excluding CLI-ja.md documentation |
| 日英の照合 / Language parity | 点検完了 / reviewed | 説明書16コード例は一致。仕様書の例の差はlanguage ja/en。一覧・画面選択と音源探索の説明を相互レビューで修正 / identical user-guide code examples; spec sample difference is language; independent review corrected listing/selection and sound ownership |
| リンク・構造 / Links and structure | 点検完了 / reviewed | 現行入口と新しい文書の相対リンク、見出し、表、コードfence。機械検査だけを内容の正しさと扱わない / relative targets and document structure, supported by semantic review |
| HTMLの表示 / HTML reflow | 8/8成功 / passed | 日英×320/390/900/1440px。ページ横はみ出し・重複id・壊れた内部リンクなし。目次は閉じた状態で開始し開ける / no page overflow, duplicate IDs or broken anchors; closed, operable contents |
| HTMLの目視 / HTML visual review | 実施 / performed | Chrome Headless Shell 134の32スクリーンショットを作成し、代表画面を目視。検査環境だけにNoto CJKフォントを用意し、フォントは配布しない / 32 screenshots generated, representative views inspected; QA-only CJK font, not shipped |
| ライセンス原文 / Governing license | 公式ファイルと同一 / identical to official file | 4,563 bytes、SHA-256 `c0ea4a896d2c8c394b29f9427589996db826cd501c512279ff0ed3ef48fabbe5`。vendor本文は変更なし / original terms and unchanged vendor texts |

## 実行していない確認 / Checks not executed

Minecraft 実機の描画・操作、Windows PowerShellでの手順、実際のGUI操作、スピーカーからの発音は今回実行していません。`resolveSound()` は音声情報を返し、発音は行いません。HTMLの閲覧検査は、レンダラーのGUIや実機の検査ではありません。

Native Minecraft rendering/input, actual Windows PowerShell instructions, GUI interaction and audible speaker playback were not executed for this release. `resolveSound()` returns metadata without playback. Handbook browser checks do not validate the renderer's GUI or the game.

0.16.0 のフル Node 試験3,163成功・39skip、core533成功などは [過去の検査記録](../VERIFICATION_0160_JA.md) の数値です。今回の文書整備でフル試験を再実行した件数に算入していません。過去の素材依存試験の除外も維持しています。

The 0.16.0 full Node run (3,163 passed, 39 skipped), 533 core passes and other counts are [historical results](../VERIFICATION_0160_JA.md). They are not counted as newly rerun tests for this documentation release. Historical asset-dependent exclusions remain in place.

## 配布と権利 / Distribution and rights

完全なソースZIPには教材の実行に必要なソースを含め、文書だけのZIPは閲覧用です。私的なパック・ゲームフォント・ゲーム画像・ネイティブ依存バイナリ・実行ログは同梱しません。配布時のハッシュはソースZIP内の `PUBLIC-DISTRIBUTION.json`、ZIPと単独閲覧ファイルのハッシュは同時配布の `SHA256SUMS.txt` で確認できます。

The complete source ZIP includes code needed to execute the tutorial. The documentation-only ZIP is for reading. Neither bundles private packs, game fonts/images, native dependency binaries or runtime logs. `PUBLIC-DISTRIBUTION.json` records source-release file hashes; the accompanying `SHA256SUMS.txt` covers the archives and standalone reading files.

公開者が権利を持つか許諾できる独自部分に PolyForm Noncommercial 1.0.0 を採用しました。第三者と入力素材の条件は別です。原文と日英の説明・対象範囲・Required Noticeを同梱します。非商用のソース公開ソフトウェアとして扱います。

PolyForm Noncommercial 1.0.0 applies to original portions the publisher owns or may license. Third-party and input terms remain separate. The distribution includes unchanged terms, Japanese/English explanations, scope and Required Notice. The project is noncommercial source-available software.
