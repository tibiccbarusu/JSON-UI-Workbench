#requires -Version 5.1
[CmdletBinding()]
param()

# This file is executed with -File. Existing execution/signature policy applies.
# No policy, registry, machine PATH, installed Node, or source pack is modified.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$stateRoot = Join-Path $projectRoot '.jsonui'
$logPath = Join-Path $stateRoot 'bootstrap.log'
$runtimeRoot = Join-Path $stateRoot 'runtime'
$portableNode = Join-Path $runtimeRoot 'node.exe'
$nodeVersion = '24.21.0'
$runtimeHashes = @{
    'x64' = 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32'
    'arm64' = 'dff59da18b6ffe1bf1ca99e1d2af4906080c481740619f5b5098c0fca28bd9b7'
}
$utf8 = [Text.UTF8Encoding]::new($false)
$bootstrapMutex = $null
$mutexOwned = $false
$staging = $null
$exitCode = 1
$bootstrapRunId = [Guid]::NewGuid().ToString()
$bootstrapClock = [Diagnostics.Stopwatch]::StartNew()
$script:bootstrapSequence = 0


# Display preference only; source-pack locale and OS policy are unchanged.
$displayLanguage = if ($env:JSONUI_LANGUAGE -eq 'en') { 'en' } else { 'ja' }
$localizedMessages = @{
    'SETUP_LOG_UNAVAILABLE: ログファイルへ書き込めません。画面の表示を確認してください。' = 'SETUP_LOG_UNAVAILABLE: The log file could not be written. Check the startup window.'
    'SETUP_PATH_LONG: 展開先が長すぎます。短い書き込み可能なフォルダーへ一式を展開してください。' = 'SETUP_PATH_LONG: The extraction path is too long. Extract the complete package to a short writable folder.'
    'SETUP_NODE_TIMEOUT: Node のバージョン確認が 10 秒で終了しませんでした。' = 'SETUP_NODE_TIMEOUT: Node version verification did not finish within 10 seconds.'
    'SETUP_HTTP_STATUS: 公式配布元が成功を返しませんでした。' = 'SETUP_HTTP_STATUS: The official download server did not return a successful response.'
    'SETUP_DOWNLOAD_LIMIT: ダウンロードの上限を超えています。' = 'SETUP_DOWNLOAD_LIMIT: The download exceeds the size limit.'
    'SETUP_DOWNLOAD_TIMEOUT: ダウンロードが 180 秒を超えました。' = 'SETUP_DOWNLOAD_TIMEOUT: The download exceeded 180 seconds.'
    'SETUP_DOWNLOAD_TIMEOUT: 受信待ちが通信期限または全体 180 秒の期限を超えました。' = 'SETUP_DOWNLOAD_TIMEOUT: Receiving data exceeded the connection deadline or the whole-download limit of 180 seconds.'
    '受信済み {0:N1} MiB' = 'Received {0:N1} MiB'
    '受信 {0}% ({1:N1}/{2:N1} MiB)、経過 {3:N0} 秒。受信後に検証します。' = 'Received {0}% ({1:N1}/{2:N1} MiB), elapsed {3:N0} seconds. Verification follows the download.'
    '受信済み {0:N1} MiB、経過 {1:N0} 秒。総量は不明です。' = 'Received {0:N1} MiB, elapsed {1:N0} seconds. Total size is unknown.'
    '受信が完了しました。SHA-256 を検証しています。' = 'Download complete. Verifying SHA-256.'
    'SETUP_DOWNLOAD_TRUNCATED: 受信サイズが一致しません。' = 'SETUP_DOWNLOAD_TRUNCATED: The received size does not match the expected size.'
    'SETUP_SHA256_MISMATCH: Node 実行ファイルの SHA-256 が公式固定値と一致しません。実行しません。' = 'SETUP_SHA256_MISMATCH: The Node executable does not match the pinned official SHA-256. It will not be executed.'
    '公式 Node.js {0} {1} の SHA-256 が一致しました。' = 'The official Node.js {0} {1} SHA-256 matches the pinned value.'
    'ローカル起動の準備を開始します。管理者権限と npm は不要です。' = 'Preparing local startup. Administrator privileges and npm are not required.'
    'SETUP_ALREADY_RUNNING: 別の初回準備が進行中です。30 秒で待機を終了しました。' = 'SETUP_ALREADY_RUNNING: Another setup is in progress. Waiting stopped after 30 seconds.'
    'SETUP_ARCH_UNSUPPORTED: この初期導入は Windows x64 / ARM64 に対応します。' = 'SETUP_ARCH_UNSUPPORTED: This bootstrap supports Windows x64 and ARM64.'
    '専用 Node が不完全または検証不能のため、元の項目を別名で保管しました。公式版を再取得します。' = 'The private Node runtime is incomplete or could not be verified. The original was preserved under another name. Downloading the official runtime again.'
    'Node.js {0} {1} を公式配布元から取得します。試行 {2}/2' = 'Downloading Node.js {0} {1} from the official server. Attempt {2}/2.'
    'SETUP_NODE_VERSION: 検証後の Node バージョンが一致しません。' = 'SETUP_NODE_VERSION: The verified Node version does not match the expected version.'
    'Node.js {0} の専用実行ファイルを準備しました。' = 'The private Node.js {0} executable is ready.'
    'サイトを起動します。準備完了後に既定のブラウザを開きます。' = 'Starting the local site. The default browser will open when the site is ready.'
    'SETUP_FAILED: 起動に失敗しました。' = 'SETUP_FAILED: Startup failed.'
}
function Get-LocalizedMessage([string] $Message) {
    if ($displayLanguage -eq 'en' -and $localizedMessages.ContainsKey($Message)) {
        return $localizedMessages[$Message]
    }
    return $Message
}

