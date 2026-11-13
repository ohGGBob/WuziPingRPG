# 发行门槛与兼容

这里只说明怎么核对**已经提交的安装包**。这些命令不编译、不签名、不覆盖 `dist/`，也不改版本号。

产品版本以 Gradle 为准：游戏 `app/build.gradle`，天工 `studio/build.gradle`。当前源码是游戏 0.7.1（versionCode 8）和天工 0.3.18（versionCode 58）。升版本号、打 tag、发 GitHub Release 都不属于这条检查。

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

在当前已提交的 0.7.1 / 0.3.18 包上，严格模式应当失败，摘要里的 `FAIL=` 必须是 0。非零的 `FAIL=` 表示校验和、坏包或工具实际跑失败，不能当成「只有已知缺口」放过。`SKIP=` 在工具齐全时可以是 0，不能为了旧的 34.0.0 路径去要求它一定出现。等以后的包同时满足下面两件事，严格模式才会变成 `EXIT: PASS`：

- 本机看得到 JDK，并且选定的 build-tools 里有 `zipalign`、`aapt`、`lib/apksigner.jar`
- 游戏包含 `HistoryJourney` 和五张残灯渡图；天工包里的 `assets/studio/editor.page` 与 `index.html` 一致

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

CI 工作流 `.github/workflows/verify-entrypoints.yml` 跑开发检查，并另外断言游戏和天工的 `--strict` 以非零退出。那一步变绿，只说明门槛还认得这些缺口，不说明发行包已经完整。

## 兼容矩阵

| 包 | 包名 | 和谁占同一个安装位 |
| --- | --- | --- |
| 游戏标准包 `WuziPing-Emberbound-<版本>-debug.apk` | `cn.wuziping.ember` | 天工标准包。后装的覆盖先装的。证书必须相同，否则系统拒绝覆盖。不要先卸载，否则 `journey-v1.bin` 和天工工作区会一起消失。 |
| 游戏共存包 `WuziPing-Emberbound-<版本>-parallel-debug.apk` | `cn.wuziping.ember.preview07` | 天工共存包。两者也互相覆盖。 |
| 天工标准包 `Ember-Studio-<版本>.apk` | `cn.wuziping.ember` | 游戏标准包。0.3.18 提交的是这一份。 |
| 天工共存包 `Ember-Studio-<版本>-parallel.apk` | `cn.wuziping.ember.preview07` | 游戏共存包。0.3.18 没有提交这个文件。严格模式把它记为 NOTE，不因此失败。 |

标准包和共存包使用同一张开发证书时才能各自覆盖自己的旧包。外部 0.6 是另一张证书，标准包盖不上去。

## 模拟器与 ABI

`studio/build.gradle` 去掉了 `lib/x86` 和 `lib/x86_64`。扫描模块的 ML Kit 原生库只留 ARM，用来减小真机包。已提交的天工 APK 沿用这个选择。

x86 或 x86_64 模拟器若没有 ARM 翻译，扫描相关的原生库加载不了。Gradle 注释写了：要在 x86 模拟器上试扫描，得临时去掉那段排除再重新构建。这条核对不负责重新构建。WebView 里的其他页面是否能打开，以实际模拟器结果为准。

## 已提交包里的已知缺口

这些缺口是对照现有 APK 读出来的，不是把检查放宽之后的结论。

- 游戏 `dist/WuziPing-Emberbound-0.7.1-debug.apk` 与共存包的 `classes.dex` 没有 `HistoryJourney`。源码和 `tools/tests/HistoryTests.java` 里有这个类。
- 同一对游戏包没有这五张图：`history_bandit.png`、`history_commander.png`、`history_ford.png`、`history_road.png`、`history_soldier.png`。它们在 `app/src/main/assets/`。包内已有的资源与源码一致；缺口是源码多出来的文件。
- 天工 `dist/Ember-Studio-0.3.18.apk` 的 `assets/studio/editor.page` 仍是旧页。`PackedAssets` 读取页面时先打开 `assets/studio/index.html`，那份与当前源码一致。回退页要等下一次打包才会更新。
- 没有选定完整 build-tools 时，`build-tools` 单独记为 SKIP，不把 Java 写成缺失。工具齐全时这一行是 PASS，`--strict` 仍会因为上面的 KNOWN 失败。打包脚本 `tools/build-apk.sh` 和 `tools/build-studio.sh` 仍使用 Build-Tools 34.0.0 来产出新包；只读核验不下载 SDK，也不固定 34.0.0。
