Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# >>> release pin
$StackVersion = '0.1.0.dev49'
$StackSourceCommit = 'a3fbd1f266671fe5d32677582b180e0f9b23a858'
$StackNpmVersion = '0.1.0-dev.49'
$StackKits = @{
    'darwin-arm64' = 'df4db6fb39a5b912da55fa55c5025e2f49513adeae375a58bff5cb56eaa92816'
    'darwin-x64' = '4a1823f787f0024695efc7e76274024cfe353695a443dbcaa3cb1a088a15d924'
    'linux-arm64' = '79b5840856025b08603530f50a502b3db9ced2ebf22f5bd8484ee41fa07336d8'
    'linux-x64' = 'f20a671e9211e3fce62f42dbd831bb58a2e19dc535349445cc21f1b81317f235'
    'win32-x64' = '7f3ceec34007a8ba930e475ff60f8b0724059b8b3b9024681be63d7a90f167b9'
}
$StackBootstrap = @{
    'darwin-arm64' = @{
        manifest = 'd8f3f38d037a70c56103b2e30a17b879fbbe4210e836e799b45f09150b81bf3d'
        inventory = 'f7a1e10942b97ce3d96ba0f94980f5b8659dc61af82a6d7b6cfee2551b031da8'
        bytes = '14992818'
        files = '1372'
        entries = '1512'
        python = 'python/bin/python3.12'
        modules = 'modules'
    }
    'darwin-x64' = @{
        manifest = '8941572d45f324bf0611487e1b2ac39ff75f2694dffbbec5e5239e27f1c7aad8'
        inventory = '06971234b2b0198f750ef6167674b0112b142579d744981875d9560be0db96a0'
        bytes = '14823026'
        files = '1369'
        entries = '1508'
        python = 'python/bin/python3.12'
        modules = 'modules'
    }
    'linux-arm64' = @{
        manifest = '56404a305e95f4981d15f249852884923985cf41f3d1ccf90eca1c730853987d'
        inventory = 'a9c368a8312f80c3fa64bf6a995a7b715281898c4c248b9ec783e07251bc94ee'
        bytes = '17504438'
        files = '4243'
        entries = '4427'
        python = 'python/bin/python3.12'
        modules = 'modules'
    }
    'linux-x64' = @{
        manifest = '5c482ab97544344f97ea3164e2b560e3abea28b087d03940a3029c354c006dbf'
        inventory = 'ce55015cc2c04c51006b55d779fe91d65beb69511e9b9eb6098ffef025c1b85c'
        bytes = '20830959'
        files = '4243'
        entries = '4427'
        python = 'python/bin/python3.12'
        modules = 'modules'
    }
    'win32-x64' = @{
        manifest = 'f8e2af891cc7c527063419220c96ad755d31c5195be27d4cc4712cbb8dc0ebec'
        inventory = 'a6e2e668345e622b5334f3628f84d6ac13546aa7ab108ffaff3b1ec2283d0383'
        bytes = '23226384'
        files = '3413'
        entries = '3680'
        python = 'python/python.exe'
        modules = 'modules'
    }
}
# <<< release pin

