# 青柠浏览器构建要求

- 每次为青柠浏览器生成用于安装、交付或分发的 APK 时，默认且必须使用 **Release** 构建；只有用户明确要求 Debug 包时才可例外。
- 保持 Release 的 `isDebuggable = false`、`isMinifyEnabled = true` 和 `proguard-android-optimize.txt` 配置，以启用代码裁剪与优化，改善性能。
- 当前仅使用系统 WebView。FOSS 包使用 `:app:assembleFossRelease`，通用包使用 `:app:assembleGenericRelease`；所有发行渠道统一使用系统 WebView。按目标设备需要选择 ABI。
- 安装或交付前，确认 APK 为 Release、不可调试，并使用适当的签名。签名未配置或与设备现有安装不兼容时，说明问题并处理，不得自动退回 Debug 包，也不得为更换签名擅自卸载应用或清除用户数据。
- 单元测试等开发验证可以使用 Debug 变体，但用于安装、交付或分发的 APK 仍须遵循上述 Release 要求。
- 以后有代码更新时，必须同步更新 `README.md`，确保功能说明、使用方式、构建步骤和版本交付状态与实际代码一致；涉及小程序时，也需同步更新 `miniprogram/README.md` 中受影响的内容。
