# GitHub で公開する手順

対象: **JSON UI Workbench 0.16.1**。公開用ソース ZIP を使ってください。
元の r41 全体や検証結果 ZIP をそのままアップロードする手順ではありません。

0.16.1 では `npm start` は CLI ヘルプを表示して終了します。GUI を確認する場合は
`npm run gui` を明示します。Node API / HTTP API の入口は
[新しい説明書](manual/USER_GUIDE_JA.md) を優先してください。ライセンスは以下の現行条件を確認してください。

## 1. 公開するフォルダーを用意する

1. 公開用 ZIP を新しい場所に展開します。`package.json` と `README.md` が
   入っているフォルダーがプロジェクトのルートです。
2. Node.js 22.14.0 以降を用意します。Windows ではフォルダー内でターミナルを開きます。
3. 次を実行します。

```powershell
npm ci --ignore-scripts
node scripts/release/audit-public.mjs
npm run test:release
npm start
```

`npm ci` は固定した依存関係を入れます。Minecraft の素材は別途、自分で正規に
入手したものをアプリに読み込ませます。Node のローカルサーバーは GitHub Pages
へアップロードしても動きません。GitHub へのソース公開と Web サービスの運営は別です。

受け取った配布物が変更されていないことをファイルごとに確認するには、編集前に
`node scripts/release/audit-public.mjs --verify-manifest` を実行します。
`PUBLIC-DISTRIBUTION.json` は配布時点のハッシュ一覧で、Git には追加しません。
通常の `audit-public.mjs` は、意図したソース編集をハッシュ不一致として拒否しません。
この監査は公開物の内容を対象にするため、起動後のログや私的な素材も検出します。
使い込んだ作業フォルダーから再配布するときは、公開ビルダーで新しい配布フォルダーを
作り、その配布フォルダーに対して監査してください。手元の素材を削除する必要はありません。

## 2. 権利表記を確認する

独自部分を **PolyForm Noncommercial License 1.0.0** で提供します。条件に従った非商用の利用・改変・再配布は可能で、商用目的は許可しません。公開者が所有するか許諾できる範囲と、除外される第三者・ゲーム素材は [LICENSE.md](../../LICENSE.md) と [日本語説明](../../LICENSE-JA.md) で確認してください。第三者の権利表示と本文を保持します。原文・説明・package のライセンス指定を GitHub のテンプレートで上書きしないでください。

商用制限があるので、「オープンソース」ではなく「非商用のソース公開ソフトウェア」と説明します。AI が書いたことだけで第三者の権利まで許諾できるわけではなく、元の全著作者記録を証明したものでもありません。

`package.json` の `private: true` は npm への誤公開を防ぐ設定です。
GitHub のリポジトリを Public にすることを禁止する設定ではありません。

## 3. GitHub Desktop で公開する（初めての方向け）

1. [GitHub](https://github.com/) のアカウントを作り、
   [GitHub Desktop](https://desktop.github.com/) を入れてサインインします。
2. GitHub Desktop の **File → Add local repository** で、展開したルートを指定します。
3. Git リポジトリではないと表示されたら、表示内の **create a repository here**
   から、その場所をリポジトリにします。既存の README / .gitignore / LICENSE を
   上書きするテンプレートは選びません。場所が二重の子フォルダーになっていないか
   確認してください。
4. **Changes** にコード、説明書、テストだけが並ぶことを確認します。
   自分の素材・ログ・`node_modules` が並んでいたら公開前に除外します。
5. Summary に `Initial release of JSON UI Workbench` と入力してコミットします。
   作成時に初回コミット済みならこの手順は不要です。
6. **Publish repository** を押します。Name は `jsonui-workbench`、説明は
   `An independent JSON UI editor and diagnostic renderer for Minecraft Bedrock packs`
   などにします。
7. 公開する場合は **Keep this code private** のチェックを外します。
   最後に **Publish Repository** を押すと公開されます。
8. **Repository → View on GitHub** で README とファイルを確認します。
   **Actions** の検査が成功していることも確認します。

この作業パッケージ自体には、アカウント操作や自動公開は含まれていません。

## 4. コマンドで公開する場合

GitHub で新しい空のリポジトリを作成します。README、.gitignore、ライセンスを
GitHub 側で追加せず、表示された HTTPS URL を使います。初回の認証は Git の
認証案内に従います。トークンをファイルや README に書きません。
この方法では [Git](https://git-scm.com/downloads) も必要です。
初回コミット時に名前とメールアドレスを求められたら、Git の案内に従って設定します。
メールアドレスを公開したくない場合は、GitHub の Settings → Emails に表示される
自分の noreply アドレスを使えます。

```powershell
git init -b main
git add .
git status
git commit -m "Initial release of JSON UI Workbench"
git remote add origin https://github.com/YOUR-ACCOUNT/jsonui-workbench.git
git push -u origin main
```

`YOUR-ACCOUNT` は自分の GitHub 名に置き換えます。すでに `origin` がある場合は
`git remote -v` で向き先を確認し、知らない向き先へ push しないでください。

## 5. ZIP を Releases で配布する

GitHub のリポジトリ画面から **Releases → Draft a new release** を開き、
タグ `v0.16.1`、タイトル `JSON UI Workbench 0.16.1` を設定します。変更点と
実機で未検証の範囲を書き、公開用 ZIP と SHA-256 ファイルを添付して公開します。
元の巨大な証跡 ZIP やバニラ素材は添付しません。

更新時は修正をコミットして **Push origin** を押し、新しい版の Release を作ります。
`private-assets/` は最初から Git の対象外です。ただし一度コミットした秘密情報は
後から `.gitignore` に書くだけでは履歴から消えません。

## 同梱の公開構成

| ファイル・フォルダー | 用途 |
|---|---|
| `README.md` | 現在の製品説明と起動手順 |
| `LICENSE.md` / `THIRD_PARTY_NOTICES.md` | 権利範囲と第三者ライセンス |
| `docs/release/` | 改修内容、素材の扱い、公開手順 |
| `editor-core/` | ブラウザ画面、共通エンジン、テスト、固定ライブラリ |
| `local-node/` | ローカルサーバー、CLI、処理 Worker |
| `scripts/release/` | 公開用ファイルの選別と検査 |
| `.github/workflows/ci.yml` | 公開ソースだけで実行する自動検査 |
| `.gitignore` / `.gitattributes` | 私的データの除外、改行・バイナリ指定 |

古い技術ガイドは `editor-core/docs/` に残しています。r41 当時の画面・コマンドや
実験の説明があるため、現在の起動・権利・検証範囲はルート README と
`docs/release/` を優先してください。

公開ビルダーは既定で `dist/` に新しいフォルダーと ZIP を作ります。
同名の出力があると上書きせず停止します。別の出力先には
`python scripts/release/package_public.py --output-dir OTHER-DIRECTORY` を指定します。

## 参照した公式資料

2026-09-28 確認。

- [GitHub Desktop による既存プロジェクトの公開](https://docs.github.com/en/desktop/adding-and-cloning-repositories/adding-an-existing-project-to-github-using-github-desktop)
- [ローカルコードを GitHub に追加](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)
- [リポジトリのライセンス](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)
- [GitHub の大きなファイルの扱い](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)
- [コミットのメールアドレス](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address)
- [npm の private 設定](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#private)
- [npm ci と ignore-scripts](https://docs.npmjs.com/cli/v11/commands/npm-ci/#ignore-scripts)
- [Minecraft 素材の扱い](ASSET_POLICY.md)
