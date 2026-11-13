param([string]$SdkRoot='D:\AndroidTools\android-sdk',[string]$JdkRoot='C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot',[switch]$ParallelInstall,[switch]$SkipWebBuild,[string]$SigningKey="")
$ErrorActionPreference='Stop'
# Single source of truth for the version: parse it from studio/build.gradle.
$gradleText=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\studio\build.gradle'))
if($gradleText -notmatch 'versionCode\s+(\d+)'){throw "Cannot parse versionCode from studio/build.gradle"}
$VersionCode=$Matches[1]
if($gradleText -notmatch "versionName\s+'([^']+)'"){throw "Cannot parse versionName from studio/build.gradle"}
$VersionName=$Matches[1]
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$work=Join-Path $root 'build/studio'
$classes=Join-Path $work 'classes'
$dex=Join-Path $work 'dex'
$dist=Join-Path $root 'dist'
$pythonCmd=(Get-Command python -ErrorAction SilentlyContinue)
if(-not $pythonCmd){$pythonCmd=Get-Command python3 -ErrorAction Stop}
& $pythonCmd.Source (Join-Path $root 'tools/package_preflight.py') --root $root
if($LASTEXITCODE -ne 0){throw 'Package preflight failed'}
$bt=((& $pythonCmd.Source (Join-Path $root 'tools/verify_support.py') --sdk-root $SdkRoot --print-build-tools) | Out-String).Trim()
if($LASTEXITCODE -ne 0 -or -not $bt){throw 'Cannot select a complete build-tools directory'}
$java=Join-Path $JdkRoot 'bin/java.exe'
$platform=Join-Path $SdkRoot 'platforms/android-34/android.jar'
function Checked([string]$Exe,[string[]]$Arguments){& $Exe @Arguments;if($LASTEXITCODE -ne 0){throw "Failed: $Exe ($LASTEXITCODE)"}}
New-Item -ItemType Directory -Force -Path $classes,$dex,$dist,$work | Out-Null
if(-not $SkipWebBuild){Push-Location (Join-Path $root 'studio/web');try{Checked 'npm.cmd' @('run','build')}finally{Pop-Location}}
foreach($name in @('pyodide.js','pyodide.asm.js','pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json')){if(-not (Test-Path -LiteralPath (Join-Path $root "studio/src/main/assets/studio/runtime/$name"))){throw "Missing offline Python asset: $name. Run tools/fetch-python-runtime.ps1 first."}}
Copy-Item -LiteralPath (Join-Path $root 'artifacts/screenshots-v0.7/08-town.png') -Destination (Join-Path $root 'studio/src/main/assets/studio-game.png')
$sources=@((Get-ChildItem -LiteralPath (Join-Path $root 'core/src/main/java'),(Join-Path $root 'app/src/main/java'),(Join-Path $root 'studio/src/main/java') -Filter '*.java' -Recurse).FullName)
Checked (Join-Path $JdkRoot 'bin/javac.exe') (@('-encoding','UTF-8','--release','8','-classpath',$platform,'-d',$classes)+$sources)
$bytecode=Join-Path $work 'classes.jar'
Checked (Join-Path $JdkRoot 'bin/jar.exe') @('cf',$bytecode,'-C',$classes,'.')
Checked $java @('-cp',(Join-Path $bt 'lib/d8.jar'),'com.android.tools.r8.D8','--lib',$platform,'--min-api','23','--output',$dex,$bytecode)
$resources=Join-Path $work 'resources.zip'
Checked (Join-Path $bt 'aapt2.exe') @('compile','--dir',(Join-Path $root 'studio/src/main/res'),'-o',$resources)
$id=if($ParallelInstall){'cn.wuziping.ember.preview07'}else{'cn.wuziping.ember'}
$text=[IO.File]::ReadAllText((Join-Path $root 'studio/src/main/AndroidManifest.xml')).Replace('<manifest ',"<manifest package=`"$id`" ")
$label=if($ParallelInstall){'天工 · 试玩'}else{'天工'}
$text=$text.Replace('${studioLabel}',$label)
$manifest=Join-Path $work 'AndroidManifest.xml'
[IO.File]::WriteAllText($manifest,$text,[Text.UTF8Encoding]::new($false))
$unsigned=Join-Path $work 'unsigned.apk'
$page=Join-Path $root 'studio/src/main/assets/studio/index.html'
Copy-Item -LiteralPath $page -Destination (Join-Path $root 'studio/src/main/assets/studio/editor.page') -Force
Copy-Item -LiteralPath $page -Destination (Join-Path $root 'studio/src/main/assets/editor.page') -Force
Checked (Join-Path $bt 'aapt2.exe') @('link','-o',$unsigned,'--manifest',$manifest,'-I',$platform,'-A',(Join-Path $root 'app/src/main/assets'),'-A',(Join-Path $root 'studio/src/main/assets'),'-0','wav','-0','wasm','-0','zip','-0','js','-0','mjs','-0','html','-0','css','-0','page','-0','gz','--min-sdk-version','23','--target-sdk-version','34','--version-code',$VersionCode,'--version-name',$VersionName,$resources)
Checked (Join-Path $JdkRoot 'bin/jar.exe') @('uf',$unsigned,'-C',$dex,'classes.dex')
# aapt2 on Windows writes nested assets as assets/studio\style.css; Android reads
# entry names literally, so normalize the stored names before alignment/signing.
$python=(Get-Command python -ErrorAction Stop).Source
Checked $python @((Join-Path $root 'tools/normalize-apk-assets.py'),$unsigned)
$aligned=Join-Path $work 'aligned.apk'
Checked (Join-Path $bt 'zipalign.exe') @('-f','4',$unsigned,$aligned)
$key=if($SigningKey){[IO.Path]::GetFullPath($SigningKey)}else{Join-Path $root 'build/manual/debug.keystore'}
if(-not (Test-Path -LiteralPath $key)){throw 'Original development key is missing. Reuse your original signing key for an in-place upgrade.'}
$name=if($ParallelInstall){"Ember-Studio-$VersionName-parallel.apk"}else{"Ember-Studio-$VersionName.apk"}
$apk=Join-Path $dist $name
Checked $java @('-jar',(Join-Path $bt 'lib/apksigner.jar'),'sign','--ks',$key,'--ks-pass','pass:android','--key-pass','pass:android','--out',$apk,$aligned)
Remove-Item -LiteralPath ($apk + '.idsig') -ErrorAction SilentlyContinue
Checked $java @('-jar',(Join-Path $bt 'lib/apksigner.jar'),'verify','--verbose','--print-certs',$apk)
Checked (Join-Path $bt 'zipalign.exe') @('-c','4',$apk)
Checked (Join-Path $bt 'aapt.exe') @('dump','badging',$apk)
Checked $python @((Join-Path $root 'tools/verify_support.py'),'--merge-checksums',(Join-Path $dist 'STUDIO-SHA256SUMS.txt'),"Ember-Studio-$VersionName.apk","Ember-Studio-$VersionName-parallel.apk")
Write-Output "Studio APK ready: $apk"
