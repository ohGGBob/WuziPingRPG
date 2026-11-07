param(
    [string]$Serial = '',
    [string]$Package = 'cn.wuziping.ember'
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outDir = Join-Path $root 'artifacts/device'
$remoteXml = '/sdcard/wuziping-interface-window.xml'
$rows = [System.Collections.Generic.List[object]]::new()

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$adb = Get-Command adb.exe -ErrorAction SilentlyContinue
if ($null -eq $adb) {
    throw 'adb is unavailable. Install Android platform-tools and add adb.exe to PATH.'
}

$devices = @(& $adb.Source devices | Select-Object -Skip 1 | Where-Object { $_.Trim().Length -gt 0 })
if ($devices.Count -ne 1) {
    throw "Expected exactly one adb device, found $($devices.Count)."
}
if ($devices[0] -notmatch '^\s*(\S+)\s+device\s*$') {
    throw "The only adb device is not ready: $($devices[0])"
}
if ([string]::IsNullOrWhiteSpace($Serial)) {
    $Serial = $Matches[1]
}

function Invoke-Adb {
    param([string[]]$Arguments)
    $output = & $adb.Source @('-s', $Serial) @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "adb command failed: adb -s $Serial $($Arguments -join ' ')`n$($output -join "`n")"
    }
    return @($output)
}

$packages = Invoke-Adb @('shell', 'pm', 'list', 'packages', $Package)
if ($packages -notmatch ('(?m)^package:' + [regex]::Escape($Package) + '\s*$')) {
    throw "Package $Package is not installed on device $Serial."
}

function Get-UiXml {
    param([string]$Path)
    Invoke-Adb @('shell', 'uiautomator', 'dump', $remoteXml) | Out-Null
    Invoke-Adb @('pull', $remoteXml, $Path) | Out-Null
    return [xml](Get-Content -LiteralPath $Path -Raw -Encoding UTF8)
}

function Save-Screenshot {
    param([string]$Path)
    $start = [System.Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $adb.Source
    $start.Arguments = "-s `"$Serial`" exec-out screencap -p"
    $start.UseShellExecute = $false
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.CreateNoWindow = $true
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $start
    $process.Start() | Out-Null
    $file = [IO.File]::Open($Path, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $process.StandardOutput.BaseStream.CopyTo($file)
    } finally {
        $file.Dispose()
    }
    $errorText = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw "screencap failed: $errorText"
    }
}

function Get-NodeLabel {
    param($Node)
    $text = [string]$Node.text
    if (-not [string]::IsNullOrWhiteSpace($text)) { return $text }
    return [string]$Node.'content-desc'
}

function Find-UiNode {
    param($Xml, [string]$Label)
    $nodes = @($Xml.SelectNodes('//node'))
    $exact = @($nodes | Where-Object {
        ([string]$_.text -eq $Label) -or ([string]$_.'content-desc' -eq $Label)
    })
    if ($exact.Count -gt 0) { return $exact[0] }
    $partial = @($nodes | Where-Object {
        ([string]$_.text -like "*$Label*") -or ([string]$_.'content-desc' -like "*$Label*")
    })
    if ($partial.Count -gt 0) { return $partial[0] }
    return $null
}

function Get-NodeCenter {
    param($Node)
    if ([string]$Node.bounds -notmatch '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$') {
        throw "Node has invalid bounds: $($Node.bounds)"
    }
    return @(
        [int](($Matches[1] -as [int]) + (($Matches[3] -as [int]) - ($Matches[1] -as [int])) / 2),
        [int](($Matches[2] -as [int]) + (($Matches[4] -as [int]) - ($Matches[2] -as [int])) / 2)
    )
}

function Tap-Text {
    param([string]$Label)
    $tempXml = Join-Path $outDir '.current.xml'
    $xml = Get-UiXml $tempXml
    $node = Find-UiNode $xml $Label
    if ($null -eq $node) {
        throw "Could not find UI text: $Label"
    }
    $point = Get-NodeCenter $node
    Invoke-Adb @('shell', 'input', 'tap', [string]$point[0], [string]$point[1]) | Out-Null
    Start-Sleep -Milliseconds 650
}

