param([string]$SdkRoot = $env:ANDROID_HOME, [string]$JdkRoot = $env:JAVA_HOME, [switch]$ParallelInstall)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$gradleText = [IO.File]::ReadAllText((Join-Path $projectRoot 'app\build.gradle'))
if ($gradleText -notmatch 'versionCode\s+(\d+)') { throw 'Cannot parse versionCode from app/build.gradle' }
$VersionCode = $Matches[1]
if ($gradleText -notmatch "versionName\s+'([^']+)'") { throw 'Cannot parse versionName from app/build.gradle' }
$VersionName = $Matches[1]
if (-not $SdkRoot) { $SdkRoot = 'D:\AndroidTools\android-sdk' }
if (-not $JdkRoot) { $JdkRoot = 'C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot' }
$platformJar = Join-Path $SdkRoot 'platforms\android-34\android.jar'
$pythonCmd = (Get-Command python -ErrorAction SilentlyContinue)
if (-not $pythonCmd) { $pythonCmd = Get-Command python3 -ErrorAction Stop }
& $pythonCmd.Source (Join-Path $projectRoot 'tools\package_preflight.py') --root $projectRoot
if ($LASTEXITCODE -ne 0) { throw 'Package preflight failed' }
$buildTools = (& $pythonCmd.Source (Join-Path $projectRoot 'tools\verify_support.py') --sdk-root $SdkRoot --print-build-tools).Trim()
if ($LASTEXITCODE -ne 0 -or -not $buildTools) { throw 'Cannot select a complete build-tools directory' }
$javac = Join-Path $JdkRoot 'bin\javac.exe'
$java = Join-Path $JdkRoot 'bin\java.exe'
$jar = Join-Path $JdkRoot 'bin\jar.exe'
$keytool = Join-Path $JdkRoot 'bin\keytool.exe'
foreach ($required in @($platformJar, $javac, (Join-Path $buildTools 'aapt2.exe'))) { if (-not (Test-Path -LiteralPath $required)) { throw "Missing build dependency: $required" } }
$work = Join-Path $projectRoot 'build\manual'
$classes = Join-Path $work 'classes'
$dex = Join-Path $work 'dex'
$output = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Force -Path $classes,$dex,$output | Out-Null
function Invoke-Checked([string]$Exe, [string[]]$NativeArgs) { & $Exe @NativeArgs; if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $Exe" } }
$sources = @((Get-ChildItem -LiteralPath (Join-Path $projectRoot 'core\src\main\java') -Filter '*.java' -Recurse).FullName) + @((Get-ChildItem -LiteralPath (Join-Path $projectRoot 'app\src\main\java') -Filter '*.java' -Recurse).FullName)
Invoke-Checked $javac (@('-encoding','UTF-8','--release','8','-classpath',$platformJar,'-d',$classes) + $sources)
$bytecode = Join-Path $work 'classes.jar'
Invoke-Checked $jar @('cf',$bytecode,'-C',$classes,'.')
Invoke-Checked $java @('-cp',(Join-Path $buildTools 'lib\d8.jar'),'com.android.tools.r8.D8','--lib',$platformJar,'--min-api','23','--output',$dex,$bytecode)
$resources = Join-Path $work 'resources.zip'
Invoke-Checked (Join-Path $buildTools 'aapt2.exe') @('compile','--dir',(Join-Path $projectRoot 'app\src\main\res'),'-o',$resources)
$unsigned = Join-Path $work 'unsigned.apk'
$manualManifest = Join-Path $work 'AndroidManifest.xml'
$applicationId = if ($ParallelInstall) { 'cn.wuziping.ember.preview07' } else { 'cn.wuziping.ember' }
$manifestText = [IO.File]::ReadAllText((Join-Path $projectRoot 'app\src\main\AndroidManifest.xml')).Replace('<manifest ', "<manifest package=`"$applicationId`" ")
if ($ParallelInstall) { $manifestText = $manifestText.Replace('android:label="伍子平 · 星火远征"', 'android:label="伍子平 · 星火远征 0.7试玩"') }
[IO.File]::WriteAllText($manualManifest, $manifestText, [Text.UTF8Encoding]::new($false))
Invoke-Checked (Join-Path $buildTools 'aapt2.exe') @('link','-o',$unsigned,'--manifest',$manualManifest,'-I',$platformJar,'-A',(Join-Path $projectRoot 'app\src\main\assets'),'-0','wav','--min-sdk-version','23','--target-sdk-version','34','--version-code',$VersionCode,'--version-name',$VersionName,$resources)
Invoke-Checked $jar @('uf',$unsigned,'-C',$dex,'classes.dex')
$aligned = Join-Path $work 'aligned.apk'
Invoke-Checked (Join-Path $buildTools 'zipalign.exe') @('-f','4',$unsigned,$aligned)
$keystore = Join-Path $work 'debug.keystore'
if (-not (Test-Path -LiteralPath $keystore)) { Invoke-Checked $keytool @('-genkeypair','-keystore',$keystore,'-storetype','JKS','-storepass','android','-keypass','android','-alias','androiddebugkey','-keyalg','RSA','-keysize','2048','-validity','10000','-dname','CN=WuziPing Development, O=Student Project, C=CN') }
$apk = Join-Path $output $(if ($ParallelInstall) { "WuziPing-Emberbound-$VersionName-parallel-debug.apk" } else { "WuziPing-Emberbound-$VersionName-debug.apk" })
Invoke-Checked $java @('-jar',(Join-Path $buildTools 'lib\apksigner.jar'),'sign','--ks',$keystore,'--ks-pass','pass:android','--key-pass','pass:android','--out',$apk,$aligned)
Invoke-Checked $java @('-jar',(Join-Path $buildTools 'lib\apksigner.jar'),'verify','--verbose',$apk)
Invoke-Checked (Join-Path $buildTools 'zipalign.exe') @('-c','4',$apk)
Invoke-Checked (Join-Path $buildTools 'aapt.exe') @('dump','badging',$apk)
$python = (Get-Command python -ErrorAction SilentlyContinue)
if (-not $python) { $python = Get-Command python3 -ErrorAction Stop }
& $python.Source (Join-Path $projectRoot 'tools\verify_support.py') --merge-checksums (Join-Path $output 'SHA256SUMS.txt') "WuziPing-Emberbound-$VersionName-debug.apk" "WuziPing-Emberbound-$VersionName-parallel-debug.apk"
if ($LASTEXITCODE -ne 0) { throw 'Checksum merge failed' }
Write-Output "APK ready: $apk"