function Stop-Stack([string]$Message) {
    $failure = [InvalidOperationException]::new($Message)
    $failure.Data['StackError'] = $true
    throw $failure
}
function Quote-Native([string]$Value) {
    return '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}
function Invoke-Native([string]$File, [string[]]$Arguments) {
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $File
    $start.UseShellExecute = $false
    if ($start.PSObject.Properties['ArgumentList']) {
        foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    } else {
        $start.Arguments = (($Arguments | ForEach-Object { Quote-Native $_ }) -join ' ')
    }
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    $started = $false
    try {
        $started = $process.Start()
        while (-not $process.WaitForExit(100)) { }
        return $process.ExitCode
    } finally {
        if ($started -and -not $process.HasExited) { $process.Kill() }
        $process.Dispose()
    }
}
function Get-Digest([string]$Path) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}
function Assert-Relative([string]$Name) {
    if ($Name -cnotmatch '^[A-Za-z0-9_+./-]+$' -or $Name.StartsWith('/') -or
        @($Name.Split('/') | Where-Object {
            $_ -in @('', '.', '..') -or $_.EndsWith('.') -or
            $_ -imatch '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)'
        }).Count) { Stop-Stack 'unsafe kit relative path' }
}
function Assert-Item([string]$Path, [bool]$Directory) {
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or ($item -is [IO.DirectoryInfo]) -ne $Directory) {
        Stop-Stack 'unsafe kit path'
    }
    return $item
}
function Assert-WindowsParents([string]$Path) {
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $admins = 'S-1-5-32-544'
    $trustedInstaller = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
    $parent = [IO.Directory]::GetParent([IO.Path]::GetFullPath($Path))
    while ($parent) {
        if (-not (Test-Path -LiteralPath $parent.FullName)) { $parent = $parent.Parent; continue }
        $parent = Get-Item -LiteralPath $parent.FullName -Force
        if ($parent -isnot [IO.DirectoryInfo]) { Stop-Stack 'unsafe private parent path' }
        if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { Stop-Stack 'linked private parent' }
        $parentAcl = Get-Acl -LiteralPath $parent.FullName
        if ($parentAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @($sid.Value, $system.Value, $admins, $trustedInstaller)) {
            Stop-Stack 'foreign private parent'
        }
        foreach ($rule in $parentAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
            if ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) { continue }
            if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @($sid.Value, $system.Value, $admins, 'S-1-3-0', 'S-1-3-4', $trustedInstaller) -and
                ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]'Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership')) {
                Stop-Stack 'unsafe private parent permissions'
            }
        }
        $parent = $parent.Parent
    }
}
function Get-KitRoot([bool]$Windows, [string]$CacheBase) {
    if ($env:LOCALMODELS_KIT_HOME) { return [IO.Path]::GetFullPath($env:LOCALMODELS_KIT_HOME) }
    $preferred = [IO.Path]::GetFullPath((Join-Path $CacheBase 'simplex-localmodels/kits'))
    if ($Windows) {
        try { Assert-WindowsParents $preferred } catch {
            if (-not $_.Exception.Data['StackError'] -or $_.Exception.Message -notin @(
                'unsafe private parent permissions', 'foreign private parent',
                'linked private parent', 'unsafe private parent path'
            )) { throw }
            if (-not $env:USERPROFILE -or -not [IO.Path]::IsPathRooted($env:USERPROFILE)) { throw }
            # AppData can grant app capabilities broad rights; verify a separate cache instead.
            $preferred = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.cache/simplex-localmodels/kits'))
            Assert-WindowsParents $preferred
        }
    }
    return $preferred
}
function Get-WindowsAcl([IO.FileSystemInfo]$Item) {
    $sections = [Security.AccessControl.AccessControlSections]'Owner,Access'
    if ($PSVersionTable.PSEdition -eq 'Core') {
        return [IO.FileSystemAclExtensions]::GetAccessControl($Item, $sections)
    }
    return $Item.GetAccessControl($sections)
}
function Assert-WindowsPrivate([string]$Path, [bool]$Repair, [bool]$AllowInherited = $false, [bool]$PrivateTree = $false) {
    $item = Get-Item -LiteralPath $Path -Force
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $admins = 'S-1-5-32-544'
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { Stop-Stack 'linked private path' }
    $acl = Get-WindowsAcl $item
    $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($owner -ne $sid.Value -and -not ($Repair -and $owner -eq $admins)) { Stop-Stack 'foreign kit owner' }
    if (-not $PrivateTree) { Assert-WindowsParents $Path }
    if ($Repair) {
        $acl = if (($item -is [IO.DirectoryInfo])) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
        $acl.SetOwner($sid)
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($principal in @($sid, $system)) {
            $rule = if (($item -is [IO.DirectoryInfo])) {
                [Security.AccessControl.FileSystemAccessRule]::new($principal, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
            } else { [Security.AccessControl.FileSystemAccessRule]::new($principal, 'FullControl', 'Allow') }
            $acl.AddAccessRule($rule)
        }
        if ($PSVersionTable.PSEdition -eq 'Core') { [IO.FileSystemAclExtensions]::SetAccessControl($item, $acl) } else { $item.SetAccessControl($acl) }
        $acl = Get-WindowsAcl $item
    }
    if (($item -is [IO.DirectoryInfo]) -and -not $AllowInherited -and -not $acl.AreAccessRulesProtected) { Stop-Stack 'inherited private permissions' }
    $allowed = $false
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow') {
            if ($rule.IdentityReference.Value -notin @($sid.Value, $system.Value)) { Stop-Stack 'shared kit permissions' }
            if ($rule.IdentityReference.Value -eq $sid.Value) { $allowed = $true }
        }
    }
    if (-not $allowed) { Stop-Stack 'missing owner access' }
}
function Assert-PosixMode([string]$Path, [string[]]$Modes = @()) {
    $info = if ($IsMacOS) { & stat -f '%u %Lp' $Path } else { & stat -c '%u %a' -- $Path }
    if ($LASTEXITCODE -ne 0) { Stop-Stack 'could not inspect kit permissions' }
    $parts = $info.Trim().Split(' ')
    if ($parts[0] -ne $script:Owner -or ($Modes.Count -gt 0 -and $parts[1] -notin $Modes)) { Stop-Stack 'kit must be private, owned and sealed' }
}
function Assert-Root {
    $null = Assert-Item $root $true
    if ($onWindows) { Assert-WindowsPrivate $root $false } else {
        Assert-PosixMode $root @('700', '500')
        $ancestor = [IO.Directory]::GetParent($root)
        while ($ancestor) {
            $null = Assert-Item $ancestor.FullName $true
            $info = if ($IsMacOS) { & stat -f '%u %Lp' $ancestor.FullName } else { & stat -c '%u %a' -- $ancestor.FullName }
            if ($LASTEXITCODE -ne 0) { Stop-Stack 'could not inspect private parent' }
            $parts = $info.Trim().Split(' ')
            $mode = [Convert]::ToInt32($parts[1], 8)
            if ($parts[0] -notin @($script:Owner, '0') -or (($mode -band 18) -and -not ($mode -band 512))) {
                Stop-Stack 'unsafe private parent permissions'
            }
            $ancestor = $ancestor.Parent
        }
    }
}
function Get-KitTree([string]$Directory) {
    $queue = New-Object 'Collections.Generic.Queue[IO.FileSystemInfo]'
    $queue.Enqueue((Assert-Item $Directory $true))
    $count = 0
    while ($queue.Count) {
        $item = $queue.Dequeue()
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { Stop-Stack 'linked kit path' }
        $count++
        if ($count -gt [int]$pin.entries) { Stop-Stack 'kit tree exceeds entry limit' }
        $item
        if (($item -is [IO.DirectoryInfo])) {
            foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force) { $queue.Enqueue($child) }
        }
    }
}
function Assert-Kit([string]$Directory) {
    $tree = @(Get-KitTree $Directory)
    $payload = @($tree | Where-Object { $_ -isnot [IO.DirectoryInfo] })
    if ($tree.Count -ne [int]$pin.entries -or $payload.Count -ne [int]$pin.files) { Stop-Stack 'kit tree mismatch' }
    if ($onWindows) { Assert-WindowsParents $Directory }
    foreach ($item in $tree) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { Stop-Stack 'linked kit path' }
        if ($onWindows) {
            # The tree walk checks every private ancestor once, before its descendants.
            Assert-WindowsPrivate $item.FullName $false $false $true
        } else {
            $modes = if (($item -is [IO.DirectoryInfo])) { @('500') } else { @('400', '500') }
            Assert-PosixMode $item.FullName $modes
        }
    }
    if (-not $onWindows) { Assert-PosixMode (Join-Path $Directory $pin.python) @('500') }
    $inventory = Join-Path $Directory 'bootstrap.sha256'
    $manifest = Join-Path $Directory 'tool.json'
    if ((Get-Digest $inventory) -ne $pin.inventory -or (Get-Digest $manifest) -ne $pin.manifest) { Stop-Stack 'kit metadata checksum mismatch' }
    $identity = [IO.File]::ReadAllText((Join-Path $Directory 'bootstrap.identity')).TrimEnd("`n")
    if ($identity -cne "$target $StackSourceCommit $StackVersion $($pin.python) $($pin.modules)") { Stop-Stack 'kit identity mismatch' }
    $json = [IO.File]::ReadAllText($manifest)
    $body = if ($PSVersionTable.PSVersion.Major -ge 6) { $json | ConvertFrom-Json -AsHashtable } else { $json | ConvertFrom-Json }
    $assets = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
    if ($body.assets -is [Collections.IDictionary]) {
        foreach ($asset in $body.assets.GetEnumerator()) { $assets.Add($asset.Key, $asset.Value) }
    } elseif ($body.assets -is [pscustomobject]) {
        foreach ($asset in $body.assets.PSObject.Properties) { $assets.Add($asset.Name, $asset.Value) }
    } else { Stop-Stack 'invalid manifest assets type' }
    foreach ($field in @('platform', 'arch', 'sourceCommit', 'python', 'moduleDir')) {
        if ($body.$field -isnot [string]) { Stop-Stack 'invalid manifest identity type' }
    }
    if ($body.schemaVersion -isnot [ValueType] -or
        $body.schemaVersion -is [bool] -or $body.schemaVersion -ne 1 -or "$($body.platform)-$($body.arch)" -cne $target -or
        $body.sourceCommit -cne $StackSourceCommit -or $body.python -cne $pin.python -or $body.moduleDir -cne $pin.modules -or
        -not $assets.ContainsKey($pin.python)) { Stop-Stack 'manifest target or source mismatch' }
    $lines = [IO.File]::ReadAllLines($inventory)
    $checks = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
    foreach ($line in $lines) {
        if ($line -cnotmatch '^([a-f0-9]{64})  ([A-Za-z0-9_+./-]+)$') { Stop-Stack 'invalid checksum inventory' }
        $expected = $Matches[1]; $relative = $Matches[2]
        Assert-Relative $relative
        if ($checks.ContainsKey($relative)) { Stop-Stack 'duplicate inventory path' }
        $checks.Add($relative, $expected)
        $file = Join-Path $Directory $relative
        $null = Assert-Item $file $false
        if ((Get-Digest $file) -cne $expected) { Stop-Stack 'kit payload checksum mismatch' }
    }
    if ($checks.Count -ne $payload.Count - 1 -or $assets.Count -ne $checks.Count - 2) { Stop-Stack 'manifest asset list mismatch' }
    foreach ($asset in $assets.GetEnumerator()) {
        if ($asset.Value -isnot [string] -or $asset.Key -in @('tool.json', 'bootstrap.identity', 'bootstrap.sha256') -or
            -not $checks.ContainsKey($asset.Key) -or $asset.Value -cne $checks[$asset.Key]) {
            Stop-Stack 'manifest asset checksum mismatch'
        }
    }
}
function Set-KitMode([string]$Directory) {
    $tree = @(Get-KitTree $Directory)
    if ($onWindows) { Assert-WindowsParents $Directory }
    foreach ($item in $tree) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { Stop-Stack 'linked kit path' }
        if ($onWindows) {
            Assert-WindowsPrivate $item.FullName $true $false $true
            if (-not ($item -is [IO.DirectoryInfo])) { $item.IsReadOnly = $true }
        } else {
            $mode = if (($item -is [IO.DirectoryInfo])) { '500' } else { 'a-w,go-rwx' }
            & chmod $mode -- $item.FullName
            if ($LASTEXITCODE -ne 0) { Stop-Stack 'could not seal kit' }
        }
    }
}
function Assert-NpmUrl([string]$Url, [bool]$Redirect = $false) {
    try { $uri = [uri]::new($Url, [UriKind]::Absolute) } catch {
        throw [Net.WebException]::new('invalid npm URL')
    }
    $localFixture = -not $Redirect -and $uri.Scheme -eq 'http' -and $uri.IsLoopback -and
        ($env:SIMPLEX_NPM_REGISTRY -or $env:LOCALMODELS_KIT_BASE_URL)
    if (($uri.Scheme -ne 'https' -and -not $localFixture) -or $uri.UserInfo) {
        throw [Net.WebException]::new('npm URL must use HTTPS without credentials')
    }
    return $uri.AbsoluteUri
}
function Get-RedirectUrl([string]$Base, [string]$Location, [int]$Hops) {
    if ($Hops -ge 5 -or -not $Location) { throw [Net.WebException]::new('npm redirect limit or invalid target') }
    try { $next = [uri]::new([uri]$Base, $Location).AbsoluteUri } catch {
        throw [Net.WebException]::new('invalid npm redirect')
    }
    return Assert-NpmUrl $next $true
}
function Get-RegistryResponse([string]$Url) {
    if ($PSVersionTable.PSVersion.Major -lt 6) {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    }
    $Url = Assert-NpmUrl $Url
    for ($hops = 0; $hops -le 5; $hops++) {
        $request = [Net.WebRequest]::Create($Url)
        $request.Timeout = 300000
        $request.ReadWriteTimeout = 300000
        $request.AllowAutoRedirect = $false
        $response = $request.GetResponse()
        if ([int]$response.StatusCode -notin @(301, 302, 303, 307, 308)) { return $response }
        $location = $response.Headers['Location']
        $response.Dispose()
        $Url = Get-RedirectUrl $Url $location $hops
    }
}
function Get-Archive([string]$Url, [string]$Destination) {
    $response = $null; $inputStream = $null; $outputStream = $null
    try {
        $response = Get-RegistryResponse $Url
        if ($response.ContentLength -gt [long]$pin.bytes) { Stop-Stack 'archive size exceeds pin' }
        $inputStream = $response.GetResponseStream()
        $outputStream = [IO.File]::Open($Destination, 'CreateNew', 'Write', 'None')
        if ($onWindows) { Assert-WindowsPrivate $Destination $true }
        $buffer = New-Object byte[] 65536
        $total = 0L
        while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $total += $count
            if ($total -gt [long]$pin.bytes) { Stop-Stack 'archive size exceeds pin' }
            $outputStream.Write($buffer, 0, $count)
        }
    } finally {
        if ($outputStream) { $outputStream.Dispose() }
        if ($inputStream) { $inputStream.Dispose() }
        if ($response) { $response.Dispose() }
    }
}
function Get-NpmUrl([string]$Region) {
    $base = if ($Region -eq 'cn') { 'https://registry.npmmirror.com' } else { 'https://registry.npmjs.org' }
    if ($env:SIMPLEX_NPM_REGISTRY) { $base = $env:SIMPLEX_NPM_REGISTRY }
    $name = "localmodels-$target"
    return "$($base.TrimEnd('/'))/@simplexai/$name/-/$name-$StackNpmVersion.tgz"
}
function Resolve-Region {
    if ($script:region -eq 'auto' -and $env:LOCALMODELS_KIT_BASE_URL) { $script:region = 'global' }
    if ($script:region -eq 'auto') {
        if ($PSVersionTable.PSVersion.Major -lt 6) {
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        }
        Add-Type -AssemblyName System.Net.Http
        $handler = [Net.Http.HttpClientHandler]::new()
        $handler.AllowAutoRedirect = $false
        $client = [Net.Http.HttpClient]::new($handler)
        $client.Timeout = [TimeSpan]::FromSeconds(5)
        $client.MaxResponseContentBufferSize = 262144
        $client.DefaultRequestHeaders.Range = [Net.Http.Headers.RangeHeaderValue]::new(0, 262143)
        $tasks = @{}; $urls = @{}; $hops = @{}; $timeouts = @{}
        try {
            foreach ($candidate in @('global', 'cn')) {
                $urls[$candidate] = Assert-NpmUrl (Get-NpmUrl $candidate)
                $hops[$candidate] = 0
                $timeouts[$candidate] = [Threading.CancellationTokenSource]::new(5000)
                $tasks[$candidate] = $client.GetAsync($urls[$candidate], $timeouts[$candidate].Token)
            }
            $script:region = 'global'
            while ($tasks.Count) {
                $finished = [Threading.Tasks.Task]::WhenAny([Threading.Tasks.Task[]]@($tasks.Values)).GetAwaiter().GetResult()
                $candidate = @($tasks.Keys | Where-Object { $tasks[$_] -eq $finished })[0]
                if ($finished.Status -eq 'RanToCompletion') {
                    $response = $finished.Result
                    try {
                        if ($response.IsSuccessStatusCode) {
                            $script:region = $candidate
                            break
                        }
                        if ([int]$response.StatusCode -in @(301, 302, 303, 307, 308)) {
                            $urls[$candidate] = Get-RedirectUrl $urls[$candidate] "$($response.Headers.Location)" $hops[$candidate]
                            $hops[$candidate]++
                            $tasks[$candidate] = $client.GetAsync($urls[$candidate], $timeouts[$candidate].Token)
                            continue
                        }
                    } catch [Net.WebException] { } finally { $response.Dispose() }
                }
                $tasks.Remove($candidate)
            }
        } finally {
            $client.CancelPendingRequests()
            $client.Dispose()
            foreach ($timeout in $timeouts.Values) { $timeout.Cancel(); $timeout.Dispose() }
        }
    }
    $hostName = ([uri](Get-NpmUrl $script:region)).Authority
    [Console]::Error.WriteLine("stack.ps1: using npm mirror $hostName ($script:region)")
}
function Remove-KitStage([string]$Path, [bool]$AllowLinks = $false) {
    Assert-Root
    $stageRoot = Assert-Item $Path $true
    if ($stageRoot.Parent.FullName -cne $root -or
        $stageRoot.Name -cnotmatch '\A\.staging\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\z') {
        Stop-Stack 'unsafe staging path'
    }
    $tree = New-Object 'Collections.Generic.List[IO.FileSystemInfo]'
    $tree.Add($stageRoot)
    for ($index = 0; $index -lt $tree.Count; $index++) {
        $item = $tree[$index]
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            if (-not $AllowLinks) { Stop-Stack 'linked staging path' }
            if ($onWindows) {
                $owner = (Get-Acl -LiteralPath $item.FullName).GetOwner([Security.Principal.SecurityIdentifier]).Value
                if ($owner -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { Stop-Stack 'foreign staging owner' }
            } else { Assert-PosixMode $item.FullName }
            continue
        }
        if ($onWindows) { Assert-WindowsPrivate $item.FullName $false $true } else { Assert-PosixMode $item.FullName }
        if ($item -is [IO.DirectoryInfo]) {
            foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force) { $tree.Add($child) }
        }
    }
    if (-not $onWindows) {
        foreach ($item in $tree) {
            if ($item -is [IO.DirectoryInfo] -and -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                & chmod u+w -- $item.FullName
                if ($LASTEXITCODE -ne 0) { Stop-Stack 'could not reopen staging directory' }
            }
        }
    }
    for ($index = $tree.Count - 1; $index -ge 0; $index--) {
        $item = $tree[$index]
        if ($item -is [IO.DirectoryInfo]) { [IO.Directory]::Delete($item.FullName) } else {
            if ($onWindows -and -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { $item.IsReadOnly = $false }
            [IO.File]::Delete($item.FullName)
        }
    }
}
function Enter-KitLock([int]$Attempts, [int]$DelayMilliseconds) {
    $lockPath = Join-Path $root ".lock-$kit"
    for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
        if ($onWindows) {
            try {
                return [IO.FileStream]::new($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None, 1, [IO.FileOptions]::DeleteOnClose)
            } catch [IO.IOException] { }
        } else {
            & mkdir -- $lockPath 2>$null
            if ($LASTEXITCODE -eq 0) { return $true }
        }
        Start-Sleep -Milliseconds $DelayMilliseconds
    }
    Stop-Stack 'cache lock timeout'
}
function Exit-KitLock($Handle) {
    if ($onWindows) { $Handle.Dispose() } else { [IO.Directory]::Delete((Join-Path $root ".lock-$kit")) }
}
function Remove-OperationStage {
    if (-not (Test-Path -LiteralPath $root)) { return }
    Assert-Root
    $lockHandle = Enter-KitLock 50 100
    try {
        $stage = Join-Path $root ('.staging.' + $operationId)
        if (Test-Path -LiteralPath $stage) { Remove-KitStage $stage }
    } finally { Exit-KitLock $lockHandle }
}
function Install-Kit {
    if (-not (Test-Path -LiteralPath $root)) { $null = [IO.Directory]::CreateDirectory($root) }
    $null = Assert-Item $root $true
    if ($onWindows) { Assert-WindowsPrivate $root $true } else {
        Assert-PosixMode $root
        & chmod 700 -- $root
        if ($LASTEXITCODE -ne 0) { Stop-Stack 'could not protect cache root' }
    }
    Assert-Root
    $lockHandle = $null; $stage = $null
    try {
        $lockHandle = Enter-KitLock 120 1000
        try { Assert-Kit $final; return } catch { }
        if (Test-Path -LiteralPath $final) {
            $null = Assert-Item $final $true
            if ($onWindows) { Assert-WindowsPrivate $final $true } else {
                Assert-PosixMode $final
            }
        }
        $stageId = if ($operationId) { $operationId } else { [Guid]::NewGuid().ToString('D') }
        $candidate = Join-Path $root ('.staging.' + $stageId)
        if (Test-Path -LiteralPath $candidate) { Stop-Stack 'operation staging path already exists' }
        $stage = $candidate
        $null = [IO.Directory]::CreateDirectory($stage)
        if ($onWindows) { Assert-WindowsPrivate $stage $true } else { & chmod 700 -- $stage }
        [Console]::Error.WriteLine("stack.ps1: downloading localmodels $StackVersion")
        $archive = Join-Path $stage 'kit.tgz'
        Resolve-Region
        if ($env:LOCALMODELS_KIT_BASE_URL) {
            Get-Archive "$($env:LOCALMODELS_KIT_BASE_URL.TrimEnd('/'))/$target.tgz" $archive
        } else {
            try { Get-Archive (Get-NpmUrl $script:region) $archive } catch [Net.WebException], [IO.IOException] {
                if (Test-Path -LiteralPath $archive) { [IO.File]::Delete($archive) }
                $script:region = if ($script:region -eq 'cn') { 'global' } else { 'cn' }
                Get-Archive (Get-NpmUrl $script:region) $archive
            }
        }
        if ((Get-Item -LiteralPath $archive).Length -ne [long]$pin.bytes -or (Get-Digest $archive) -cne $kit) { Stop-Stack 'archive SHA256 mismatch or size mismatch' }
        $members = @(& tar -tvzf $archive 2>$null)
        if ($LASTEXITCODE -ne 0 -or $members.Count -gt [int]$pin.entries) { Stop-Stack 'invalid kit archive' }
        $sizeColumn = if ($onWindows -or $IsMacOS) { 4 } else { 2 }
        $expandedSize = 0L
        foreach ($member in $members) {
            if ($member -notmatch '^[-d]') { Stop-Stack 'linked or special archive member' }
            $fields = @($member -split '\s+')
            $size = 0L
            if (-not [long]::TryParse($fields[$sizeColumn], [ref]$size) -or $size -lt 0) { Stop-Stack 'invalid archive size' }
            $expandedSize += $size
            if ($expandedSize -gt 1073741824) { Stop-Stack 'kit archive exceeds extracted size limit' }
        }
        $names = @(& tar -tzf $archive 2>$null)
        if ($LASTEXITCODE -ne 0) { Stop-Stack 'invalid kit archive' }
        foreach ($name in $names) {
            $relative = $name.TrimEnd('/')
            Assert-Relative $relative
            if (-not $relative.StartsWith('package/')) { Stop-Stack 'invalid npm package prefix' }
        }
        $unpacked = Join-Path $stage 'kit'
        $null = [IO.Directory]::CreateDirectory($unpacked)
        if ((Invoke-Native 'tar' @('-xzf', $archive, '--strip-components=1', '-C', $unpacked)) -ne 0) { Stop-Stack 'could not unpack kit' }
        if (-not $onWindows) {
            & chmod 755 -- (Join-Path $unpacked $pin.python) (Join-Path $unpacked 'kit.py')
            if ($LASTEXITCODE -ne 0) { Stop-Stack 'could not restore executables' }
        }
        Set-KitMode $unpacked
        Assert-Kit $unpacked
        if (Test-Path -LiteralPath $final) {
            if (-not $onWindows) { & chmod 700 -- $final }
            [IO.Directory]::Move($final, (Join-Path $stage 'invalid'))
        }
        if (-not $onWindows) { & chmod 700 -- $unpacked }
        [IO.Directory]::Move($unpacked, $final)
        if (-not $onWindows) { & chmod 500 -- $final }
    } finally {
        if ($stage -and (Test-Path -LiteralPath $stage)) {
            try { Remove-KitStage $stage $true } catch { }
        }
        if ($lockHandle) { Exit-KitLock $lockHandle }
    }
}

