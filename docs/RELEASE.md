# 发行门槛与兼容

这里只说明怎么核对**已经提交的安装包**。这些命令不编译、不签名、不覆盖 `dist/`，也不改版本号。

产品版本以 Gradle 为准：游戏 `app/build.gradle`，天工 `studio/build.gradle`。当前源码是游戏 1.0（versionCode 1）和天工 0.4.2（versionCode 92）。升版本号、打 tag、发 GitHub Release 都不属于这条检查。

## 两条命令

开发检查。缺 Android SDK 或已发布包里仍有已知缺口时，退出码是 0，最后一行是 `EXIT: INCOMPLETE`。它不表示发行完成。

```bash
python3 tools/test_verify_support.py
python3 tools/verify-release.py
python3 tools/verify-studio-release.py
node tools/test-merged-ui.js
```

严格发行门槛。缺 `java`，或缺一套完整的 build-tools（`zipalign`、`aapt`、`lib/apksigner.jar`），或已发布包相对源码仍有记录在案的资源缺口时，退出码非零，最后一行是 `EXIT: FAIL`。Java 和 SDK 分开记：没有 JDK 不会被写成 apksigner 缺失，反过来也一样。

Build-tools 不必是 34.0.0。`--build-tools` 或环境变量 `ANDROID_BUILD_TOOLS` 指定版本，并且只使用该版本，不会改去找另一个已安装版本。两者都没写时，在 `--sdk-root`、否则 `ANDROID_HOME`、再否则 `ANDROID_SDK_ROOT` 下面，选用最高的完整版本。例如本机只有 `build-tools/36.1.0` 时就会用 36.1.0。

```bash
export ANDROID_HOME=/home/box/opt/android-sdk
python3 tools/verify-release.py --strict
python3 tools/verify-studio-release.py --strict
# 或者写死版本
python3 tools/verify-studio-release.py --sdk-root /home/box/opt/android-sdk --build-tools 36.1.0 --strict
```

天工 `dist/Ember-Studio-0.4.2.apk` 在工具齐全时，开发检查和严格模式都是 `EXIT: PASS`：`FAIL=0`、`SKIP=0`、`KNOWN=0`。共存包不在 `dist/` 时记为 NOTE，不因此失败。回退页 `assets/studio/editor.page` 与当前 `index.html` 一致，不再是 KNOWN。

游戏 Gradle 当前是 1.0（versionCode 1），入口脚本要找的是 `dist/WuziPing-Emberbound-1.0-debug.apk` 和共存包。这两个文件不在仓库里，`dist/SHA256SUMS.txt` 仍只有 0.7.1。因此游戏的开发检查和 `--strict` 都是硬失败：`FAIL` 不为 0，最后一行是 `EXIT: FAIL`。这不是「只有已知缺口」。非零的 `FAIL=` 表示缺包、校验和、坏包或工具实际跑失败，不能当成 KNOWN 放过。`SKIP=` 在工具齐全时可以是 0，不能为了旧的 34.0.0 路径去要求它一定出现。

0.7.1 那对包还在，`classes.dex` 里仍然没有 `HistoryJourney`，也没有五张残灯渡图。入口脚本只核对 Gradle 点名的当前包，不会改去核 0.7.1。游戏当前包要变成 `EXIT: PASS`，需要同时满足：

- 本机看得到 JDK，并且选定的 build-tools 里有 `zipalign`、`aapt`、`lib/apksigner.jar`
- `dist/` 里有 Gradle 点名的标准包和共存包，校验和一致，并且包含 `HistoryJourney` 和五张残灯渡图

逻辑回归是另一条命令，不计入上面的发行摘要：

```bash
export JAVA_HOME=/path/to/jdk-17
bash tools/verify-studio.sh
```

`tools/verify-desktop.sh` 还会重写截图和桌面 jar，跑之前先留出工作区。

网页测试需要依赖。接口临时构建也依赖它：