function Write-Status([string] $Code, [string] $Message) {
    # Keep native exception paths and credential-shaped text out of retained logs.
    $safeMessage = $Message -replace '(?i)(?:[a-z]:[\\/]|\\\\)[^\r\n<>"'']*', '[LOCAL_PATH]'
    $safeMessage = $safeMessage -replace '(?i)(token|password|authorization|cookie)\s*[:=]\s*[^\s,;]+', '[REDACTED]'
    $safeMessage = $safeMessage -replace '[\r\n\x00-\x1f\x7f]+', ' '
    if ($safeMessage.Length -gt 2048) { $safeMessage = $safeMessage.Substring(0, 2048) + '[TRUNCATED]' }
    $script:bootstrapSequence++
    $record = [ordered] @{
        timestamp = [DateTime]::UtcNow.ToString('o')
        severity = if ($Code -match 'FAILED|MISMATCH|TIMEOUT') { 'ERROR' } else { 'INFO' }
        event = $Code
        message = $safeMessage
        logger = 'jsonui.bootstrap'
        run_id = $bootstrapRunId
        correlation_id = $bootstrapRunId
        context = [ordered] @{ sequence = $script:bootstrapSequence; elapsed_ms = $bootstrapClock.ElapsedMilliseconds }
    }
    $line = $record | ConvertTo-Json -Compress -Depth 4
    Write-Host $line
    if ([IO.Directory]::Exists($stateRoot)) {
        try { [IO.File]::AppendAllText($logPath, $line + [Environment]::NewLine, $utf8) }
        catch { Write-Host (Get-LocalizedMessage 'SETUP_LOG_UNAVAILABLE: ログファイルへ書き込めません。画面の表示を確認してください。') }
    }
}

function Write-DownloadProgress([long] $Received, [long] $Expected, [double] $ElapsedSeconds) {
    # This percentage refers only to received bytes, never to setup completion.
    if ($Expected -gt 0) {
        $percent = [int] [Math]::Floor([Math]::Min(100, (100.0 * $Received / $Expected)))
        $message = (Get-LocalizedMessage '受信 {0}% ({1:N1}/{2:N1} MiB)、経過 {3:N0} 秒。受信後に検証します。') -f $percent, ($Received / 1048576), ($Expected / 1048576), $ElapsedSeconds
    } else {
        $message = (Get-LocalizedMessage '受信済み {0:N1} MiB、経過 {1:N0} 秒。総量は不明です。') -f ($Received / 1048576), $ElapsedSeconds
    }
    Write-Status 'SETUP_DOWNLOADING' $message
}