try {
    if (-not $StackVersion) { Stop-Stack 'this is the unpinned template; use a released launcher' }
    $arguments = @($args)
    $script:region = if ($env:SIMPLEX_REGION) { $env:SIMPLEX_REGION } else { 'auto' }
    if ($arguments.Count -gt 0 -and $arguments[0] -in @('-Region', '--region')) {
        if ($arguments.Count -lt 2) { Stop-Stack 'Region requires auto, global or cn' }
        $script:region = $arguments[1]
        $arguments = @($arguments | Select-Object -Skip 2)
    }
    if ($script:region -cnotin @('auto', 'global', 'cn')) { Stop-Stack 'Region requires auto, global or cn' }
    $bootstrap = $arguments.Count -gt 0 -and $arguments[0] -ceq '--bootstrap-json'
    $cleanup = $arguments.Count -gt 0 -and $arguments[0] -ceq '--bootstrap-cleanup'
    $installedOnly = $false
    $operationId = $null
    if ($bootstrap -or $cleanup) {
        if ($bootstrap -and $arguments.Count -eq 2 -and $arguments[1] -ceq '--installed-only') { $installedOnly = $true }
        elseif ($arguments.Count -eq 3 -and $arguments[1] -ceq '--operation-id' -and
            $arguments[2] -cmatch '\A[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\z') {
            $operationId = $arguments[2]
        } elseif (-not ($bootstrap -and $arguments.Count -eq 1)) { Stop-Stack 'invalid bootstrap control arguments' }
    } elseif (@($arguments | Where-Object { $_ -match '^--(bootstrap-json|bootstrap-cleanup|installed-only|operation-id)(=|$)' }).Count) {
        Stop-Stack 'invalid bootstrap control arguments'
    }
    $onWindows = $PSVersionTable.PSVersion.Major -lt 6 -or $IsWindows
    if ($onWindows) {
        if ($installedOnly) { Stop-Stack 'installed-only validation is unsupported on Windows' }
        $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
        $target = @{ AMD64 = 'win32-x64' }[$arch]
        $cacheBase = $env:LOCALAPPDATA
    } else {
        $os = if ($IsMacOS) { 'darwin' } else { 'linux' }
        $machine = (& uname -m).Trim()
        $target = @{ x86_64 = "$os-x64"; amd64 = "$os-x64"; arm64 = "$os-arm64"; aarch64 = "$os-arm64" }[$machine]
        $cacheBase = if ($env:XDG_CACHE_HOME) { $env:XDG_CACHE_HOME } else { Join-Path $HOME '.cache' }
        $script:Owner = (& id -u).Trim()
    }
    if (-not $target -or -not $StackKits.ContainsKey($target)) { Stop-Stack 'release has no kit for this platform' }
    $kit = $StackKits[$target]; $pin = $StackBootstrap[$target]
    $root = Get-KitRoot $onWindows $cacheBase
    $final = Join-Path $root $kit
    if ($cleanup) { Remove-OperationStage; exit 0 }
    $valid = $false
    try { Assert-Root; Assert-Kit $final; $valid = $true } catch { }
    if (-not $valid) {
        if ($installedOnly) { Stop-Stack 'installed kit validation failed' }
        Install-Kit
    }
    $env:SIMPLEX_REGION = $script:region
    if ($bootstrap) {
        $exitCode = Invoke-Native (Join-Path $final $pin.python) @('-I', '-B', (Join-Path $final 'kit.py'), 'describe', $StackVersion, $target, $StackSourceCommit, $kit, $pin.manifest, $pin.python, $pin.modules)
    } else {
        if ($arguments.Count -eq 0) { $arguments = @('--help') }
        $exitCode = Invoke-Native (Join-Path $final $pin.python) (@('-I', '-B', (Join-Path $final 'kit.py'), 'run', 'stack') + $arguments)
    }
    exit $exitCode
} catch {
    $message = if ($_.Exception.Data['StackError']) { $_.Exception.Message } else { 'bootstrap validation or preparation failed' }
    [Console]::Error.WriteLine("stack.ps1: $message")
    exit 2
}
