# 青柠浏览器构建要求

- 每次为青柠浏览器生成用于安装、交付或分发的 APK 时，默认且必须使用 **Release** 构建；只有用户明确要求 Debug 包时才可例外。
- 保持 Release 的 `isDebuggable = false`、`isMinifyEnabled = true` 和 `proguard-android-optimize.txt` 配置，以启用代码裁剪与优化，改善性能。
- 当前仅使用系统 WebView。FOSS 包使用 `:app:assembleFossRelease`，通用包使用 `:app:assembleGenericRelease`；所有发行渠道统一使用系统 WebView。按目标设备需要选择 ABI。
- 安装或交付前，确认 APK 为 Release、不可调试，并使用适当的签名。签名未配置或与设备现有安装不兼容时，说明问题并处理，不得自动退回 Debug 包，也不得为更换签名擅自卸载应用或清除用户数据。
- 单元测试等开发验证可以使用 Debug 变体，但用于安装、交付或分发的 APK 仍须遵循上述 Release 要求。
- 以后有代码更新时，必须同步更新 `README.md`，确保功能说明、使用方式、构建步骤和版本交付状态与实际代码一致；涉及小程序时，也需同步更新 `miniprogram/README.md` 中受影响的内容。

## Frida 动态 hook 调试

- Frida 动态 hook 是本项目长期可用的调试手段。遇到难以通过源码、日志或常规调试定位的问题时，可以主动使用 Frida 观察运行时行为，无需为采用该调试手段重复征求许可。
- 使用前检查目标设备连接、应用包名与进程、设备 ABI、Frida 客户端与设备端版本兼容性，以及设备端运行和附加进程所需的权限；根据实际环境选择 frida-server 或 Frida Gadget，不假设设备已 root 或已部署 Frida。
- 按问题需要 hook Java/Kotlin 方法、JNI/native 调用或系统 WebView 相关调用，优先记录参数、返回值、调用栈和事件顺序；若需要修改返回值或运行时行为，应明确记录修改范围，并区分原始行为与 hook 后的行为。
- 将可复用的 hook 脚本及操作说明保存在项目的 `tools/frida/` 目录中，记录适用包名、版本、ABI、启动/附加命令、复现步骤及观察结果；日志避免保留密码、令牌等敏感数据。新增脚本或改变调试流程时同步更新 `README.md`。
- Frida 调试仍须遵守上述 Release 构建、签名和数据保留要求；不得为了 hook 自动改用 Debug 安装包、擅自卸载应用或清除用户数据。若需重打包或嵌入 Gadget，先核对签名及覆盖安装兼容性；调试注入不得混入正式交付包。
- 调试结束后停止本次 Frida 会话并撤销临时运行时修改；修复应在未启用 hook 的正常环境中复验，不能仅以 hook 后的表现作为修复成功的依据。