function Assert-PathBudget([string] $LiteralPath) {
    # .NET String.Length counts UTF-16 code units, including surrogate pairs.
    if (($LiteralPath.Length + 1) -gt 240) {
        throw (Get-LocalizedMessage 'SETUP_PATH_LONG: 展開先が長すぎます。短い書き込み可能なフォルダーへ一式を展開してください。')
    }
}

function Get-NodeVersion([string] $Executable) {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Executable
    $info.Arguments = '--version'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    try {
        if (-not $process.Start()) { return $null }
        # Output is bounded by the fixed --version operation on an installed or
        # hash-verified official Node executable. Wait has a finite deadline.
        if (-not $process.WaitForExit(10000)) {
            $process.Kill()
            throw (Get-LocalizedMessage 'SETUP_NODE_TIMEOUT: Node のバージョン確認が 10 秒で終了しませんでした。')
        }
        $value = $process.StandardOutput.ReadToEnd().Trim()
        if ($process.ExitCode -ne 0 -or $value -notmatch '^v([0-9]+)\.([0-9]+)\.([0-9]+)$') { return $null }
        $major = [int] $Matches[1]
        $minor = [int] $Matches[2]
        if ($major -gt 22 -or ($major -eq 22 -and $minor -ge 14)) { return $value }
        return $null
    } finally { $process.Dispose() }
}

function Get-VerifiedRuntime([string] $Architecture, [string] $Destination) {
    $uri = [Uri] ('https://nodejs.org/dist/v{0}/win-{1}/node.exe' -f $nodeVersion, $Architecture)
    if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'nodejs.org') { throw 'SETUP_SOURCE_INVALID' }
    $request = [Net.HttpWebRequest]::Create($uri)
    $request.Method = 'GET'
    $request.AllowAutoRedirect = $false
    $request.Timeout = 30000
    $request.ReadWriteTimeout = 30000
    $request.UserAgent = 'JSONUI-Local-Bootstrap/1.0'
    $response = $null
    $source = $null
    $target = $null
    $clock = [Diagnostics.Stopwatch]::StartNew()
    try {
        $response = $request.GetResponse()
        if ([int] $response.StatusCode -ne 200) { throw (Get-LocalizedMessage 'SETUP_HTTP_STATUS: 公式配布元が成功を返しませんでした。') }
        if ($response.ContentLength -gt 268435456) { throw (Get-LocalizedMessage 'SETUP_DOWNLOAD_LIMIT: ダウンロードの上限を超えています。') }
        $source = $response.GetResponseStream()
        $target = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $buffer = New-Object byte[] 65536
        [long] $total = 0
        [long] $nextReport = 5
        Write-DownloadProgress 0 $response.ContentLength $clock.Elapsed.TotalSeconds
        while ($true) {
            # The remaining whole-download deadline must constrain the read
            # itself. Checking only after Read() allowed one extra 30 s wait.
            $remainingMs = 180000 - $clock.ElapsedMilliseconds
            if ($remainingMs -le 0) { throw (Get-LocalizedMessage 'SETUP_DOWNLOAD_TIMEOUT: ダウンロードが 180 秒を超えました。') }
            $readWaitMs = [int] [Math]::Min(30000, $remainingMs)
            $readTask = $source.ReadAsync($buffer, 0, $buffer.Length)
            if (-not $readTask.Wait($readWaitMs)) {
                $request.Abort()
                throw (Get-LocalizedMessage 'SETUP_DOWNLOAD_TIMEOUT: 受信待ちが通信期限または全体 180 秒の期限を超えました。')
            }
            $count = $readTask.GetAwaiter().GetResult()
            if ($clock.Elapsed.TotalMilliseconds -ge 180000) { throw (Get-LocalizedMessage 'SETUP_DOWNLOAD_TIMEOUT: ダウンロードが 180 秒を超えました。') }
            if ($count -eq 0) { break }
            $total += $count
            if ($total -gt 268435456) { throw (Get-LocalizedMessage 'SETUP_DOWNLOAD_LIMIT: ダウンロードの上限を超えています。') }
            $target.Write($buffer, 0, $count)
            if ($clock.Elapsed.TotalSeconds -ge $nextReport) {
                Write-DownloadProgress $total $response.ContentLength $clock.Elapsed.TotalSeconds
                $nextReport = [long] $clock.Elapsed.TotalSeconds + 5
            }
        }
        if ($response.ContentLength -ge 0 -and $total -ne $response.ContentLength) { throw (Get-LocalizedMessage 'SETUP_DOWNLOAD_TRUNCATED: 受信サイズが一致しません。') }
        $target.Flush($true)
        Write-DownloadProgress $total $response.ContentLength $clock.Elapsed.TotalSeconds
        Write-Status 'SETUP_VERIFYING' (Get-LocalizedMessage '受信が完了しました。SHA-256 を検証しています。')
    } finally {
        if ($target) { $target.Dispose() }
        if ($source) { $source.Dispose() }
        if ($response) { $response.Dispose() }
        $request.Abort()
        $clock.Stop()
    }
    $actualHash = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $runtimeHashes[$Architecture]) {
        throw (Get-LocalizedMessage 'SETUP_SHA256_MISMATCH: Node 実行ファイルの SHA-256 が公式固定値と一致しません。実行しません。')
    }
    Write-Status 'SETUP_SHA256_OK' ((Get-LocalizedMessage '公式 Node.js {0} {1} の SHA-256 が一致しました。') -f $nodeVersion, $Architecture)
}

