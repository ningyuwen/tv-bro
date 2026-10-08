# 青柠浏览器：WebView 与 GeckoView 实机对比

历史对照记录：后续代码已按用户要求移除 GeckoView，仅使用系统 WebView；本文保留移除前的原始测试结果。

测试日期：2026-10-09。结论仅适用于本次设备、青柠当前接入方式和样本。

## 建议

根据这份隔离副本测试，这台设备继续使用 WebView 作为默认内核，保留 GeckoView 供个别不兼容网站切换。当前样本没有证明 GeckoView 带来足以抵消内存开销的收益；它对一个 1080p 视频样本还存在可重复的播放异常。因此目前不建议默认切换 GeckoView，也没有足够证据支持投入独立 Chromium 改造。

WebView 83 仍需关注版本更新。本次测试评估运行表现，未评估安全性；若有厂商支持、签名兼容的 WebView 或系统更新，应优先在可恢复条件下验证。

## 环境与方法

- 设备：XiaoPaiTech A4111，Android 11/API 30，32 位 armeabi-v7a；物理显示 1920×1080，网页视口均为 960×540。
- WebView：com.android.webview 83.0.4103.120；GeckoView：147.0.4.20260212191108 release。
- 测试基线：青柠 0.1.8 / versionCode 76，源码 5144692，包含本轮 generic_injects.js 修复。收尾核对时设备正式应用为 0.1.9 / versionCode 77，未覆盖或回退该正式版本。数值来自本工作区的隔离副本，不代表对 0.1.9 的逐项复验；当前主干仍声明相同 GeckoView 依赖版本，主要新增手机远程滚动路径，本测试未覆盖该路径。
- 单独安装相同业务代码的双内核 Release 诊断副本，包名 cn.ningyuwen.limebrowser.enginebench.foss；R8/minify 开启、不可调试、ARMv7。诊断接口只存在于副本，未加入正式源码/正式 APK。
- 两种内核均保持一个标签页、同一自定义首页、自动播放开启、广告过滤关闭、内核调试关闭；每次切换内核后重启进程并预热一次。
- 通过 ADB reverse 访问相同本地 HTTP 内容，资源 no-store。240 张内容卡片、1934 个 DOM 节点；滚动 6 秒，下行 4000 CSS 像素再返回。首轮各 3 次，末尾各复测一次。
- 冷启动为停止进程后启动；未清除磁盘缓存或应用数据。表中的页面 load 为 Navigation Timing，**不包括此前的原生初始化**。am start -W 的 TotalTime 仅表示 Activity 显示，也不等于整个网页可用时间。复测冷启动各 3 次用于结论，首轮冷启动保留作原始证据；首轮 Gecko 诊断截图/日志采集与部分加载重叠，因此未选作主要冷启动结果。
- 内存使用 dumpsys meminfo --package 汇总 TOTAL PSS，包含主进程、关联隔离 WebView 渲染进程、Gecko 内容/GPU/媒体/崩溃助手等。统计的是当前完整浏览器实现的开销；Gecko 模式也存在关联 WebView 辅助进程。复测三次快照为同一阶段连续观测，不是三个独立样本。
- 视频：相同本地 H.264 Main 1920×1080/30fps、30 秒无音轨样本，每次观察 18 秒、重复 3 次；异常出现后，用普通 960×540 flower.mp4 复测，并按 0.5/1.5/3/6.5 秒采样播放时间和帧数。
- 公网：首页各访问两次并采集页面状态、文字、图片、截图。使用各内核原生 UA；服务端内容、缓存、网络会不同，公网耗时不用于纯内核排名。

## 主要结果

| 指标 | WebView 83 | GeckoView 147 |
|---|---:|---:|
| 冷进程启动后的页面 load 中位数（复测各 3 次） | 0.91 秒 | 2.54 秒 |
| 进程存活时新导航 load 中位数（首轮各 3 次） | 0.78 秒 | 0.82 秒 |
| 新导航 load 中位数（反向复测各 3 次） | 0.66 秒 | 0.73 秒 |
| 内容页总 PSS 中位数（复测各 3 次快照） | 158 MiB | 471 MiB |
| 六秒滚动回调间隔 P95（首轮 3 次的中位数） | 16.68 毫秒 | 16.70 毫秒 |
| 1080p 视频（18 秒观察，重复 3 次） | 正常推进，约 17.6～17.8 秒媒体时间 | 3 次均提前结束，只报告 4 帧 |
| 普通 540p 视频复测 | 正常播放 | 正常播放 |
| 百度、腾讯新闻、哔哩哔哩首页（各 2 次） | 均可打开 | 均可打开 |

滚动记录的是 requestAnimationFrame 回调间隔，并非屏幕实际呈现帧率。首轮两种内核各三次均未记录到超过 50 毫秒的回调间隔；本样本未发现明显滚动差距。

1080p 的 Gecko 异常不能解释成“掉帧率为零、所以流畅”：时间线复测中，约 0.2 秒处停住，约 6 秒后直接到 30 秒结束，totalVideoFrames 仅为 4。普通 flower.mp4 能正常播完，说明异常有样本/解码路径相关性，尚未定位到编码特征、驱动或接入代码；不能推广为所有 Gecko 视频都不可用。

## 操作复测

**WebView**