```bash
cd studio/web && npm ci && npm test && cd ../..
python3 tools/verify-interface-fix.py
python3 tools/verify-interface-fix.py --strict
```

没有 `studio/web/node_modules` 时，接口脚本的 bundle 同步是 SKIP。开发模式写 `EXIT: INCOMPLETE`；`--strict` 失败。

CI 工作流 `.github/workflows/verify-entrypoints.yml` 要求天工当前包的开发检查和 `--strict` 都是 `EXIT: PASS`，并且没有 FAIL、SKIP、KNOWN。游戏当前包不是这种结果时，游戏那一步以非零退出，不会把缺包写成已知缺口。

## 兼容矩阵

| 包 | 包名 | 和谁占同一个安装位 |
| --- | --- | --- |
| 游戏标准包 `WuziPing-Emberbound-<版本>-debug.apk` | `cn.wuziping.ember` | 天工标准包。后装的覆盖先装的。证书必须相同，否则系统拒绝覆盖。不要先卸载，否则 `journey-v1.bin` 和天工工作区会一起消失。 |
| 游戏共存包 `WuziPing-Emberbound-<版本>-parallel-debug.apk` | `cn.wuziping.ember.preview07` | 天工共存包。两者也互相覆盖。 |
| 天工标准包 `Ember-Studio-<版本>.apk` | `cn.wuziping.ember` | 游戏标准包。0.4.2 提交的是这一份。 |
| 天工共存包 `Ember-Studio-<版本>-parallel.apk` | `cn.wuziping.ember.preview07` | 游戏共存包。0.4.2 没有提交这个文件。严格模式把它记为 NOTE，不因此失败。 |

标准包和共存包使用同一张开发证书时才能各自覆盖自己的旧包。外部 0.6 是另一张证书，标准包盖不上去。

## 模拟器与 ABI

`studio/build.gradle` 去掉了 `lib/x86` 和 `lib/x86_64`。扫描模块的 ML Kit 原生库只留 ARM，用来减小真机包。已提交的天工 APK 沿用这个选择。

x86 或 x86_64 模拟器若没有 ARM 翻译，扫描相关的原生库加载不了。Gradle 注释写了：要在 x86 模拟器上试扫描，得临时去掉那段排除再重新构建。这条核对不负责重新构建。WebView 里的其他页面是否能打开，以实际模拟器结果为准。

## 已提交包里的已知缺口

这些缺口是对照已经提交的旧包读出来的，不是把检查放宽之后的结论。当前入口只核对 Gradle 点名的包。

- 游戏 `dist/WuziPing-Emberbound-0.7.1-debug.apk` 与共存包的 `classes.dex` 没有 `HistoryJourney`。源码和 `tools/tests/HistoryTests.java` 里有这个类。当前 Gradle 版本的安装包还不在 `dist/`，所以这条现在不会被入口脚本读到。
- 同一对 0.7.1 游戏包没有这五张图：`history_bandit.png`、`history_commander.png`、`history_ford.png`、`history_road.png`、`history_soldier.png`。它们在 `app/src/main/assets/`。包内已有的资源与源码一致；缺口是源码多出来的文件。
- 天工 `dist/Ember-Studio-0.3.18.apk` 的 `assets/studio/editor.page` 仍是旧页。当前 `dist/Ember-Studio-0.4.2.apk` 的回退页与 `index.html` 一致，入口不再把它记为 KNOWN。
- 没有选定完整 build-tools 时，`build-tools` 单独记为 SKIP，不把 Java 写成缺失。工具齐全、当前包又没有 FAIL 或 KNOWN 时，`--strict` 是 PASS。0.4.2 是这种结果。游戏 1.0 是因为安装包不在 `dist/` 而 FAIL。打包脚本 `tools/build-apk.sh` 和 `tools/build-studio.sh` 仍使用 Build-Tools 34.0.0 来产出新包；只读核验不下载 SDK，也不固定 34.0.0。
