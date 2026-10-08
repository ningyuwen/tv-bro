# 青柠浏览器

面向 Android 电视和机顶盒的浏览器，基于 [TV Bro](https://github.com/truefedex/tv-bro) 开发。支持电视遥控器，也可以通过微信小程序在局域网内用手机控制浏览、输入文字和操作视频。

本分支使用独立名称、图标和包名：`org.limebrowser.tv`，FOSS 构建为 `org.limebrowser.tv.foss`。本分支不提供上游自动更新，避免安装包名和签名不兼容的原版 APK；上游许可与应用内署名保留。

## 功能

- **电视浏览**：遥控器操作、多标签、书签、历史记录、下载管理、语音搜索、快捷键和 User-Agent 切换。
- **网页内核**：统一使用设备的系统 WebView，浏览器不打包独立内核运行库。
- **手机遥控**：自动发现同一局域网内的盒子，电视首次确认授权后记住手机；支持多手机分别授权、自动重连和备用二维码配对。
- **触控与输入**：单指移动指针、轻点点击、双指滚动；发送网址、搜索词和网页输入文字，管理标签页。
- **菜单导航**：菜单和应用弹窗中滑动切换焦点、轻点确认，手机显示当前选中项并自动展开方向键；历史和下载页保持遥控连接。
- **视频与音量**：播放/暂停、前后 10 秒、拖动定位、全屏切换、清晰度选择，以及机顶盒媒体音量和静音控制。
- **常用网站**：手机端提供 YouTube、Bilibili、Netflix 入口，点击后在电视当前标签页打开。

视频控制能力取决于系统 WebView 和网页播放器，具体范围见下文。

## 快速开始

1. 在电视或机顶盒安装与设备 ABI 匹配、已签名的 Release APK，打开青柠浏览器。
2. 手机和盒子连接同一局域网，打开青柠遥控微信小程序。开发者可在微信开发者工具中导入 [`miniprogram/`](miniprogram/README.md)，入口为 `pages/remote/remote`；家庭体验版的成员配置见小程序说明。
3. 选择自动发现的盒子，首次在电视弹窗选择「允许并记住」。后续打开浏览器和小程序可自动重连，多台盒子会显示选择列表。
4. 用触控板浏览网页；输入网址或搜索词后点「打开 / 搜索」。发送文字到网页前，先点中电视网页上的输入框。

发现失败时可手动输入盒子地址，或在电视「设置 → 手机遥控」显示二维码并用小程序扫描。二维码需在此小程序内扫描，微信首页扫一扫不会自动打开小程序。

浏览器在前台时接受控制，主页面、历史和下载页之间切换保持连接；手机小程序或整个浏览器退到后台时断开，授权保留。切换普通/隐私模式需要重连。电视「设置 → 手机遥控 → 关闭手机控制」会关闭发现并清除全部手机授权。

## 兼容性与连接范围

| 项目 | 支持范围 |
| --- | --- |
| 系统版本 | Android 7.0 / API 24 及以上，页面兼容性取决于设备的 WebView 版本 |
| 视频进度 | 支持可访问的网页视频，定位能力取决于播放器 |
| 全屏切换 | 支持可访问的网页视频全屏切换 |
| 清晰度选择 | WebView 下支持 YouTube 网页播放器、暴露接口的 HLS.js、带 `qualityLevels()` 的 Video.js，以及明确标注分辨率的 MP4/WebM 视频源 |
| 音量 | 控制盒子的系统媒体音量，与内核无关；固定音量或外接音响控制的设备可能不可调节 |
| 微信基础库 | TCP 至少 2.18.0，UDP 广播发现至少 2.24.0；项目配置为 3.10.0 |

跨域 iframe、封闭 Shadow DOM、网站专用播放器或网站全屏限制可能使部分控制不可用。YouTube 清晰度适配依赖其内部网页接口，网站改版后可能需要维护；Bilibili、Netflix 目前提供网站入口，尚未加入专用清晰度适配。网站能否访问和播放取决于电视网络、播放器兼容性及账号要求。

手机遥控使用 TCP `8877` 和 UDP `8878`，无需服务器、云端账号或 AppSecret，也不需要 ADB、辅助功能或电脑中转。通信为未加密的局域网 TCP，适用于可信家庭网络，不提供公网控制。访客 Wi-Fi、AP 隔离或不同子网可能阻断发现与连接；iOS 需允许微信访问本地网络。

## 构建 Release APK

准备 Java 21（Gradle 运行时）、Java 17（`buildSrc` 编译工具链）、Android SDK Platform 36 和 Build Tools 36.0.0。在本机 `local.properties` 中配置 `sdk.dir`，首次构建需联网下载依赖。JDK 17 位于非标准路径时，可附加 `-Porg.gradle.java.installations.paths=/path/to/jdk17`。

新 Git 工作树不会复制被忽略的 `.local/` 和 `local.properties`。可以复用原项目已有的 JDK 与 SDK，在当前工作树重新配置 `local.properties`，并在构建终端设置 `JAVA_HOME=/path/to/jdk21`、将 `$JAVA_HOME/bin` 加入 `PATH`。macOS 的 `/usr/bin/java` 可能只是系统启动器，不能仅凭该命令存在判断 JDK 已配置；构建前用 `$JAVA_HOME/bin/java -version` 确认。

`generic`（普通包）、`google` 和 `foss` 是发行渠道选项；当前代码中的功能和依赖一致，均不提供上游自动更新，`foss` 额外添加 `.foss` 包名后缀，版本页会显示所选渠道。所有渠道仅使用系统 WebView；发行渠道与 Release / Debug 构建类型相互独立。

安装、交付和分发默认且必须使用 **Release**，除非用户明确要求 Debug 包。Release 保持 `isDebuggable = false`、`isMinifyEnabled = true` 和 `proguard-android-optimize.txt`，完整要求见 [AGENTS.md](AGENTS.md)。

构建前通过环境变量配置签名：`KEYSTORE_PATH`（建议绝对路径）、`KEYSTORE_PASSWORD`、`KEY_ALIAS`、`KEY_PASSWORD`。未配置 `KEYSTORE_PATH` 时会生成未签名 Release APK，不能直接用于安装或分发。

```sh
# 系统 WebView FOSS Release
./gradlew :app:assembleFossRelease -PenableAbiSplits

# 通用 Release
./gradlew :app:assembleGenericRelease -PenableAbiSplits
```

`-PenableAbiSplits` 分别输出 `armeabi-v7a`、`arm64-v8a`、`x86_64` APK，按设备 ABI 选择。极光 A4111 使用 `armeabi-v7a`。

- FOSS 输出：`app/build/outputs/apk/foss/release/`
- 通用输出：`app/build/outputs/apk/generic/release/`

所有渠道统一使用系统 WebView，不提供内核选择。在同包名版本升级时，旧内核的内部会话缓存会丢弃并按原网址重新加载；标签页、书签和历史记录保留，网站可能需要重新登录。此逻辑不提供跨包名数据迁移。

安装前确认 APK 为 Release、不可调试且签名正确。覆盖安装必须与设备上已有应用的签名兼容；签名缺失或不兼容时应处理签名问题，不自动退回 Debug，不擅自卸载应用或清除用户数据。

本次包名调整去除了个人姓名。新包按全新应用安装，不迁移旧包的浏览数据、设置或手机授权；手机小程序首次连接新包时需在电视上重新允许。使用新版时先退出或停止旧版，避免两者争用遥控端口。

## 开发验证

在仓库根目录执行：

```sh
# Android 单元测试：Debug 变体仅用于开发验证
./gradlew :app:testFossDebugUnitTest :app:common:testDebugUnitTest

# 网页注入脚本与小程序协议、连接、手势和控制逻辑测试，需要 Node.js
node --test app/src/test/js/*.test.cjs miniprogram/tests/*.test.js

# 网页滚动集成测试，需另行准备 Playwright 和 Chromium
# 可通过 CHROME_PATH 指定系统 Chrome 可执行文件
node --test miniprogram/tests/browser/scroll.test.cjs
```

## 当前状态

已删除旧上游更新清单、下载地址、更新检查与安装流程、隐藏的更新设置，以及废弃内核的构建说明和对照报告。仅保留旧标签格式识别及迁移测试，避免旧会话数据影响恢复；相关历史变更可在 Git 记录中查阅。浏览器更新需安装本项目已签名的 Release APK。本次清理后 FOSS Release 构建成功，57 项 Android 测试通过、1 项原有测试跳过；ARMv7 APK 的签名和不可调试检查通过，未安装到电视。

当前源码仅使用系统 WebView，并保留主分支的连接、滚动和按钮反馈修复。包名为 `org.limebrowser.tv`（FOSS：`org.limebrowser.tv.foss`），不提供跨包名数据迁移；版本号仍为 0.1.8（76）。本地通过环境变量配置签名完成 FOSS Release 构建，ARMv7、ARM64、x86_64 输出均已生成；ARMv7 APK 不可调试、签名验证通过，尚未安装到电视或作为新版本交付。合并后验证：96 项 JavaScript 测试、57 项 Android 测试通过，1 项原有 Android 测试跳过。下述 0.1.9 交付记录属于更名和单内核改造之前的版本。

截至 **2026-10-09**，最新交付版本为 **0.1.9（versionCode 77）**。该版本ARMv7 Release 已覆盖安装到极光 A4111，签名兼容、不可调试，并保留原数据与手机授权；微信开发者工具于 02:21 确认小程序 0.1.9 上传成功并覆盖现有体验版。

0.1.9 包含清晰度按钮布局、连接拥塞、双指滚动方向、按钮联动闪烁和网页脚本重复注入修复。原模拟器授权重连与盒子音量同步已验证，手机触控手感仍待实际使用验收。退出并重新打开手机体验版即可加载新版，无需重新配对。

0.1.9 的[交付提交 `f57f3dc`](https://github.com/ningyuwen/tv-bro/commit/f57f3dc28f4a52109b711fef6447bd9f85b949cf)位于 `codex/update-0.1.9` 分支，包含对应版本号与两端部署记录。当前工作区仍基于该提交之前的 0.1.8 源码；构建 0.1.9 时应使用包含该交付提交的代码。

## 文档与上游

- [手机遥控说明](PHONE_REMOTE.md)：连接、授权、协议、功能限制与验证记录。
- [微信小程序说明](miniprogram/README.md)：导入、体验版配置、使用方法与版本交付记录。
- [构建要求](AGENTS.md)：Release、优化、签名及覆盖安装约束。
- [许可证](LICENSE.md)与[上游隐私政策](PRIVACY.md)。
- [上游 TV Bro](https://github.com/truefedex/tv-bro)及[上游讨论区](https://forum.xda-developers.com/android/apps-games/tv-bro-browser-android-based-tvs-t3545295)。

遥控文档与小程序说明包含按日期保留的历史记录，早期行为和构建方式以当前源码及构建要求为准。继续分发修改版时，请遵守仓库许可证中关于独立名称、图标、包名和应用内上游署名的要求。