function Get-KeyNodes {
    param($Xml)
    $nodes = @($Xml.SelectNodes('//node'))
    $key = @($nodes | Where-Object {
        -not [string]::IsNullOrWhiteSpace((Get-NodeLabel $_)) -and
        ([string]$_.bounds -ne '[0,0][0,0]')
    })
    $labels = @($key | ForEach-Object { Get-NodeLabel $_ } | Where-Object {
        $_ -match '游戏|模式|选择|返回|退出|继续|绘图|画|查找|替换|main\.py|English|记事本'
    } | Select-Object -Unique)
    $ids = @($key | ForEach-Object { [string]$_.'resource-id' } | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_)
    } | Select-Object -Unique)
    $parts = @()
    if ($labels.Count -gt 0) { $parts += 'text=' + ($labels -join ' / ') }
    if ($ids.Count -gt 0) { $parts += 'ids=' + ($ids -join ' / ') }
    if ($parts.Count -eq 0) { $parts += 'no matching visible key nodes' }
    return ($parts -join '; ')
}

function Capture-Step {
    param(
        [string]$Step,
        [string]$Name,
        [string]$Expected,
        [int]$DelayMs = 1500
    )
    Start-Sleep -Milliseconds $DelayMs
    $png = Join-Path $outDir "step-$Step.png"
    $xmlPath = Join-Path $outDir "step-$Step.xml"
    Save-Screenshot $png
    $xml = Get-UiXml $xmlPath
    $observed = Get-KeyNodes $xml
    $rows.Add([pscustomobject]@{
        Step = $Step
        Expectation = $Expected
        Observed = $observed
        Manual = ''
    })
    Write-Host "[$Step] $Name"
    Write-Host "  evidence: $png | $xmlPath"
    Write-Host "  key nodes: $observed"
    return $xml
}

function Press-Back {
    Invoke-Adb @('shell', 'input', 'keyevent', '4') | Out-Null
}

Write-Host "Device: $Serial"
Write-Host "Package: $Package"
Write-Host "Evidence: $outDir"

Invoke-Adb @('shell', 'monkey', '-p', $Package, '1') | Out-Null
$xml = Capture-Step '1' '启动' '天工启动并显示初始界面'

Tap-Text '游戏'
$xml = Get-UiXml (Join-Path $outDir '.current.xml')
if ($null -ne (Find-UiNode $xml '选择今天的状态')) {
    Tap-Text '游戏'
}
$xml = Capture-Step '2' '进入游戏厅' '显示游戏厅'

Press-Back
$xml = Capture-Step '3' '游戏厅返回' '回到编辑器'

Press-Back
$xml = Capture-Step '4' '编辑器返回' '出现模式选择器'

Tap-Text '返回'
$xml = Capture-Step '5' '选择器返回按钮' '回到编辑器且不出现退出对话框' 200

Press-Back
$xml = Capture-Step '6' '再次打开选择器' '出现模式选择器'

# Fire twice without waiting so the native dialog guard is exercised.
Press-Back
Press-Back
$xml = Capture-Step '7' '快速连续主页返回' '只出现一层「退出天工？」对话框' 200
$continue = Find-UiNode $xml '继续编辑'
if ($null -ne $continue) {
    $point = Get-NodeCenter $continue
    Invoke-Adb @('shell', 'input', 'tap', [string]$point[0], [string]$point[1]) | Out-Null
    Start-Sleep -Milliseconds 650
} else {
    Write-Warning 'No「继续编辑」node found in step-7.xml; manual verification required.'
}

Tap-Text '普通记事本'
$modeXml = Get-UiXml (Join-Path $outDir '.current.xml')
if ($null -ne (Find-UiNode $modeXml '选择今天的状态')) {
    Tap-Text '普通记事本'
}
Tap-Text '绘图模式'
Press-Back
$xml = Capture-Step '8' '记事本画笔返回' '退出绘制模式而不是打开选择器'

Tap-Text '更多操作'
Tap-Text '查找替换'
Press-Back
$xml = Capture-Step '9' '查找面板返回' '关闭查找面板'

Write-Host ''
$rows | Format-Table Step, Expectation, Observed, Manual -AutoSize | Out-String -Width 240 | Write-Host
