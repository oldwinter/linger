param(
  [Parameter(Mandatory)][string]$Setup,
  [Parameter(Mandatory)][string]$ExpectedSha256,
  [string]$WorkerAccount
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = [Security.Principal.WindowsPrincipal]::new($identity).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)

if ($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$' -or
    (Get-FileHash -LiteralPath $Setup -Algorithm SHA256).Hash -ne $ExpectedSha256) {
  throw 'Setup SHA-256 does not match the build digest'
}

if ($WorkerAccount) {
  if ($isAdmin -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
    throw 'The package smoke requires an ordinary Windows x64 user'
  }
  if ($identity.Name -ne $WorkerAccount -or
      !(Test-Path -LiteralPath ("Registry::HKEY_USERS\" + $identity.User.Value)) -or
      (Get-Item -LiteralPath $env:USERPROFILE).Name -notlike "$($WorkerAccount.Split('\')[-1])*" -or
      !$env:LOCALAPPDATA.StartsWith("$env:USERPROFILE\", [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The smoke user does not have its own loaded profile'
  }
  $app = Join-Path $env:LOCALAPPDATA 'Programs\Linger'
  if (Test-Path -LiteralPath $app) { throw 'The smoke profile is not clean' }
  $setupWatch = [Diagnostics.Stopwatch]::StartNew()
  $install = Start-Process -FilePath $Setup -ArgumentList '/S' -PassThru
  if (!$install.WaitForExit(180000)) {
    Stop-Process -Id $install.Id -Force
    throw 'Silent Setup timed out'
  }
  if ($install.ExitCode -ne 0) { throw "Silent Setup failed: $($install.ExitCode)" }
  @{ phase = 'setup'; setup_sha256 = $ExpectedSha256; elapsed_ms = $setupWatch.ElapsedMilliseconds } |
    ConvertTo-Json -Compress
  $env:ELECTRON_RUN_AS_NODE = '1'
  $env:LINGER_HOME = Join-Path $env:LOCALAPPDATA 'LingerPackageSmoke'
  Remove-Item Env:NODE_PATH,Env:NODE_OPTIONS -ErrorAction SilentlyContinue
  & (Join-Path $app 'Linger.exe') (Join-Path $PSScriptRoot 'windows-pi-smoke.mjs') | Out-Host
  exit $LASTEXITCODE
}

if (!$isAdmin) { throw 'Run the orchestrator on a disposable elevated Windows x64 runner' }
$name = 'LingerSmoke' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$scratch = Join-Path $env:ProgramData $name
$password = ConvertTo-SecureString ('Aa9!' + [Guid]::NewGuid().ToString('N')) -AsPlainText -Force
$account = New-LocalUser -Name $name -Password $password
$workerProcess = $null
try {
  New-Item -ItemType Directory -Path $scratch | Out-Null
  & icacls.exe $scratch /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' "*$($account.SID.Value):(OI)(CI)RX" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not isolate the smoke staging directory' }
  Copy-Item -LiteralPath $PSCommandPath,(Join-Path $PSScriptRoot 'windows-pi-smoke.mjs') -Destination $scratch
  $candidate = Join-Path $scratch 'Setup.exe'
  Copy-Item -LiteralPath $Setup -Destination $candidate
  $stdout = Join-Path $scratch 'stdout.log'
  $stderr = Join-Path $scratch 'stderr.log'
  $credentials = [pscredential]::new("$env:COMPUTERNAME\$name", $password)
  $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$scratch\windows-desktop-smoke.ps1`" -WorkerAccount `"$($credentials.UserName)`" -Setup `"$candidate`" -ExpectedSha256 $ExpectedSha256"
  $workerProcess = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Credential $credentials -LoadUserProfile `
    -WorkingDirectory $scratch -ArgumentList $arguments -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  $null = $workerProcess.Handle
  # Exceeds the worker's inner deadlines (180s setup + 45s startup + 780s Pi prep + 30s RPC probe)
  # so inner diagnostics flush before the orchestrator aborts.
  $finished = $workerProcess.WaitForExit(1140000)
  Get-Content -LiteralPath $stdout -Tail 30
  Get-Content -LiteralPath $stderr -Tail 30
  if (!$finished) { throw 'Windows package smoke timed out' }
  if ($workerProcess.ExitCode -ne 0) { throw "Windows package smoke failed: $($workerProcess.ExitCode)" }
} finally {
  if ($workerProcess -and !$workerProcess.HasExited) {
    & taskkill.exe /PID $workerProcess.Id /T /F | Out-Null
  }
  Remove-LocalUser -SID $account.SID
  if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force }
}
