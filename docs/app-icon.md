# AgentDock 应用图标

2026-10-20 按用户提供的黑银玻璃参考图更新。五条对称声波对应产品的 AI 语音拨号功能；石墨金属底板、烟色玻璃球和香槟白高光用于应用图标。菜单栏只使用五条声波的透明单色模板。

## 源文件与导出

- `assets/brand/AgentDock-generated.png`：内置 imagegen 原始图，1254 × 1254 RGBA。
- `assets/brand/AgentDock-1024.png`：裁取主体并对齐为标准 macOS 824 × 824 连续超椭圆（四周 100px 透明边距、无外圈残留 alpha）的 1024 × 1024 RGBA 母图。
- `assets/brand/prompt.txt`：实际生成提示词与来源说明。
- `assets/brand/tray-symbol.svg`：可编辑的菜单栏声波源图。
- `src-tauri/icons/`：Tauri 配置引用的 PNG、macOS ICNS、Windows ICO 及 Windows Store 图标。

在项目根目录执行 `npm run icons` 重新导出。脚本调用当前安装的 Tauri CLI，在临时目录生成后仅复制桌面资源；不把移动端资源加入仓库。菜单栏导出为 `tray-template.png`，44 × 44 RGBA。

`src-tauri/src/lib.rs` 的 `build_tray` 在 macOS 下嵌入声波模板并启用 `icon_as_template(true)`，由系统适配明暗菜单栏。其他桌面平台使用彩色应用图标。

## 验证边界

- 已目视检查 256px、32px 应用图标及菜单栏模板。
- 已核验 1024px 母图的 RGBA、ICNS 可解包，以及 ICO 的 16/24/32/48/64/256px 六档尺寸。
- `npm run build` 和 `cargo check --offline` 均通过。Rust 检查显式使用本机已有的 1.97.1 工具链及对应 rustc，未修改系统工具链或项目依赖。
- 已通过 macOS `NSWorkspace.shared.icon(forFile:)` 实测验证打包后的 `AgentDock.app` 图标渲染：符合 Apple 824 × 824 continuous squircle 规范，不会触发 macOS 26 (Tahoe) 的灰白边框底座（Squircle Jail）。
