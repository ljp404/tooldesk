# 截图区域录屏维护规则

截图区域录屏当前行为已经验证：无鼠标残影、蓝框持续可见、紧凑录屏任务栏可用。后续优化默认不要改动本流程，除非需求明确指向区域录屏、边框或残影问题。

## 正确流程

1. 截图选区后点工具栏“录屏”，进入录屏区域模式并保留 overlay 蓝框。
2. 打开紧凑录屏任务栏，此阶段不要销毁 overlay，也不要隐藏选区。
3. 点录屏任务栏“开始”后，采集期间仍保留紧凑录屏任务栏和 overlay 蓝框。
4. 停止或关闭录屏时，再统一清理 overlay 和相关窗口。

## 不要回退的行为

- 不要恢复独立 `recording-control` 浮窗，Windows 上容易产生残影。
- 不要在采集开始时销毁全屏 overlay，否则会导致开始录制后蓝框消失。
- 录屏准备态鼠标穿透不要使用会把事件继续转发到后方窗口的模式。
- 备用边框窗口只作为 overlay 不可用时的后备路径，不是主路径。
- 不要改回四条不透明小窗拼边框、单窗白底或类似已验证有白条/白底风险的方案。

## 相关入口

- `public/screenshot-overlay.js`
- `src-tauri/src/screenshot.rs`
- `src-tauri/src/screen_recorder.rs`
- `src/tools/screen-recorder/ScreenRecorder.vue`