try {
    Assert-PathBudget (Join-Path $stateRoot 'dl-00000000000000000000000000000000\node.part')
    Assert-PathBudget (Join-Path $projectRoot 'local-node\launcher.mjs')
    [IO.Directory]::CreateDirectory($stateRoot) | Out-Null
    if ([IO.File]::Exists($logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 1048576) {
        $previousLog = $logPath + '.1'
        if ([IO.File]::Exists($previousLog)) { [IO.File]::Delete($previousLog) }
        [IO.File]::Move($logPath, $previousLog)
    }
    Write-Status 'SETUP_BEGIN' (Get-LocalizedMessage 'ローカル起動の準備を開始します。管理者権限と npm は不要です。')
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $key = [BitConverter]::ToString($hash.ComputeHash($utf8.GetBytes($projectRoot.ToLowerInvariant()))).Replace('-', '').Substring(0, 24) }
    finally { $hash.Dispose() }
    $bootstrapMutex = [Threading.Mutex]::new($false, ('Local\JsonUiNodeBootstrap-' + $key))
    try { $mutexOwned = $bootstrapMutex.WaitOne(30000) }
    catch [Threading.AbandonedMutexException] { $mutexOwned = $true }
    if (-not $mutexOwned) { throw (Get-LocalizedMessage 'SETUP_ALREADY_RUNNING: 別の初回準備が進行中です。30 秒で待機を終了しました。') }

    $architecture = $env:PROCESSOR_ARCHITEW6432
    if (-not $architecture) { $architecture = $env:PROCESSOR_ARCHITECTURE }
    switch ($architecture.ToUpperInvariant()) {
        'AMD64' { $architecture = 'x64' }
        'ARM64' { $architecture = 'arm64' }
        default { throw (Get-LocalizedMessage 'SETUP_ARCH_UNSUPPORTED: この初期導入は Windows x64 / ARM64 に対応します。') }
    }
    $nodeExecutable = $null
    if ([IO.Directory]::Exists($runtimeRoot) -or [IO.File]::Exists($runtimeRoot)) {
        if ([IO.File]::Exists($portableNode)) {
            $cachedHash = (Get-FileHash -LiteralPath $portableNode -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($cachedHash -eq $runtimeHashes[$architecture]) {
                $cachedVersion = Get-NodeVersion $portableNode
                if ($cachedVersion -eq ('v' + $nodeVersion)) { $nodeExecutable = $portableNode }
            }
        }
        if (-not $nodeExecutable) {
            $quarantine = Join-Path $stateRoot ('bad-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
            Assert-PathBudget $quarantine
            if ([IO.Directory]::Exists($runtimeRoot)) { [IO.Directory]::Move($runtimeRoot, $quarantine) }
            else { [IO.File]::Move($runtimeRoot, $quarantine) }
            Write-Status 'SETUP_RUNTIME_QUARANTINED' (Get-LocalizedMessage '専用 Node が不完全または検証不能のため、元の項目を別名で保管しました。公式版を再取得します。')
        }
    }
    if (-not $nodeExecutable) {
        $staging = Join-Path $stateRoot ('dl-' + [Guid]::NewGuid().ToString('N'))
        [IO.Directory]::CreateDirectory($staging) | Out-Null
        $partial = Join-Path $staging 'node.part'
        $ready = $false
        for ($attempt = 1; $attempt -le 2; $attempt++) {
            try {
                Write-Status 'SETUP_DOWNLOAD' ((Get-LocalizedMessage 'Node.js {0} {1} を公式配布元から取得します。試行 {2}/2') -f $nodeVersion, $architecture, $attempt)
                Get-VerifiedRuntime $architecture $partial
                $ready = $true
                break
            } catch {
                Write-Status 'SETUP_DOWNLOAD_FAILED' $_.Exception.Message
                if ([IO.File]::Exists($partial)) { [IO.File]::Delete($partial) }
                if ($attempt -eq 2 -or $_.Exception.Message -like 'SETUP_SHA256_MISMATCH*') { throw }
            }
        }
        if (-not $ready) { throw 'SETUP_DOWNLOAD_FAILED' }
        # Official standalone binary: no ZIP extraction, npm, or executable from
        # an unverified archive. Rename becomes visible only after SHA succeeds.
        $verifiedExe = Join-Path $staging 'node.exe'
        [IO.File]::Move($partial, $verifiedExe)
        if ((Get-NodeVersion $verifiedExe) -ne ('v' + $nodeVersion)) { throw (Get-LocalizedMessage 'SETUP_NODE_VERSION: 検証後の Node バージョンが一致しません。') }
        try {
            [IO.Directory]::Move($staging, $runtimeRoot)
            $staging = $null
        } catch {
            if (-not [IO.File]::Exists($portableNode)) { throw }
            $concurrentHash = (Get-FileHash -LiteralPath $portableNode -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($concurrentHash -ne $runtimeHashes[$architecture]) { throw }
        }
        $nodeExecutable = $portableNode
        Write-Status 'SETUP_RUNTIME_READY' ((Get-LocalizedMessage 'Node.js {0} の専用実行ファイルを準備しました。') -f $nodeVersion)
    }
    if ($staging -and [IO.Directory]::Exists($staging)) { [IO.Directory]::Delete($staging, $true); $staging = $null }
    $bootstrapMutex.ReleaseMutex()
    $mutexOwned = $false
    Write-Status 'SETUP_LAUNCH' (Get-LocalizedMessage 'サイトを起動します。準備完了後に既定のブラウザを開きます。')
    $preflight = Join-Path $PSScriptRoot 'preflight28.cjs'
    & $nodeExecutable $preflight
    if ($LASTEXITCODE -ne 0) { throw 'LAUNCH_PACKAGE_INCOMPLETE' }
    $env:JSONUI_BOOT_SOURCE = 'powershell'
    $launcher = Join-Path $PSScriptRoot 'launcher.mjs'
    & $nodeExecutable $launcher
    $exitCode = $LASTEXITCODE
} catch {
    try { Write-Status 'SETUP_FAILED' $_.Exception.Message } catch { Write-Host (Get-LocalizedMessage 'SETUP_FAILED: 起動に失敗しました。') }
    $exitCode = 1
} finally {
    if ($staging -and [IO.Directory]::Exists($staging)) { [IO.Directory]::Delete($staging, $true) }
    if ($mutexOwned -and $bootstrapMutex) { $bootstrapMutex.ReleaseMutex() }
    if ($bootstrapMutex) { $bootstrapMutex.Dispose() }
}
exit $exitCode
