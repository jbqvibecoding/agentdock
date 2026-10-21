# 参与贡献 · Contributing

欢迎提 Issue 和 PR。AgentDock 以 [MIT 协议](LICENSE) 开源，提交的代码同样按 MIT 授权。

## 开发环境

需要 macOS（首发平台）、Rust stable（1.80+）、Node 20+。

```bash
npm install
npm run tauri dev        # 开发模式
npm run signing          # 可选：本机固定签名，辅助功能授权在重新打包后不丢
npm run build:mac        # 签名打包 .app / .dmg
```

## 提交前

```bash
npm run build                                          # 前端类型检查 + 打包
cd src-tauri && cargo test                             # Rust 单元测试
npx vite --port 1420 & python3 tests/e2e_mock.py       # 浏览器 E2E（可选）
```

CI 会在每个 PR 上跑前两项。

## 最常见的贡献：修驱动

各家界面改版后，呼叫 / 挂断 / 闭麦的按钮会变。驱动是数据，在 [`src-tauri/drivers/*.json`](src-tauri/drivers)：

- 网页型席位用 CSS 选择器；桌面 App 型（Grok Bot、ChatGPT）用 `AXRole[标题]` 形式的辅助功能选择器。
- 改完把 `version` 加一；在真机上确认能接通、挂断后再把 `verified` 改成 `true`。
- PR 里写清楚产品版本、界面语言和验证方式。

## 约定

- 提交信息用 `feat:` / `fix:` / `docs:` / `ci:` 等前缀，说明「为什么」。
- 不要提交任何密钥、Cookie 或个人数据。EverOS 的 key 只从环境变量读取。
- 安全问题请不要公开提 Issue，先通过 GitHub 私信或邮件联系维护者。

---

Issues and PRs are welcome. AgentDock is [MIT-licensed](LICENSE); contributions are accepted under the same license. Run `npm run build` and `cargo test` (in `src-tauri`) before opening a PR. Most fixes are driver updates in `src-tauri/drivers/*.json`: bump `version`, and only set `verified: true` after a real call connects and hangs up.
