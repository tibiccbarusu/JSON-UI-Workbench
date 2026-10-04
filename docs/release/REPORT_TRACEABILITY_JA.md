# 資料と改修の対応

JSON UI Workbench 0.14.0 は、利用者から提供された r41（0.13.6）のソース、
検証結果、CONCERT 88 MIDI 不具合報告、Drawned 回顧報告と、その後の拡張作業台での
アイテム描画の知見を基に改修しました。元の入力 ZIP は変更していません。
公開用パッケージには、提供された報告書・スクリーンショット・実機ログそのものを
再収録せず、対応するコード、独立した回帰試験とこの説明を収録しています。

## 資料に対する対応範囲

| 根拠・問題 | 今回の対応 | 検証・説明 |
|---|---|---|
| CONCERT 88 第3・4・6章: flip_book の接続・連結と通常UV/sizeのlooping | 問題の組合せを限定して診断。正当な単独flip_bookまで一律に禁止しない | [animation-text.md](animation-text.md)、`animation-text-compatibility.test.mjs` |
| CONCERT 88 第5・6章: centerアンカーとlabel内部の縦位置 | 要素の配置から文字内部の縦位置を分離 | 同上 |
| Drawned K06 / P06 / 第12章: 親側のcollection文脈不足 | 既知のcustom_dropdown親読取りを検出し、修正版と区別 | [binding-diagnostics.md](binding-diagnostics.md)、`binding-evidence42.node.test.mjs` |
| Drawned K11・K12 / 第9章: 名前探索の補完 | 非アクティブな局所候補から別枝へ逃げない。生成行境界を守り、全体検索への補完を別に記録 | 同上 |
| Drawned P05: panel/imageへのfocus_enabled | 受動要素だけを限定診断。入力用button/toggleを誤禁止しない | 同上 |
| Drawned K17: 非表示候補の元番号 | 可視性と元のコレクション番号を分離した回帰検証 | 同上、`release-form-geometry.test.mjs` |
| Drawned P04: 空のフォームpayload | 明示した空ModalFormを、状態未指定と区別して拒否 | [form-geometry.md](form-geometry.md) |
| Drawned K10 / P09: 画像と操作面のずれ | 描画記録に入力祖先との矩形差、重なり、クリップ前後を追加 | 同上 |
| Drawned P18: 長い証拠ID | 安定した短縮キーと原IDの復元表を追加。表の予算超過も明示 | 同上 |
| Drawned P18 / 第9章: 展開・走査・転送の上限 | 要求数と生成数、打切り軸を追加。不完全な通常PNGを停止し、概要JSONを取得可能に | [limits-performance.md](limits-performance.md)、`limits-performance-release.test.mjs` |
| 繰り返し描画の重さ | 同じ投影からのモデル・木構造の再構築を削減。bindingと時刻は再評価 | 同上 |
| 拡張作業台: アカシア看板が板材になる等 | 版別の符号付きアイテムID、静的property_bag、看板用スプライトを解決 | [item-rendering.md](item-rendering.md)、`native-item-profile14.test.mjs` |
| 拡張作業台: 避雷針・盾等の見た目 | モデル用の材質画像をアイテムアイコンと誤認しない。未対応モデルは診断 | 同上 |

テストのファイル名は `editor-core/tests/` または `local-node/tests/` から探せます。
番号入りの既存ファイル名は履歴・互換性のため残しています。

## まだ実装・実証していないこと

- Minecraftクライアントのネイティブ入力、Script API、クラッシュの完全な再現。
- Drawnedの全規模構成や、CONCERT 88の全曲を実機で再試験したという保証。
- JSON UIの式・型変換・動的texture更新の全組合せについての実機互換表。
- 上限を超える全フレーム／全診断本文の分割転送。概要出力は本文の完全保存ではありません。
- すべてのアイテムの3D形状、染色、装飾、NBT、実行時IDの再現。
- ゲーム側FPSの改善率。今回のキャッシュ修正はツールの処理削減です。

資料内の推測や提案を、実証済みの一般仕様へ置き換えていません。
特に、部品単位の検証を同時生成時の全体動作の保証にはしません。

## 正式名称と用語

| 表記 | 意味 |
|---|---|
| JSON UI Workbench | 製品全体の正式名称 |
| 0.14.0 | 今回の公開用リリース番号 |
| r41 / 0.13.6 | 入力された旧版の識別名。現行製品名ではない |
| エディター | パック読込み・原文編集・配置編集を行うブラウザー画面 |
| プレビューレンダラー | 明示した状態から配置・描画を計算する共通エンジン |
| 互換性診断 | 既知の不適合や未解決条件を記録する機能。実機認証ではない |
| 操作シミュレーション | Workbench内部の状態更新。Minecraftの入力処理とは別 |
| CLI | ローカルで検査・画像出力を実行するコマンドライン機能 |

既存のAPI識別子・JSON名前空間・`JSONUI_*`環境変数は互換性のため維持します。
