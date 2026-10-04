# サイト・コマンド・起動コンソールの表示言語

初期表示は日本語です。サイトの表示言語は画面の言語選択から切り替えます。サイトの表示言語と、プレビューするリソースパックの言語・フォントは別の設定です。

## CLI で切り替える

一度のコマンドだけ英語にする場合は `--language en` を指定します。`--language ja` で日本語にできます。

```cmd
node local-node/cli.mjs help --language en
node local-node/cli.mjs status --session C:\jui-work\session.json --language en
```

表示言語は、明示オプション、環境変数 `JSONUI_LANGUAGE`、セッション設定の `language`、日本語の順で選びます。表示言語に指定できる値は `ja` と `en` です。`locale` はパックの文字列とフォントの設定なので、その値は表示言語の切替では変わりません。

セッションの既定表示を保存する場合は、次の内容をアプリの外の作業フォルダーに `settings.json` として保存します。

```json
{
  "language": "en",
  "locale": "ja_JP"
}
```

```cmd
node local-node/cli.mjs settings --session C:\jui-work\session.json --file C:\jui-work\settings.json
node local-node/cli.mjs help --session C:\jui-work\session.json
```

`help` も指定したセッションの表示言語を読みます。`help` はセッションやロックを作りません。設定ファイルが壊れていて説明を表示できないときは `help --language ja` のように表示言語を明示できます。

`workflow` の各コマンドに `language` オプションは指定できません。実行全体には `workflow --language en` を指定し、セッションの設定変更には通常の `settings` コマンドを使います。途中の設定変更は、明示オプションと環境変数による指定がない場合、以後の診断表示に反映されます。

通常のコマンド出力は従来どおり JSON 1 件です。機械用のキー、エラーコード、パックの原文、UI の文字列は翻訳しません。未登録の診断はコードから英語の見出しを作り、元の詳細文を `original_message` などに残します。元の診断に含まれる日本語は証拠のために保持されます。

## Windows の起動コンソールを英語にする

アプリのフォルダーで、コマンドプロンプトから実行します。環境変数の変更は現在のコマンドプロンプトとその子プロセスに限られます。

```cmd
set "JSONUI_LANGUAGE=en"
start.bat
```

日本語へ戻す場合は次のようにします。

```cmd
set "JSONUI_LANGUAGE=ja"
start.bat
```

BAT/CMD は ASCII と CRLF のままです。初回導入の文面は `local-node/bootstrap-messages-ja.txt` と `local-node/bootstrap-messages-en.txt` から表示します。これらを含む ZIP 全体を展開してください。

日本語の文面の表示時には、現在のコンソールのコードページを取得・検査できた場合だけ、この起動中に UTF-8 へ切り替えます。通常の終了経路では元へ戻します。OS の設定、レジストリ、スクリプト実行ポリシーは変更しません。コンソール自体の強制終了やシステム障害まで復元を保証するものではありません。

## Linux / macOS の起動

```bash
JSONUI_LANGUAGE=en ./start.sh
```

既定は日本語です。Node.js が見つからない場合や版確認に失敗した場合の案内も表示言語に従います。

## 検証の範囲

CLI は Linux 上の Node.js で実際の別プロセスを使い、言語選択、保存設定、読み込み、編集拒否、原文保持、編集と取り消しを検査しています。Windows の BAT・CMD・PowerShell は今回の環境では実行できないため、構文・固定文面・文字コード・終了経路・従来の検証境界を静的に確認しています。
