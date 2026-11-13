param([string]$JdkRoot='C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot')
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$node=Get-Command node.exe -ErrorAction SilentlyContinue
if($null -eq $node){throw 'Node.js is required for the Studio web tests'}
$tests=@((Get-ChildItem -LiteralPath (Join-Path $root 'studio/web/tests') -Filter '*.test.mjs' -File).FullName)
if($tests.Count -eq 0){throw 'No Studio web tests were found'}
& $node.Source --test @tests
if($LASTEXITCODE -ne 0){throw 'Studio web tests failed'}
$classes=Join-Path $root 'build/studio-tests'
New-Item -ItemType Directory -Force -Path $classes | Out-Null
$sources=@((Get-ChildItem -LiteralPath (Join-Path $root 'core/src/main/java'),(Join-Path $root 'tools/tests'),(Join-Path $root 'studio/tests') -Recurse -Filter '*.java').FullName)
$sources+=@((Join-Path $root 'studio/src/main/java/cn/wuziping/studio/TextFiles.java'),(Join-Path $root 'studio/src/main/java/cn/wuziping/studio/AssetServer.java'),(Join-Path $root 'studio/src/main/java/cn/wuziping/studio/PhoneActionPlan.java'))
& (Join-Path $JdkRoot 'bin/javac.exe') -encoding UTF-8 --release 8 -d $classes @sources
if($LASTEXITCODE -ne 0){throw 'Studio test compilation failed'}
Get-Content -LiteralPath (Join-Path $PSScriptRoot 'java-suites-studio.txt') | ForEach-Object {
  $name=$_.Trim()
  if(-not $name -or $name.StartsWith('#')){return}
  & (Join-Path $JdkRoot 'bin/java.exe') -cp $classes "cn.wuziping.ember.tests.$name"
  if($LASTEXITCODE -ne 0){throw "Game regression failed: $name"}
}
& (Join-Path $JdkRoot 'bin/java.exe') -cp $classes cn.wuziping.studio.tests.StudioFilesTests
if($LASTEXITCODE -ne 0){throw 'Studio file/server tests failed'}
