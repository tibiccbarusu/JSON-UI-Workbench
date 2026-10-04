# 評価上限・転送診断・繰返し描画の改善

## 確認した原因と変更

r41 の Node フレーム API は、同じ `projectionId` の要求でも毎回 JSON を読み直し、UI モデルと木構造を構築してから全体を検査・ハッシュ化していました。描画結果キャッシュが当たる場合にもこの前処理が発生していました。

改修版では内容で識別された投影から保持モデルへの対応を最大 8 件保存します。同じ投影の再描画は保持モデルを利用します。binding 値、スクロール、アニメーション時刻等は引き続き別の状態として評価します。モデルが追い出された場合は再構築し、パック／catalog の更新では対応表も破棄します。識別子照合は温まったキャッシュでも省略しません。

これはレンダラー自身の前処理削減です。Minecraft の FPS 改善や、Drawned の実機性能改善を実測したという意味ではありません。画質や候補数の上限を下げて高速化したものでもありません。

## 不完全な評価を明示する

- 投影統計に `requestedGridItems`／`requestedFactoryItems` を追加し、既存の生成数と比較できるようにしました。
- これらの要求数は**訪問した生成器の範囲**です。上限で親の生成が止まると未訪問の子があるため、UI 全体の理論総数とは限りません。
- 実行用モデルへの変換で失われていた `uiModel.stats` を保持し、モデル解析の打切りを後段へ伝えます。
- `quality.evaluation`／`frame.evaluation` は投影・モデル解析・binding 観測・layout の打切りをまとめます。上限による不足は `unknown`、`complete:false` になります。未知を実機不正と断定しません。
- 通常の PNG 出力は不完全評価を `RASTER_EVALUATION_INCOMPLETE` で停止します。明示的な `--allow-partial` は可能な診断描画に限られ、`draft:true`、`preview_complete:false` です。描画矩形自体が壊れている場合は部分描画も停止します。
- `--strict-semantics` はフレーム段階の不完全評価も停止します。
- `frame.workload` に展開済みプレビューの control・binding・image・custom renderer 数を付けます。これはフレーム処理前に保持モデルを一度走査した値で、ネイティブの内部オブジェクト数や FPS 推定ではありません。

既存の安全予算は増やしていません。現在の主要な予算はモデル 64 MiB、50,000 ノード、描画 5,000 矩形、応答 24 MiB です。生成器・型付き状態には別の上限があり、Minecraft 自体の容量上限ではありません。

## 応答が 24 MiB を超えたとき

`NODE_FRAME_REPLY_LIMIT` は JSON 転送の制限です。描画や実機互換性の失敗と区別してください。次のように画像なしの概要を保存できます。

```sh
node local-node/cli.mjs preview --session session.json --file ui/example.json --definition example.screen --frame-summary --format json --out frame-summary.json
```

HTTP API の同等指定は `/api/node/frame` の `frameTransport:"summary-v1"` です。

概要には生成数・打切り理由・展開規模・描画矩形数・診断コード別件数を返します。全フレームや全診断本文は含まず、`frame_included:false`、`renderable:false` を明示します。コード群は最大 64 種で、総診断数と集計数を別記します。必要なら対象を部品単位に絞って元の詳細出力を取得してください。部品別の合格を全体評価の代わりにはしません。

`--frame-summary` は JSON 専用です。PNG/SVG、`--strict-animation` との併用は拒否します。概要取得でも元の生成・評価予算は適用されるため、生成予算や時間予算を回避する機能ではありません。全診断の分割転送や無制限の外部ファイル保存は今回実装していません。

## 回帰検証

`local-node/tests/limits-performance-release.test.mjs` は次を確認します。

1. 入れ子 factory の要求 8 件に対して 6 件しか生成できない場合、合格にしない。
2. モデル解析の打切りが実行モデル変換後にも残る。
3. 24 MiB 超の通常応答を拒否し、同じ入力の概要応答は小さい JSON として返す。
4. 資源が正常でも、不完全投影の PNG を資源読込み前に止める。
5. CLI の概要ファイルを読み戻せる。
6. 同じ投影で状態が変わってもモデル構築は 1 回、後続 2 回は保持モデルを利用し、表示文字は正しく更新される。

既存のフレーム、差分転送、保持キャッシュ、CLI 品質、PNG、ブラウザ側 Node フレーム制御の回帰検証も実施しています。件数やプレビューの合格は Minecraft のネイティブ動作保証ではありません。
