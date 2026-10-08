# TV Bro

Simple web browser optimized to use with TV remote

Features:
- working with TV remote
- tabs and bookmarks support
- voice search support
- switch user agent support
- use Android builtin web rendering engine (WebKit/Blink based)
- built-in download manager
- browsing history
- shortcuts

Discussion pages:
- https://forum.xda-developers.com/android/apps-games/tv-bro-browser-android-based-tvs-t3545295

## 青柠浏览器个人分支

本分支新增机顶盒与微信小程序之间的局域网手机遥控。使用方法、构建与协议见 [PHONE_REMOTE.md](PHONE_REMOTE.md)，小程序代码位于 [miniprogram](miniprogram/README.md)。改造版有独立名称、图标和包名，保留上游许可与署名。


## 单内核构建与升级

青柠浏览器已移除 GeckoView，实现、依赖、扩展和内核切换设置均不再保留，统一使用设备的系统 WebView。最低支持 Android 7.0 / API 24。页面兼容性取决于设备的 WebView 版本，浏览器 APK 不包含独立 Chromium 运行库。

升级后，旧内核选择偏好不再生效。旧 Gecko 标签的内部会话缓存会丢弃，按原网址重新加载；标签页、书签和历史记录保留。Gecko 的网站登录态无法转换成 WebView 登录态。

安装、交付及分发统一使用 Release，启用代码裁剪和优化，保持不可调试，签名要求见 [AGENTS.md](AGENTS.md)。准备 Java 21、Java 17 工具链和 Android SDK 36，并通过 `KEYSTORE_PATH`、`KEYSTORE_PASSWORD`、`KEY_ALIAS`、`KEY_PASSWORD` 配置签名。

```sh
# FOSS Release，按设备 ABI 生成安装包
./gradlew :app:assembleFossRelease -PenableAbiSplits
# 开发验证
./gradlew :app:testFossDebugUnitTest
```

FOSS 输出位于 `app/build/outputs/apk/foss/release/`，极光 A4111 使用 `armeabi-v7a`。通用版本使用 `:app:assembleGenericRelease`。旧的 `GeckoIncluded`/`GeckoExcluded` 构建任务已删除；需要保留原应用数据时，使用相同包名和兼容签名覆盖安装，不能为签名冲突卸载或清除数据。