- pause：paused=True，fullscreen=False，currentTime=1.735。
- resume：paused=False，fullscreen=False，currentTime=2.522。
- fullscreen：paused=False，fullscreen=True，currentTime=3.876。
- 原生全屏命令返回：`{"kind": "flower-fullscreen", "host_at": 1791484703.509601, "engine": "WebView", "response": {"fullscreen": true}}`。
- 遥控：预热两次确定，再分别实际按住下/右/上/左各 400ms、每次按确定。收到 5 次点击，坐标 [(480, 270), (480, 388), (575, 388), (575, 263), (458, 263)]。

**GeckoView**

- pause：paused=False，fullscreen=False，currentTime=2.148。
- resume：paused=False，fullscreen=False，currentTime=3.281。
- fullscreen：paused=False，fullscreen=False，currentTime=4.532。
- 原生全屏命令返回：`{"kind": "flower-fullscreen", "host_at": 1791484778.11218, "engine": "GeckoView", "error": "{'error': 'fullscreen_unsupported'}"}`。
- 遥控：重试时先触碰内容取得焦点，再分别实际按住下/右/上/左各 400ms、每次按确定。收到 5 次点击，坐标 [(480, 270), (480, 388), (606, 388), (606, 265), (478, 265)]。方向移动和确认可用；未据此证明初始焦点行为与 WebView 完全相同。

本次普通视频样本中，Gecko 的青柠播放/暂停入口未将 paused 切换为 true；解除 muted、音量设为 0.01 后仍未观察到暂停。其实现依赖媒体会话，尚未定位会话激活或其他原因，不能推断全部网站均失效。全屏返回 fullscreen_unsupported 的原因已在代码确认：Gecko 没有实现青柠的 toggleFullscreen 入口，继承了公共接口的失败返回；这不是对 Gecko 网页 Fullscreen API 的否定。

遥控收尾一轮中，测试脚本在全屏未成功时仍发送 Back，导致副本退出，随后按键落到电视桌面并打开会员页面，未付款。该轮作废，已添加前台校验并重新完成上述 Gecko 遥控项；不能将这个脚本问题算成内核崩溃或丢键。

瞬时 ADB keyevent/--longpress 不能可靠模拟这份应用的持续移动，因此另用 shell InputManager 注入真实分离的按下/松开。第一轮 Gecko 6 次确定收到 5 次、WebView 6 次全收到；该结果可能受初始焦点/指针激活影响，以上持续按键复测用于判断操作能力，不将单次遗漏推断为稳定的内核丢键率。

## 公网页面记录

| 网站 | 内核 | 两次 load 毫秒 | 页面检查 |
|---|---|---|---|
| baidu | WebView | [1748, 1344] | complete, 7/7 图片；complete, 23/23 图片 |
| baidu | GeckoView | [1884, 1538] | complete, 7/7 图片；complete, 25/25 图片 |
| qq | WebView | [1944, 1146] | complete, 3/4 图片；complete, 3/4 图片 |
| qq | GeckoView | [1434, 1026] | complete, 3/4 图片；complete, 3/4 图片 |
| bilibili | WebView | [4434, 3652] | complete, 12/12 图片；complete, 12/12 图片 |
| bilibili | GeckoView | [2852, 2448] | complete, 10/12 图片；complete, 10/12 图片 |

腾讯、哔哩哔哩分别跳转移动站；部分图片可能为延迟加载。仅验证首页，未登录、付费、播放平台受保护内容或测试 4K/DRM/音画同步，也未进行长期稳定性或功耗测试。两个内核的真实网站内容并不完全相同，因此不能据这张表宣称某内核整体更快。

测试前后温控状态快照均为 0，SoC 温度约 53～54℃；未连续采样，不能排除所有瞬时温度影响。

## 恢复情况

已移除诊断副本、ADB reverse 和设备临时输入程序，停止本地测试服务器。已重新打开设备的正式青柠浏览器 0.1.9；未卸载正式应用、清除其数据或切换其内核设置。正式 APK 输出已恢复，并通过 SHA-256 与测试前保存文件一致性检查。

## 原始证据与复现

- [结构化汇总](/Users/aduning/.codex/worktrees/f9c3/tv-bro/.local/engine-benchmark/results/summary.json)
- [网页原始事件](/Users/aduning/.codex/worktrees/f9c3/tv-bro/.local/engine-benchmark/results/page-events.jsonl)
- [主机操作与进程内存事件](/Users/aduning/.codex/worktrees/f9c3/tv-bro/.local/engine-benchmark/results/host-events.jsonl)
- [表格数据](/Users/aduning/.codex/worktrees/f9c3/tv-bro/.local/engine-benchmark/results/page-metrics.csv)
- [受控测试脚本](/Users/aduning/.codex/worktrees/f9c3/tv-bro/.local/engine-benchmark/runner.py)
- [视频及遥控复测](/Users/aduning/.codex/worktrees/f9c3/tv-bro/.local/engine-benchmark/recheck.py)
- [前台保护及最终操作复测](/Users/aduning/.codex/worktrees/f9c3/tv-bro/.local/engine-benchmark/final-controls.py)
- [公网测试脚本](/Users/aduning/.codex/worktrees/f9c3/tv-bro/.local/engine-benchmark/public-sites.py)

原始截图、每阶段 meminfo 与温度记录位于 /Users/aduning/.codex/worktrees/f9c3/tv-bro/.local/engine-benchmark/results。正式采样前诊断副本曾有接收器配置错误，已修复；该阶段不是内核稳定性采样。
