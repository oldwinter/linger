#requires -Version 5.1
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallScriptPath,
    [string]$WorkParent = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $InstallScriptPath -PathType Leaf)) {
    throw "Install script not found: $InstallScriptPath"
}

$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:CurrentExe = (Get-Process -Id $PID).Path
$script:Assertions = 0

if (-not ('TestHttpMockServer' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

public sealed class TestHttpMockServer : IDisposable {
    private readonly TcpListener _listener;
    private readonly Thread _thread;
    private volatile bool _running;
    private volatile string _body;
    public int Port { get; private set; }
    public string BaseUrl { get { return "http://127.0.0.1:" + Port; } }
    public int InstallerRequests;

    public TestHttpMockServer(string installerBody) {
        _body = installerBody;
        _listener = new TcpListener(IPAddress.Loopback, 0);
        _listener.Start();
        Port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        _running = true;
        _thread = new Thread(Loop);
        _thread.IsBackground = true;
        _thread.Start();
    }

    private void Loop() {
        while (_running) {
            try {
                using (var client = _listener.AcceptTcpClient())
                using (var stream = client.GetStream()) {
                    var reader = new StreamReader(stream, Encoding.ASCII, false, 1024, true);
                    var requestLine = reader.ReadLine() ?? "";
                    while (true) {
                        var line = reader.ReadLine();
                        if (string.IsNullOrEmpty(line)) break;
                    }
                    if (requestLine.StartsWith("GET /install/linger-computer.ps1 ", StringComparison.Ordinal)) {
                        Interlocked.Increment(ref InstallerRequests);
                        var bytes = Encoding.UTF8.GetBytes(_body);
                        var header = Encoding.ASCII.GetBytes(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: " +
                            bytes.Length + "\r\nConnection: close\r\n\r\n");
                        stream.Write(header, 0, header.Length);
                        stream.Write(bytes, 0, bytes.Length);
                    } else {
                        var header = Encoding.ASCII.GetBytes(
                            "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                        stream.Write(header, 0, header.Length);
                    }
                }
            } catch {
                if (!_running) break;
            }
        }
    }

    public void Dispose() {
        _running = false;
        try { _listener.Stop(); } catch {}
        try { _thread.Join(1000); } catch {}
    }
}

public sealed class TestNpmTgzServer : IDisposable {
    private readonly TcpListener _listener;
    private readonly Thread _thread;
    private volatile bool _running;
    private readonly string _expectedPath;
    private readonly byte[] _tgzBytes;
    public int Port { get; private set; }
    public string BaseUrl { get { return "http://127.0.0.1:" + Port; } }

    public TestNpmTgzServer(string expectedPath, byte[] tgzBytes) {
        _expectedPath = expectedPath;
        _tgzBytes = tgzBytes;
        _listener = new TcpListener(IPAddress.Loopback, 0);
        _listener.Start();
        Port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        _running = true;
        _thread = new Thread(Loop);
        _thread.IsBackground = true;
        _thread.Start();
    }

    private void Loop() {
        while (_running) {
            try {
                using (var client = _listener.AcceptTcpClient())
                using (var stream = client.GetStream()) {
                    var reader = new StreamReader(stream, Encoding.ASCII, false, 1024, true);
                    var requestLine = reader.ReadLine() ?? "";
                    while (true) {
                        var line = reader.ReadLine();
                        if (string.IsNullOrEmpty(line)) break;
                    }
                    if (requestLine.StartsWith("GET " + _expectedPath + " ", StringComparison.Ordinal)) {
                        var header = Encoding.ASCII.GetBytes(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/gzip\r\nContent-Length: " +
                            _tgzBytes.Length + "\r\nConnection: close\r\n\r\n");
                        stream.Write(header, 0, header.Length);
                        stream.Write(_tgzBytes, 0, _tgzBytes.Length);
                    } else {
                        var header = Encoding.ASCII.GetBytes(
                            "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                        stream.Write(header, 0, header.Length);
                    }
                }
            } catch {
                if (!_running) break;
            }
        }
    }

    public void Dispose() {
        _running = false;
        try { _listener.Stop(); } catch {}
        try { _thread.Join(1000); } catch {}
    }
}
'@
}

function New-SingleFileTgzBytes([string]$EntryName, [byte[]]$ContentBytes) {
    $header = New-Object byte[] 512
    $nameBytes = [Text.Encoding]::ASCII.GetBytes($EntryName)
    [Buffer]::BlockCopy($nameBytes, 0, $header, 0, [Math]::Min($nameBytes.Length, 100))
    foreach ($pair in @(
        @{ Off = 100; Val = "0000755`0" },
        @{ Off = 108; Val = "0000000`0" },
        @{ Off = 116; Val = "0000000`0" },
        @{ Off = 124; Val = ([Convert]::ToString($ContentBytes.Length, 8).PadLeft(11, '0') + "`0") },
        @{ Off = 136; Val = "00000000000`0" },
        @{ Off = 148; Val = '        ' },
        @{ Off = 156; Val = '0' },
        @{ Off = 257; Val = "ustar`0" },
        @{ Off = 263; Val = '00' }
    )) {
        $b = [Text.Encoding]::ASCII.GetBytes($pair.Val)
        [Buffer]::BlockCopy($b, 0, $header, $pair.Off, $b.Length)
    }
    $sum = 0
    for ($i = 0; $i -lt 512; $i++) { $sum += [int]$header[$i] }
    $chk = [Convert]::ToString($sum, 8).PadLeft(6, '0') + "`0 "
    $chkBytes = [Text.Encoding]::ASCII.GetBytes($chk)
    [Buffer]::BlockCopy($chkBytes, 0, $header, 148, $chkBytes.Length)

    $padLen = (512 - ($ContentBytes.Length % 512)) % 512
    $ms = New-Object IO.MemoryStream
    try {
        $gz = New-Object IO.Compression.GZipStream($ms, [IO.Compression.CompressionMode]::Compress, $true)
        try {
            $gz.Write($header, 0, $header.Length)
            if ($ContentBytes.Length -gt 0) { $gz.Write($ContentBytes, 0, $ContentBytes.Length) }
            if ($padLen -gt 0) {
                $padBytes = New-Object byte[] $padLen
                $gz.Write($padBytes, 0, $padBytes.Length)
            }
            $trailer = New-Object byte[] 1024
            $gz.Write($trailer, 0, $trailer.Length)
        } finally {
            $gz.Dispose()
        }
        return ,$ms.ToArray()
    } finally {
        $ms.Dispose()
    }
}

function Assert-True([bool]$Condition, [string]$Message) {
    $script:Assertions++
    if (-not $Condition) {
        throw "ASSERTION FAILED: $Message"
    }
}

function Assert-Equal($Actual, $Expected, [string]$Message) {
    $script:Assertions++
    if ($Actual -cne $Expected) {
        throw "ASSERTION FAILED ($Message): expected='$Expected' actual='$Actual'"
    }
}

function Assert-Exit($Result, [int]$ExpectedCode, [string]$Message) {
    $script:Assertions++
    if ($Result.Code -ne $ExpectedCode) {
        throw "ASSERTION FAILED ($Message): expectedCode='$ExpectedCode' actualCode='$($Result.Code)'`nSTDOUT:`n$($Result.StdOut)`nSTDERR:`n$($Result.StdErr)"
    }
}

function Assert-Contains([string]$Haystack, [string]$Needle, [string]$Message) {
    $script:Assertions++
    if ($null -eq $Haystack -or -not $Haystack.Contains($Needle)) {
        throw "ASSERTION FAILED ($Message): expected to contain '$Needle'`nACTUAL:`n$Haystack"
    }
}

function Assert-NotContains([string]$Haystack, [string]$Needle, [string]$Message) {
    $script:Assertions++
    if ($null -ne $Haystack -and $Haystack.Contains($Needle)) {
        throw "ASSERTION FAILED ($Message): expected NOT to contain '$Needle'`nACTUAL:`n$Haystack"
    }
}

function Quote-Arg([string]$Arg) {
    if ($null -eq $Arg -or $Arg.Length -eq 0) { return '""' }
    if ($Arg -notmatch '[\s"\\]') { return $Arg }
    $sb = New-Object System.Text.StringBuilder
    $null = $sb.Append('"')
    $bs = 0
    for ($i = 0; $i -lt $Arg.Length; $i++) {
        $c = $Arg[$i]
        if ($c -eq '\') { $bs++ }
        elseif ($c -eq '"') { $null = $sb.Append('\', $bs * 2 + 1); $null = $sb.Append('"'); $bs = 0 }
        else { if ($bs -gt 0) { $null = $sb.Append('\', $bs); $bs = 0 }; $null = $sb.Append($c) }
    }
    if ($bs -gt 0) { $null = $sb.Append('\', $bs * 2) }
    $null = $sb.Append('"')
    return $sb.ToString()
}

function Invoke-Script([string[]]$ScriptArgs, [hashtable]$EnvOverrides = @{}, [string]$StdIn = '', [string]$ScriptOverride = '', [string]$Cwd = '') {
    $targetScript = if ($ScriptOverride) { $ScriptOverride } else { $InstallScriptPath }
    $all = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $targetScript) + $ScriptArgs
    $argStr = ($all | ForEach-Object { Quote-Arg $_ }) -join ' '

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $script:CurrentExe
    $psi.Arguments = $argStr
    if ($Cwd) { $psi.WorkingDirectory = $Cwd }
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.RedirectStandardInput = $true
    $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
    foreach ($k in $EnvOverrides.Keys) {
        if ($null -eq $EnvOverrides[$k]) { $psi.EnvironmentVariables.Remove($k) }
        else { $psi.EnvironmentVariables[$k] = [string]$EnvOverrides[$k] }
    }

    $proc = [System.Diagnostics.Process]::Start($psi)
    if ($StdIn) {
        $sw = New-Object System.IO.StreamWriter($proc.StandardInput.BaseStream, $script:Utf8NoBom)
        $sw.Write($StdIn)
        $sw.Dispose()
    } else {
        $proc.StandardInput.Close()
    }
    $outTask = $proc.StandardOutput.ReadToEndAsync()
    $errTask = $proc.StandardError.ReadToEndAsync()
    $proc.WaitForExit()
    return [PSCustomObject]@{
        Code = $proc.ExitCode
        StdOut = $outTask.Result
        StdErr = $errTask.Result
    }
}

function Remove-TreeClean([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    # Remove junctions cleanly without recursing into targets
    Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {
        if (($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -and $_.PSIsContainer) {
            cmd /c rmdir "$($_.FullName)" 2>$null | Out-Null
        } else {
            try { $_.Attributes = $_.Attributes -band (-bnot [IO.FileAttributes]::ReadOnly) } catch {}
        }
    }
    Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
}

function New-FakeStack([string]$Dir, [hashtable]$Opts = @{}) {
    $stackPath = Join-Path $Dir 'fake-stack.ps1'
    $logPath = Join-Path $Dir 'stack-calls.log'
    $kitLogPath = Join-Path $Dir 'kit-homes.log'
    $statusPath = Join-Path $Dir 'status.json'
    $hwPath = Join-Path $Dir 'hardware.json'
    $planPath = Join-Path $Dir 'plan.json'
    $homeDir = Join-Path $Dir 'home'
    $null = New-Item -ItemType Directory -Path $homeDir -Force

    $accepted = if ($Opts.ContainsKey('AcceptedStack')) { [bool]$Opts.AcceptedStack } else { $false }
    $statusObj = if ($accepted) {
        @{ deployments = @(@{ name = 'qwen3.8-27b'; state = 'active'; ok = $true }); last_run = @{ ok = $true; plan_id = 'plan-123'; state = 'completed' } }
    } else {
        @{ deployments = @(); last_run = $null }
    }
    [IO.File]::WriteAllText($statusPath, ($statusObj | ConvertTo-Json -Depth 5), $script:Utf8NoBom)

    $picks = if ($Opts.ContainsKey('Picks')) { $Opts.Picks } else {
        @(@{ role = 'smartest'; id = 'qwen3.8-27b'; quant = 'UD-Q4_K_M'; quality = 54; decode_tok_s = 109; decode_basis = 'estimated'; card = 0; shared = $false })
    }
    $isShared = @($picks | Where-Object { $_.shared }).Count -gt 0
    $cardEntry = @{ index = 0; name = 'NVIDIA GeForce RTX 4060 Ti'; held_by = @(); auto = (-not $isShared) }
    if ($isShared) { $cardEntry.held_by = @('python.exe') }
    $hwObj = @{
        system = 'Windows'
        arch = 'AMD64'
        cards = @($cardEntry)
        picks = $picks
    }
    [IO.File]::WriteAllText($hwPath, ($hwObj | ConvertTo-Json -Depth 6), $script:Utf8NoBom)

    $findings = if ($Opts.ContainsKey('Findings')) { $Opts.Findings } else { @() }
    $warnCount = @($findings | Where-Object { $_.level -eq 'warn' }).Count
    $failCount = @($findings | Where-Object { $_.level -eq 'fail' }).Count
    $planObj = @{
        plan_id = 'plan-abcdef123456'
        llm = @{ model = @{ id = 'qwen3.8-27b'; display_name = 'Qwen3.8 27B'; quant = 'UD-Q4_K_M' }; placement = @{ label = 'GPU 0' }; launch = @{ window = 131072 } }
        decision = @{ model = @{ id = 'startlux-0.8b'; display_name = 'startlux-0.8b' } }
        aux = @(@{ name = 'embed'; endpoint = @{ contract = 'embedding' }; model = @{ id = 'qwen3-embedding-0.6b'; display_name = 'qwen3-embedding-0.6b' } })
        budget = @{ download_bytes = 2147483648; disk_needed_bytes = 3221225472; ram_needed_bytes = 12884901888; ram_available_bytes = 32212254720 }
        preflight = @{ counts = @{ pass = 3; warn = $warnCount; fail = $failCount }; findings = $findings }
    }
    [IO.File]::WriteAllText($planPath, ($planObj | ConvertTo-Json -Depth 8), $script:Utf8NoBom)

    $bootErr = if ($Opts.ContainsKey('BootstrapError')) { [string]$Opts.BootstrapError } else { '' }
    $bootErrB64 = [Convert]::ToBase64String($script:Utf8NoBom.GetBytes($bootErr))
    $applyLines = if ($Opts.ContainsKey('ApplyLines')) { @($Opts.ApplyLines) } else { @('Applied plan plan-abcdef123456') }
    $applyArrStr = ($applyLines | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ', '
    $upNeedShare = if ($Opts.ContainsKey('UpFailsWithoutShareGpu') -and $Opts.UpFailsWithoutShareGpu) { '1' } else { '0' }
    $createPi = if (-not $Opts.ContainsKey('CreatePiOnApply') -or $Opts.CreatePiOnApply) { '1' } else { '0' }

    $codeTemplate = @'
$ErrorActionPreference = 'Stop'
Add-Content -LiteralPath '__LOG_PATH__' -Value ($args -join ' ')
if ($args.Count -ge 1 -and $args[0] -eq '--bootstrap-json') {
    $k = $env:LOCALMODELS_KIT_HOME
    Add-Content -LiteralPath '__KIT_LOG_PATH__' -Value $k
    $b64 = '__BOOT_ERR_B64__'
    if ($b64) {
        $msg = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
        [Console]::Error.WriteLine($msg)
        exit 2
    }
    Write-Output '{"schema":"localmodels.kit-location/v1","kitRoot":"ok"}'
    exit 0
}
$sub = if ($args.Count -ge 1) { $args[0] } else { '' }
switch ($sub) {
    'status' {
        if ($args -contains '--json') {
            Write-Output ([IO.File]::ReadAllText('__STATUS_PATH__'))
        } else {
            Write-Output 'qwen3.8-27b active'
            Write-Output 'Services down after a reboot? python -m localmodels stack up starts them without reinstalling'
        }
        exit 0
    }
    'hardware' {
        Write-Output ([IO.File]::ReadAllText('__HW_PATH__'))
        exit 0
    }
    'plan' {
        for ($j = 0; $j -lt $args.Count - 1; $j++) {
            if ($args[$j] -eq '--out') {
                Copy-Item -LiteralPath '__PLAN_PATH__' -Destination $args[$j + 1] -Force
            }
        }
        Write-Output ([IO.File]::ReadAllText('__PLAN_PATH__'))
        exit 0
    }
    'apply' {
        if ($args -contains '--plan') {
            [Console]::Error.WriteLine('unrecognized arguments: --plan')
            exit 2
        }
        foreach ($ln in @(__APPLY_ARR__)) {
            Write-Output $ln
        }
        if ('__CREATE_PI__' -eq '1') {
            $piDir = Join-Path '__HOME_DIR__' '.local\share\localmodels\tools\gateway-home\.pi\agent'
            $binDir = Join-Path '__HOME_DIR__' '.local\bin'
            $null = New-Item -ItemType Directory -Path $piDir -Force
            $null = New-Item -ItemType Directory -Path $binDir -Force
            [IO.File]::WriteAllText((Join-Path $piDir 'models.json'), '{}')
            [IO.File]::WriteAllText((Join-Path $binDir 'pi.cmd'), "@echo off`r`nexit /b 0`r`n")
        }
        exit 0
    }
    'up' {
        if ('__UP_NEED_SHARE__' -eq '1' -and -not ($args -contains '--share-gpu')) {
            [Console]::Error.WriteLine('stack: runtime failed to start')
            exit 3
        }
        Write-Output 'Local model stack is ready'
        exit 0
    }
    'remove' {
        if ($args -contains '--dry-run') {
            Write-Output 'Would delete cached weights via stack remove --purge'
        } elseif ($args -contains '--purge') {
            Write-Output 'Purged downloads. Run stack remove --purge if needed.'
        } else {
            Write-Output 'Removed. Run stack remove --purge to free downloaded files.'
        }
        exit 0
    }
    default {
        [Console]::Error.WriteLine("stack: unexpected subcommand $sub")
        exit 2
    }
}
'@
    $code = $codeTemplate.
        Replace('__LOG_PATH__', $logPath.Replace("'", "''")).
        Replace('__KIT_LOG_PATH__', $kitLogPath.Replace("'", "''")).
        Replace('__BOOT_ERR_B64__', $bootErrB64).
        Replace('__STATUS_PATH__', $statusPath.Replace("'", "''")).
        Replace('__HW_PATH__', $hwPath.Replace("'", "''")).
        Replace('__PLAN_PATH__', $planPath.Replace("'", "''")).
        Replace('__APPLY_ARR__', $applyArrStr).
        Replace('__CREATE_PI__', $createPi).
        Replace('__HOME_DIR__', $homeDir.Replace("'", "''")).
        Replace('__UP_NEED_SHARE__', $upNeedShare)
    [IO.File]::WriteAllText($stackPath, $code, $script:Utf8NoBom)
    return @{
        StackPath = $stackPath
        LogPath = $logPath
        KitLogPath = $kitLogPath
        HomeDir = $homeDir
    }
}

function Start-MockServer([string]$Dir, [bool]$Authorized = $false) {
    $compLog = Join-Path $Dir 'computer-calls.jsonl'
    $authLit = if ($Authorized) { 'true' } else { 'false' }
    $psTemplate = @'
$rec = @{
    argv = @($args)
    path = $env:PATH
    piAgentDir = $env:PI_CODING_AGENT_DIR
    systemRoot = $env:SystemRoot
    pathext = $env:PATHEXT
} | ConvertTo-Json -Compress
Add-Content -LiteralPath '__COMP_LOG__' -Value $rec
if ($args.Count -ge 2 -and $args[0] -eq 'auth' -and $args[1] -eq 'status') {
    if ($args -contains '--json') {
        Write-Output '{"version":1,"authorized":__AUTH_LIT__}'
    } else {
        Write-Output 'Authorized: __AUTH_LIT__'
    }
    exit 0
}
if ($args.Count -ge 2 -and $args[0] -eq 'daemon' -and $args[1] -eq 'status') {
    Write-Output 'Daemon: running'
    exit 0
}
exit 0
'@
    $psBody = $psTemplate.Replace('__COMP_LOG__', $compLog.Replace("'", "''")).Replace('__AUTH_LIT__', $authLit)
    $psB64 = [Convert]::ToBase64String($script:Utf8NoBom.GetBytes($psBody))
    $launcherTemplate = (@'
# LingerInstallerEmbedded = $true
$LingerInstallerEmbedded = $true
$web = $env:LINGER_WEB_URL
$uri = [Uri]$web
$h = $uri.Host.ToLowerInvariant()
$envName = if ($h -eq 'localhost' -or $h -eq '127.0.0.1') { 'local-' + $uri.Port } else { 'env-' + $uri.Port }
$bin = if ($env:LINGER_COMPUTER_BIN_DIR) { $env:LINGER_COMPUTER_BIN_DIR } else { Join-Path $env:LOCALAPPDATA 'Linger\bin' }
$null = New-Item -ItemType Directory -Path $bin -Force
$cmdFile = Join-Path $bin "linger-computer-$envName.cmd"
$psHelper = Join-Path $bin "linger-computer-$envName-mock.ps1"
$exe = (Get-Process -Id $PID).Path
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($psHelper, [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__PS_B64__')), $utf8)
[IO.File]::WriteAllText($cmdFile, "@echo off`r`n`"$exe`" -NoProfile -ExecutionPolicy Bypass -File `"$psHelper`" %*`r`n", $utf8)
exit 0
'@).Replace('__PS_B64__', $psB64)
    $srv = New-Object TestHttpMockServer($launcherTemplate)
    return @{ Server = $srv; LogPath = $compLog }
}

$baseParent = if ($WorkParent) { $WorkParent } else { [IO.Path]::GetTempPath() }
if (-not (Test-Path -LiteralPath $baseParent)) { $null = New-Item -ItemType Directory -Path $baseParent -Force }
$workRoot = Join-Path $baseParent ("linger-ps-branches-" + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $workRoot -Force

try {
    Write-Host "Running install.ps1 branch suite on $($script:CurrentExe) (PS $($PSVersionTable.PSVersion))..."

    # 1. AST parse
    $tokens = $null
    $errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile($InstallScriptPath, [ref]$tokens, [ref]$errors)
    Assert-Equal $errors.Count 0 "AST parse errors: $($errors | Out-String)"

    # 2. CLI flags, conflicts, elevation & standalone
    $d1 = Join-Path $workRoot 't1'
    $f1 = New-FakeStack $d1
    $env1 = @{ USERPROFILE = $f1.HomeDir; HOME = $f1.HomeDir; LOCALAPPDATA = (Join-Path $d1 'localapp'); LINGER_STACK_SCRIPT = $f1.StackPath; LINGER_INSTALL_TEST_ELEVATED = '0' }

    $rHelp = Invoke-Script @('--help') $env1
    Assert-Exit $rHelp 0 '--help exit code'
    Assert-Contains $rHelp.StdOut '--web-url' 'help --web-url'
    Assert-Contains $rHelp.StdOut '--connect' 'help --connect'
    Assert-Contains $rHelp.StdOut '--remove' 'help --remove'
    Assert-NotContains $rHelp.StdOut 'stack.ps1' 'help sanitized stack.ps1'
    Assert-NotContains $rHelp.StdOut 'PI_CODING_AGENT_DIR' 'help sanitized PI_CODING_AGENT_DIR'

    $rShort = Invoke-Script @('-h') $env1
    Assert-Exit $rShort 0 '-h exit code'

    $rBogus = Invoke-Script @('--bogus') $env1
    Assert-Exit $rBogus 1 '--bogus exit'
    Assert-Contains $rBogus.StdErr 'Unknown option: --bogus' '--bogus msg'

    $rConf1 = Invoke-Script @('--connect', '--up') $env1
    Assert-Exit $rConf1 1 '--connect --up'
    Assert-Contains $rConf1.StdErr 'Options --connect and --up cannot be combined' 'conflict1'

    $rConf2 = Invoke-Script @('--status', '--remove') $env1
    Assert-Exit $rConf2 1 '--status --remove'
    Assert-Contains $rConf2.StdErr 'Options --status and --remove cannot be combined' 'conflict2'

    $rPurgeOnly = Invoke-Script @('--purge') $env1
    Assert-Exit $rPurgeOnly 1 '--purge alone'
    Assert-Contains $rPurgeOnly.StdErr 'Option --purge requires --remove' 'purge requires remove'

    $rMissUrl = Invoke-Script @('--web-url') $env1
    Assert-Exit $rMissUrl 1 'missing url'
    Assert-Contains $rMissUrl.StdErr '--web-url requires an origin URL' 'missing url msg'

    $rBadUrl = Invoke-Script @('--web-url=not-an-origin') $env1
    Assert-Exit $rBadUrl 1 'bad url'
    Assert-Contains $rBadUrl.StdErr 'Invalid Linger server URL' 'bad url msg'

    $standaloneDir = Join-Path $d1 'standalone'
    $null = New-Item -ItemType Directory -Path $standaloneDir -Force
    $copiedStandalone = Join-Path $standaloneDir 'install.ps1'
    Copy-Item -LiteralPath $InstallScriptPath -Destination $copiedStandalone
    $rSaHelp = Invoke-Script @('--help') $env1 '' $copiedStandalone $standaloneDir
    Assert-Contains $rSaHelp.StdOut 'Usage: .\install.ps1' 'standalone usage'
    $rSaBad = Invoke-Script @('--web-url', 'http://127.0.0.1:9') $env1 "9`n" $copiedStandalone $standaloneDir
    Assert-Exit $rSaBad 1 'standalone bad choice'
    Assert-NotContains $rSaBad.StdOut 'Docker Compose' 'standalone hides compose'
    Assert-Contains $rSaBad.StdErr 'Invalid choice: 9' 'standalone invalid choice'

    # Elevation guards (test hook in any session, plus real token check when the host shell itself is elevated)
    $rHookElevConn = Invoke-Script @('--connect', '--web-url', 'http://127.0.0.1:9') @{ USERPROFILE = $f1.HomeDir; HOME = $f1.HomeDir; LOCALAPPDATA = (Join-Path $d1 'localapp'); LINGER_STACK_SCRIPT = $f1.StackPath; LINGER_INSTALL_TEST_ELEVATED = '1' }
    Assert-Exit $rHookElevConn 1 'elevated hook rejected on --connect'
    Assert-Contains $rHookElevConn.StdErr 'non-elevated PowerShell' 'elevated hook --connect message'

    $idNow = [Security.Principal.WindowsIdentity]::GetCurrent()
    $isHostElev = (New-Object Security.Principal.WindowsPrincipal($idNow)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($isHostElev) {
        $rRealElev = Invoke-Script @('--connect', '--web-url', 'http://127.0.0.1:9') @{ USERPROFILE = $f1.HomeDir; HOME = $f1.HomeDir; LOCALAPPDATA = (Join-Path $d1 'localapp'); LINGER_STACK_SCRIPT = $f1.StackPath; LINGER_INSTALL_TEST_ELEVATED = $null }
        Assert-Exit $rRealElev 1 'real elevated token rejected on --connect'
        Assert-Contains $rRealElev.StdErr 'non-elevated PowerShell' 'real elevated message'
    }

    $rElevGuideCancel = Invoke-Script @('--web-url', 'http://127.0.0.1:9') @{ USERPROFILE = $f1.HomeDir; HOME = $f1.HomeDir; LOCALAPPDATA = (Join-Path $d1 'localapp'); LINGER_STACK_SCRIPT = $f1.StackPath; LINGER_INSTALL_TEST_ELEVATED = '1' } "n`n"
    Assert-Exit $rElevGuideCancel 0 'elevated guide cancel exit 0'
    Assert-Contains $rElevGuideCancel.StdOut 'running as Administrator' 'elevated warning printed'
    Assert-Contains $rElevGuideCancel.StdOut 'Installation cancelled.' 'elevated guide cancelled'

    # 3. ACL fallback (junction in LOCALAPPDATA -> falls back to .linger\localmodels\kits; junction in USERPROFILE -> temp dir)
    $dAcl = Join-Path $workRoot 't-acl'
    $fAcl = New-FakeStack $dAcl
    $jTarget = Join-Path $dAcl 'jtarget'
    $jLocal = Join-Path $dAcl 'localapp-junction'
    $jHome = Join-Path $dAcl 'home-junction'
    $null = New-Item -ItemType Directory -Path $jTarget -Force
    cmd /c mklink /J "$jLocal" "$jTarget" | Out-Null
    cmd /c mklink /J "$jHome" "$jTarget" | Out-Null

    $rAcl1 = Invoke-Script @('--status') @{ USERPROFILE = $fAcl.HomeDir; HOME = $fAcl.HomeDir; LOCALAPPDATA = $jLocal; LINGER_STACK_SCRIPT = $fAcl.StackPath }
    Assert-Exit $rAcl1 0 'acl fallback to .linger'
    $kLogged1 = @(Get-Content -LiteralPath $fAcl.KitLogPath)
    Assert-Equal $kLogged1[0] (Join-Path $fAcl.HomeDir '.linger\localmodels\kits') 'fallback 1 uses .linger'

    $privTmp = Join-Path $dAcl 'priv-tmp'
    $null = New-Item -ItemType Directory -Path $privTmp -Force
    $rAcl2 = Invoke-Script @('--status') @{ USERPROFILE = $jHome; HOME = $jHome; LOCALAPPDATA = $jLocal; TEMP = $privTmp; TMP = $privTmp; LINGER_STACK_SCRIPT = $fAcl.StackPath }
    Assert-Exit $rAcl2 0 'acl fallback to temp'
    $kLogged2 = @(Get-Content -LiteralPath $fAcl.KitLogPath)
    Assert-True ($kLogged2[1].StartsWith((Join-Path $privTmp 'linger-kit.'))) 'fallback 2 uses private temp'

    # Non-ACL bootstrap error sanitization
    $dBoot = Join-Path $workRoot 't-boot'
    $fBoot = New-FakeStack $dBoot @{ BootstrapError = "stack: GPU service owners unknown`nstack.ps1: internal failure" }
    $rBoot = Invoke-Script @('--status') @{ USERPROFILE = $fBoot.HomeDir; HOME = $fBoot.HomeDir; LOCALAPPDATA = (Join-Path $dBoot 'la'); LINGER_STACK_SCRIPT = $fBoot.StackPath }
    Assert-Exit $rBoot 1 'bootstrap err exit 1'
    Assert-Contains $rBoot.StdErr 'install.ps1: GPU service owners unknown' 'sanitized stack:'
    Assert-Contains $rBoot.StdErr 'install.ps1: internal failure' 'sanitized stack.ps1:'
    Assert-NotContains $rBoot.StdErr 'stack.ps1' 'no stack.ps1 leak'

    # 4. Compose port remapping, semicolon COMPOSE_FILE, owner retry, explicit URL reset
    $dComp = Join-Path $workRoot 't-compose'
    $fComp = New-FakeStack $dComp
    $fakeRepo = Join-Path $dComp 'repo'
    $fakeBin = Join-Path $dComp 'fakebin'
    $null = New-Item -ItemType Directory -Path (Join-Path $fakeRepo 'scripts\install') -Force
    $null = New-Item -ItemType Directory -Path (Join-Path $fakeRepo 'scripts\installs') -Force
    $null = New-Item -ItemType Directory -Path $fakeBin -Force
    $copiedCompInstall = Join-Path $fakeRepo 'scripts\install\install.ps1'
    Copy-Item -LiteralPath $InstallScriptPath -Destination $copiedCompInstall
    Copy-Item -LiteralPath $fComp.StackPath -Destination (Join-Path $fakeRepo 'scripts\installs\stack.ps1')
    [IO.File]::WriteAllText((Join-Path $fakeRepo 'docker-compose.yml'), "services:`n  web:`n", $script:Utf8NoBom)
    [IO.File]::WriteAllText((Join-Path $fakeRepo '.env.example'), "WEB_PUBLIC_ORIGIN=http://localhost:3000`nLIVEKIT_URL=ws://127.0.0.1:17880`n# WEB_HTTP_PORT=3000`n", $script:Utf8NoBom)

    $mComp = Start-MockServer $dComp $false
    try {
        $mockPort = ([Uri]$mComp.Server.BaseUrl).Port
        $dockerLog = Join-Path $dComp 'docker.log'
        $teamhubLog = Join-Path $dComp 'teamhub.log'
        $dockerPs1 = Join-Path $dComp 'fake-docker.ps1'
        $dockerPsCode = @"
Add-Content -LiteralPath '$dockerLog' -Value (`$args -join ' ')
if (`$args.Count -ge 2 -and `$args[0] -eq 'compose' -and `$args[1] -eq 'version') { Write-Output 'Docker Compose version v2.40.2'; exit 0 }
if (`$args.Count -ge 2 -and `$args[0] -eq 'compose' -and `$args[1] -eq 'ps') { Write-Output '127.0.0.1:5432->5432/tcp'; exit 0 }
if (`$args.Count -ge 2 -and `$args[0] -eq 'compose' -and `$args[1] -eq 'exec') {
    `$stdinVal = [Console]::In.ReadToEnd()
    [IO.File]::WriteAllText('$teamhubLog', `$stdinVal.Trim(), (New-Object Text.UTF8Encoding(`$false)))
    if (`$env:FAKE_OWNER_FAIL -eq '1') { exit 1 }
    exit 0
}
exit 0
"@
        [IO.File]::WriteAllText($dockerPs1, $dockerPsCode, $script:Utf8NoBom)
        [IO.File]::WriteAllText((Join-Path $fakeBin 'docker.cmd'), "@echo off`r`n`"$($script:CurrentExe)`" -NoProfile -ExecutionPolicy Bypass -File `"$dockerPs1`" %*`r`n", $script:Utf8NoBom)

        $envComp = @{
            USERPROFILE = $fComp.HomeDir
            HOME = $fComp.HomeDir
            LOCALAPPDATA = (Join-Path $dComp 'la')
            PATH = "$fakeBin;$env:PATH"
            LINGER_INSTALL_TEST_ELEVATED = '0'
            LINGER_INSTALL_BUSY_PORTS = '3000,17880,7881,7882'
        }

        $rDecline = Invoke-Script @('--web-url', 'http://127.0.0.1:9') $envComp "1`nn`n" $copiedCompInstall $fakeRepo
        Assert-Exit $rDecline 1 'decline port remap'
        Assert-Contains $rDecline.StdErr 'Free those ports' 'decline port message'

        [IO.File]::WriteAllText((Join-Path $fakeRepo '.env'), "WEB_PUBLIC_ORIGIN=$($mComp.Server.BaseUrl)`nWEB_HTTP_PORT=$mockPort`nLIVEKIT_URL=ws://127.0.0.1:17880`n", $script:Utf8NoBom)
        $envCompFail = $envComp.Clone()
        $envCompFail['LINGER_INSTALL_BUSY_PORTS'] = '17880,7881,7882'
        $envCompFail['FAKE_OWNER_FAIL'] = '1'
        $rRemap = Invoke-Script @('--web-url', 'http://127.0.0.1:9') $envCompFail "1`ny`ny`n`nshort`n`nn`nn`n" $copiedCompInstall $fakeRepo
        Assert-Exit $rRemap 0 'compose remap + decline download'
        Assert-Contains $rRemap.StdOut 'Port(s) already in use: 17880, 7881, 7882' 'busy ports listed'
        Assert-Contains $rRemap.StdOut 'Password must be at least 8 characters' 'short password warning'
        Assert-Contains $rRemap.StdOut 'Could not create owner account' 'owner create fail msg'
        Assert-Contains $rRemap.StdOut "Linger server is ready at $($mComp.Server.BaseUrl)" 'reset explicit url to compose origin'

        $envTxt = [IO.File]::ReadAllText((Join-Path $fakeRepo '.env'), $script:Utf8NoBom)
        $envBytes = [IO.File]::ReadAllBytes((Join-Path $fakeRepo '.env'))
        Assert-True (-not ($envBytes.Length -ge 3 -and $envBytes[0] -eq 0xEF -and $envBytes[1] -eq 0xBB -and $envBytes[2] -eq 0xBF)) '.env has no UTF-8 BOM'
        Assert-Contains $envTxt 'COMPOSE_FILE=docker-compose.yml;.local/compose.ports.yml' 'semicolon COMPOSE_FILE on Windows'
        $ymlTxt = [IO.File]::ReadAllText((Join-Path $fakeRepo '.local\compose.ports.yml'), $script:Utf8NoBom)
        Assert-Contains $ymlTxt 'entrypoint: /livekit-server --rtc.tcp_port 7883 --udp-port 7884' 'livekit entrypoint flags'
        Assert-Contains $ymlTxt 'ports: !override' 'override tag'
        Assert-Contains $ymlTxt '127.0.0.1:17881:7880' 'livekit http remap'
        Assert-Contains $ymlTxt '7883:7883' 'livekit tcp remap'
        Assert-Contains $ymlTxt '7884:7884/udp' 'livekit udp remap'

        # Verify owner default password 'test1234' arrives via stdin when owner succeeds
        $envCompOk = $envComp.Clone()
        $envCompOk['LINGER_INSTALL_BUSY_PORTS'] = ''
        $rOwnerOk = Invoke-Script @('--web-url', 'http://127.0.0.1:9') $envCompOk "1`ny`n`n`nn`nn`n" $copiedCompInstall $fakeRepo
        Assert-Exit $rOwnerOk 0 'owner success flow'
        Assert-Contains $rOwnerOk.StdOut 'Reminder: change the default password in Settings -> Security.' 'default owner password reminder'
        Assert-Equal ([IO.File]::ReadAllText($teamhubLog, $script:Utf8NoBom).Trim()) 'test1234' 'default owner password sent'

        # Custom URL, force unreachable, Choice 3 local-only, LINGER_WEB_URL
        $rCustom = Invoke-Script @('--web-url', 'http://127.0.0.1:9') $envCompOk "2`nnot-a-url`nhttp://127.0.0.1:9`nn`n$($mComp.Server.BaseUrl)`nn`nn`n" $copiedCompInstall $fakeRepo
        Assert-Exit $rCustom 0 'custom url retry'
        Assert-Contains $rCustom.StdOut 'Invalid URL' 'invalid url prompt'
        Assert-Contains $rCustom.StdOut "Found Linger server at $($mComp.Server.BaseUrl)" 'found server after retry'

        $rForce = Invoke-Script @('--web-url', 'http://127.0.0.1:9') $envCompOk "2`nhttp://127.0.0.1:8`ny`nn`nn`n" $copiedCompInstall $fakeRepo
        Assert-Exit $rForce 0 'force unreachable url'

        $rChoice3 = Invoke-Script @('--web-url', 'http://127.0.0.1:9') $envCompOk "3`nn`ny`n" $copiedCompInstall $fakeRepo
        Assert-Exit $rChoice3 0 'choice 3 local only'
        Assert-Contains $rChoice3.StdOut 'Continuing with local models only.' 'choice 3 note'
        Assert-Contains $rChoice3.StdOut '--connect --web-url' 'reconnect hint'
    } finally {
        $mComp.Server.Dispose()
    }

    # 5. Model selection, multi-pick, share GPU, mem cap, preflight fail, live apply + connect
    $dZero = Join-Path $workRoot 't-zero'
    $fZero = New-FakeStack $dZero @{ Picks = @() }
    $mZero = Start-MockServer $dZero $false
    try {
        $rZero = Invoke-Script @('--web-url', $mZero.Server.BaseUrl) @{ USERPROFILE = $fZero.HomeDir; HOME = $fZero.HomeDir; LOCALAPPDATA = (Join-Path $dZero 'la'); LINGER_STACK_SCRIPT = $fZero.StackPath; LINGER_INSTALL_TEST_ELEVATED = '0' }
        Assert-Exit $rZero 1 'zero picks exits 1'
        Assert-Contains $rZero.StdErr 'No supported local model fits' 'zero picks msg'
    } finally {
        $mZero.Server.Dispose()
    }

    $dPre = Join-Path $workRoot 't-preflight'
    $multiPicks = @(
        @{ role = 'smartest'; id = 'qwen3.8-27b'; quant = 'UD-Q4_K_M'; quality = 54; decode_tok_s = 109; decode_basis = 'estimated'; card = 0; shared = $true },
        @{ role = 'fastest'; id = 'qwen3.6-35b-a3b'; quant = 'UD-IQ4_XS'; quality = 35; decode_tok_s = 656; decode_basis = 'measured-decode'; card = 0; shared = $true }
    )
    $findings = @(
        @{ check = 'preflight.gpu'; level = 'warn'; detail = '2 compute process(es) outside the stack on its GPU' },
        @{ check = 'preflight.running'; level = 'warn'; detail = 'this tool still runs 1 deployment'; fix = "stop with 'stack service local foo stop'" },
        @{ check = 'preflight.disk'; level = 'fail'; detail = 'Insufficient disk via stack.ps1'; fix = 'Free space and rerun stack plan or plan another --llm-port' }
    )
    $fPre = New-FakeStack $dPre @{ Picks = $multiPicks; Findings = $findings }
    $mPre = Start-MockServer $dPre $false
    try {
        $envPre = @{ USERPROFILE = $fPre.HomeDir; HOME = $fPre.HomeDir; LOCALAPPDATA = (Join-Path $dPre 'la'); LINGER_STACK_SCRIPT = $fPre.StackPath; LINGER_INSTALL_TEST_ELEVATED = '0' }
        $rBadPick = Invoke-Script @('--web-url', $mPre.Server.BaseUrl) $envPre "9`n"
        Assert-Exit $rBadPick 1 'bad model pick'
        Assert-Contains $rBadPick.StdErr 'Invalid choice: 9' 'bad model pick msg'

        $rGpuNo = Invoke-Script @('--web-url', $mPre.Server.BaseUrl) $envPre "1`nn`n"
        Assert-Exit $rGpuNo 0 'decline gpu share'
        Assert-Contains $rGpuNo.StdOut 'Installation cancelled.' 'decline gpu share msg'

        $rPrefail = Invoke-Script @('--web-url', $mPre.Server.BaseUrl) $envPre "2`ny`nbadcap`n24G`ny`n"
        Assert-Exit $rPrefail 1 'preflight fail exit 1'
        Assert-Contains $rPrefail.StdOut 'Please enter a size like 24G or 16384M' 'bad mem cap prompt'
        Assert-NotContains $rPrefail.StdOut '2 compute process(es) outside' 'preflight.gpu suppressed'
        Assert-Contains $rPrefail.StdOut 'kept untouched on separate ports' 'preflight.running summarized'
        Assert-NotContains $rPrefail.StdOut 'stack.ps1' 'sanitized stack.ps1'
        Assert-NotContains $rPrefail.StdOut '--llm-port' 'sanitized --llm-port'
        Assert-Contains $rPrefail.StdErr 'Preflight checks failed' 'preflight fail msg'
        $planLog = @(Get-Content -LiteralPath $fPre.LogPath | Where-Object { $_.StartsWith('plan ') })[-1]
        Assert-Contains $planLog '--prefer fastest' 'fastest picked'
        Assert-Contains $planLog '--gpu 0 --share-gpu --gpu-memory 24G' 'gpu memory cap passed'
        Assert-Contains $planLog '--decision auto --aux embedding,reranker' 'helpers passed'
        Assert-NotContains $planLog 'search' 'plan passes no search option'
    } finally {
        $mPre.Server.Dispose()
    }

    $dFull = Join-Path $workRoot 't-full'
    $fFull = New-FakeStack $dFull @{ ApplyLines = @('stack: starting backend via stack.ps1', 'Applied plan plan-abcdef123456') }
    $mFull = Start-MockServer $dFull $false
    try {
        $envFull = @{
            USERPROFILE = $fFull.HomeDir
            HOME = $fFull.HomeDir
            LOCALAPPDATA = (Join-Path $dFull 'la')
            LINGER_COMPUTER_BIN_DIR = (Join-Path $dFull 'cbin')
            LINGER_STACK_SCRIPT = $fFull.StackPath
            LINGER_INSTALL_TEST_ELEVATED = '0'
        }
        $rFull = Invoke-Script @('--web-url', $mFull.Server.BaseUrl) $envFull "n`ny`n"
        Assert-Exit $rFull 0 'full flow exit 0'
        Assert-Contains $rFull.StdOut '[4/4] Connecting this computer to Linger' 'step 4 header'
        Assert-Contains $rFull.StdOut 'Done.' 'done printed'
        Assert-NotContains $rFull.StdOut 'stack.ps1' 'apply sanitized stack.ps1'
        Assert-NotContains $rFull.StdOut 'stack:' 'apply sanitized stack:'
        $applyLogged = @(Get-Content -LiteralPath $fFull.LogPath | Where-Object { $_.StartsWith('apply ') })[-1]
        Assert-NotContains $applyLogged '--plan' 'apply uses positional plan file'
        Assert-Contains $applyLogged '--approve plan-abcdef123456' 'apply passes --approve'
        $compCalls = @(Get-Content -LiteralPath $mFull.LogPath | ForEach-Object { $_ | ConvertFrom-Json })
        Assert-Equal $compCalls.Count 3 '3 computer calls'
        Assert-Equal ($compCalls[0].argv -join ' ') 'auth status --json' 'call 0'
        Assert-Equal ($compCalls[1].argv[0..1] -join ' ') 'login --web-url' 'call 1'
        Assert-Equal ($compCalls[2].argv[0..2] -join ' ') 'runtime check pi' 'call 2'
        Assert-Contains $compCalls[1].argv[4] 'pi.cmd' 'pi.cmd passed'
        Assert-True ([bool]$compCalls[1].piAgentDir) 'PI_CODING_AGENT_DIR passed'
        Assert-True ([bool]$compCalls[1].systemRoot) 'SystemRoot preserved'
        Assert-True ([bool]$compCalls[1].pathext) 'PATHEXT preserved'
    } finally {
        $mFull.Server.Dispose()
    }

    # 6. Reuse accepted stack (up --share-gpu retry), --update, --connect, --status, --up, --remove/--purge
    $dDay2 = Join-Path $workRoot 't-day2'
    $fDay2 = New-FakeStack $dDay2 @{ AcceptedStack = $true; UpFailsWithoutShareGpu = $true }
    $piDir2 = Join-Path $fDay2.HomeDir '.local\share\localmodels\tools\gateway-home\.pi\agent'
    $binDir2 = Join-Path $fDay2.HomeDir '.local\bin'
    $null = New-Item -ItemType Directory -Path $piDir2 -Force
    $null = New-Item -ItemType Directory -Path $binDir2 -Force
    [IO.File]::WriteAllText((Join-Path $piDir2 'models.json'), '{}', $script:Utf8NoBom)
    [IO.File]::WriteAllText((Join-Path $binDir2 'pi.cmd'), "@echo off`r`nexit /b 0`r`n", $script:Utf8NoBom)
    $mDay2 = Start-MockServer $dDay2 $true
    try {
        $envDay2 = @{
            USERPROFILE = $fDay2.HomeDir
            HOME = $fDay2.HomeDir
            LOCALAPPDATA = (Join-Path $dDay2 'la')
            LINGER_COMPUTER_BIN_DIR = (Join-Path $dDay2 'cbin')
            LINGER_STACK_SCRIPT = $fDay2.StackPath
            LINGER_INSTALL_TEST_ELEVATED = '0'
        }
        $rReuseNo = Invoke-Script @('--web-url', $mDay2.Server.BaseUrl) $envDay2 "1`nn`n"
        Assert-Exit $rReuseNo 3 'reuse share decline preserves up exit code'
        Assert-Contains $rReuseNo.StdOut 'Installation cancelled.' 'reuse share decline msg'

        $rReuse = Invoke-Script @('--web-url', $mDay2.Server.BaseUrl) $envDay2 "1`ny`n"
        Assert-Exit $rReuse 0 'reuse share retry exit 0'
        Assert-Contains $rReuse.StdOut 'Retry starting while sharing GPU' 'reuse share retry prompt'
        $callsDay2 = @(Get-Content -LiteralPath $mDay2.LogPath | ForEach-Object { $_ | ConvertFrom-Json })
        Assert-Equal ($callsDay2[1].argv[0..1] -join ' ') 'daemon restart' 'authorized triggers daemon restart'

        $rReplan = Invoke-Script @('--web-url', $mDay2.Server.BaseUrl) $envDay2 "2`nn`nn`n"
        Assert-Exit $rReplan 0 'replan exit 0'
        $planUpdate = @(Get-Content -LiteralPath $fDay2.LogPath | Where-Object { $_.StartsWith('plan ') })[-1]
        Assert-Contains $planUpdate '--update' 'replan passes --update'

        $rConnSkip = Invoke-Script @('--connect', '--web-url', 'http://127.0.0.1:9') $envDay2 "skip`n"
        Assert-Exit $rConnSkip 0 'connect skip'
        Assert-Contains $rConnSkip.StdOut 'Continuing with local models only.' 'connect skip msg'

        $rConnLive = Invoke-Script @('--connect', '--web-url', $mDay2.Server.BaseUrl) $envDay2
        Assert-Exit $rConnLive 0 'connect live'

        $rStatus = Invoke-Script @('--status', '--web-url', $mDay2.Server.BaseUrl) $envDay2
        Assert-Exit $rStatus 0 'status exit 0'
        Assert-Contains $rStatus.StdOut '--up' 'status sanitizes up hint'
        Assert-NotContains $rStatus.StdOut 'localmodels' 'status hides localmodels'
        Assert-Contains $rStatus.StdOut 'Daemon: running' 'status checks daemon'

        $rUp = Invoke-Script @('--up', '--web-url', $mDay2.Server.BaseUrl) $envDay2 "y`n"
        Assert-Exit $rUp 0 '--up exit 0'
        Assert-Contains $rUp.StdOut 'Local model stack is ready' '--up ready msg'

        $rRmKeep = Invoke-Script @('--remove') $envDay2
        Assert-Exit $rRmKeep 0 '--remove keep'
        Assert-NotContains $rRmKeep.StdOut 'stack remove' '--remove sanitizes stack remove'
        Assert-Contains $rRmKeep.StdOut '--remove --purge' 'shows purge cmd'

        $rPurgeCancel = Invoke-Script @('--remove', '--purge') $envDay2 "n`n"
        Assert-Exit $rPurgeCancel 0 'purge cancel'
        Assert-Contains $rPurgeCancel.StdOut 'Nothing deleted.' 'purge cancel msg'

        $rPurgeOk = Invoke-Script @('--remove', '--purge') $envDay2 "y`n"
        Assert-Exit $rPurgeOk 0 'purge confirm'

        $rPurgeYes = Invoke-Script @('--remove', '--purge', '--yes') $envDay2
        Assert-Exit $rPurgeYes 0 'purge --yes'
    } finally {
        $mDay2.Server.Dispose()
    }

    # 7. Standalone @simplexai/localmodels tarball download, SHA-256 verification & tamper rejection
    $dPkg = Join-Path $workRoot 't-pkg'
    $hPkg = Join-Path $dPkg 'home'
    $laPkg = Join-Path $dPkg 'la'
    $saPkgDir = Join-Path $dPkg 'standalone'
    foreach ($dirToMake in @($hPkg, $laPkg, $saPkgDir)) {
        $null = New-Item -ItemType Directory -Path $dirToMake -Force
    }
    $saPs1 = Join-Path $saPkgDir 'install.ps1'
    Copy-Item -LiteralPath $InstallScriptPath -Destination $saPs1 -Force
    $ps1Raw = [IO.File]::ReadAllText($saPs1, $script:Utf8NoBom)
    $npmMatch = [regex]::Match($ps1Raw, '\$script:StackPinNpmVersion = ''([^'']+)''')
    Assert-True $npmMatch.Success 'install.ps1 declares StackPinNpmVersion'
    $npmPinVer = $npmMatch.Groups[1].Value
    $tarUrlPath = "/@simplexai/localmodels/-/localmodels-$npmPinVer.tgz"

    $badStackBytes = $script:Utf8NoBom.GetBytes("Write-Output 'tampered'`n")
    [byte[]]$badTgz = New-SingleFileTgzBytes 'package/stack.ps1' $badStackBytes
    $srvBad = New-Object TestNpmTgzServer($tarUrlPath, $badTgz)
    try {
        $envBad = @{
            USERPROFILE = $hPkg
            HOME = $hPkg
            LOCALAPPDATA = $laPkg
            LINGER_STACK_SCRIPT = $null
            LINGER_STACK_URL = $null
            SIMPLEX_NPM_REGISTRY = $srvBad.BaseUrl
            LINGER_INSTALL_TEST_ELEVATED = '0'
        }
        $rTampered = Invoke-Script @('--status') $envBad '' $saPs1 $saPkgDir
        Assert-Exit $rTampered 1 'tampered npm tgz rejected'
        Assert-Contains $rTampered.StdErr 'Local model runtime bootstrap checksum mismatch.' 'tampered checksum message'
    } finally {
        $srvBad.Dispose()
    }

    $fakeStackBody = @'
if ($args.Count -ge 1 -and $args[0] -eq '--bootstrap-json') {
    Write-Output '{"schema":"localmodels.kit-location/v1","python":"ok"}'
    exit 0
}
if ($args.Count -ge 1 -and $args[0] -eq 'status') {
    Write-Output 'qwen3.8-27b active'
    exit 0
}
exit 0
'@
    $goodStackBytes = $script:Utf8NoBom.GetBytes($fakeStackBody)
    $shaAlg = [Security.Cryptography.SHA256]::Create()
    try {
        $goodSha = ([BitConverter]::ToString($shaAlg.ComputeHash($goodStackBytes)) -replace '-', '').ToLowerInvariant()
    } finally {
        $shaAlg.Dispose()
    }
    $pinnedSaPs1 = Join-Path $saPkgDir 'install-pinned.ps1'
    $pinShaMatch = [regex]::Match($ps1Raw, '\$script:StackPinSha256 = ''[a-f0-9]+''')
    Assert-True $pinShaMatch.Success 'install.ps1 declares StackPinSha256'
    $patchedPs1 = $ps1Raw.Replace($pinShaMatch.Value, ('$script:StackPinSha256 = ''' + $goodSha + ''''))
    [IO.File]::WriteAllText($pinnedSaPs1, $patchedPs1, $script:Utf8NoBom)
    [byte[]]$goodTgz = New-SingleFileTgzBytes 'package/stack.ps1' $goodStackBytes
    $srvGood = New-Object TestNpmTgzServer($tarUrlPath, $goodTgz)
    try {
        $envGood = @{
            USERPROFILE = $hPkg
            HOME = $hPkg
            LOCALAPPDATA = $laPkg
            LINGER_STACK_SCRIPT = $null
            LINGER_STACK_URL = $null
            SIMPLEX_NPM_REGISTRY = $srvGood.BaseUrl
            LINGER_INSTALL_TEST_ELEVATED = '0'
        }
        $rGood = Invoke-Script @('--status') $envGood '' $pinnedSaPs1 $saPkgDir
        Assert-Exit $rGood 0 'verified npm tgz executes status'
        Assert-Contains $rGood.StdOut 'qwen3.8-27b active' 'verified npm tgz status output'
    } finally {
        $srvGood.Dispose()
    }

    Write-Host "ALL $($script:Assertions) ASSERTIONS PASSED under $($script:CurrentExe)!"
} finally {
    Remove-TreeClean $workRoot
}
