# アプリ画面 — ローカル版0.4.0

このフォルダーにはHTML、CSS、翻訳表、JSON UIスキーマを保持する。通常の起動入口は配布ルートの `start.bat` である。

Nodeサーバーがこの画面と `src/`、固定vendor資産を配信する。ES Modulesをそのまま読み込む構成で、通常起動にbundlerとnpm installは不要。`/api/node/` の保持投影・実行モデル・フレーム中間表現を使い、解釈・binding・アニメーション・配置計算をNode Workerへ送る。ブラウザは操作画面とCanvas描画を担当する。

静的HTTP配信にも互換経路は残るが、ローカル版のCPU処理移動・大型パック処理を利用するにはNode経由で起動する。

日本語の利用手順は配布ルートの `README-LOCAL-JA.md` と `local-node/START-ja.md`、今回の操作・検査・制限は `docs/revision04/ui-launcher-ja.md` を参照する。

Pocketプレビューは禁止。Windowsネイティブ実行とブラウザ動的目視の未実施を、静的確認の成功で置き換えない。
