//! Native-side strings (menus, call failure reasons, Chrome and permission messages) in the four
//! interface languages. The web side keeps its own table in `src/i18n.ts`; both resolve
//! "follow the system" from the OS's first preferred language.

use crate::settings::Language;
use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    ZhCn = 0,
    En = 1,
    ZhTw = 2,
    Ja = 3,
}

static CURRENT: AtomicU8 = AtomicU8::new(Lang::ZhCn as u8);

/// The OS's first preferred language, e.g. "zh-Hans-CN".
pub fn system_locale() -> String {
    #[cfg(target_os = "macos")]
    if let Some(first) = objc2_foundation::NSLocale::preferredLanguages().firstObject() {
        return first.to_string();
    }
    std::env::var("LC_ALL").or_else(|_| std::env::var("LANG")).unwrap_or_else(|_| "en".into())
}

/// Supported languages only; anything else reads English.
pub fn from_locale(locale: &str) -> Lang {
    let l = locale.to_ascii_lowercase().replace('_', "-");
    if l.starts_with("zh") {
        if ["hant", "-tw", "-hk", "-mo"].iter().any(|m| l.contains(m)) { Lang::ZhTw } else { Lang::ZhCn }
    } else if l.starts_with("ja") {
        Lang::Ja
    } else {
        Lang::En
    }
}

pub fn resolve(setting: Language, locale: &str) -> Lang {
    match setting {
        Language::System => from_locale(locale),
        Language::ZhCn => Lang::ZhCn,
        Language::En => Lang::En,
        Language::ZhTw => Lang::ZhTw,
        Language::Ja => Lang::Ja,
    }
}

/// Switch the language used by `t` / `tf`.
pub fn set(setting: Language) {
    CURRENT.store(resolve(setting, &system_locale()) as u8, Ordering::Relaxed);
}

pub fn current() -> Lang {
    match CURRENT.load(Ordering::Relaxed) {
        1 => Lang::En,
        2 => Lang::ZhTw,
        3 => Lang::Ja,
        _ => Lang::ZhCn,
    }
}

/// The string for `key` in the current language, if the table has it.
pub fn lookup(key: &str) -> Option<String> {
    table(key).map(|row| row[current() as usize].to_string())
}

pub fn t(key: &str) -> String {
    lookup(key).unwrap_or_else(|| key.to_string())
}

/// `t` with `{name}` placeholders filled in.
pub fn tf(key: &str, args: &[(&str, &str)]) -> String {
    args.iter().fold(t(key), |s, (k, v)| s.replace(&format!("{{{k}}}"), v))
}

/// [简体中文, English, 繁體中文, 日本語]
fn table(key: &str) -> Option<[&'static str; 4]> {
    Some(match key {
        // call failures shown on the Dock
        "call.needs_auth" => [
            "需要先登录或授权，去设置里连接账号",
            "Sign in or grant access first: connect the account in Settings",
            "需要先登入或授權，到設定裡連接帳號",
            "先にログインまたは許可が必要です。設定でアカウントを接続してください",
        ],
        "call.web_not_found" => [
            "没找到 {name} 的语音入口：点「查看页面」看看是否已登录",
            "Couldn't find {name}'s voice button. Open the page to check you're signed in",
            "找不到 {name} 的語音入口：點「查看頁面」確認是否已登入",
            "{name} の音声ボタンが見つかりません。「ページを表示」でログイン状態を確認してください",
        ],
        "call.target_not_found" => [
            "{service} 侧栏里没找到「{target}」：名字要和侧栏一致，且没折叠在「展开」里",
            "Couldn't find \"{target}\" in {service}'s sidebar. Use the exact name and make sure it isn't collapsed",
            "{service} 側邊欄裡找不到「{target}」：名稱要和側邊欄一致，且沒有收合起來",
            "{service} のサイドバーに「{target}」が見つかりません。名前を一致させ、折りたたまれていないか確認してください",
        ],
        "call.voice_not_found" => [
            "没找到 {name} 的语音按钮：先在 {service} 里打开一个对话，输入框留空",
            "Couldn't find {name}'s voice button. Open a conversation in {service} and leave the message box empty",
            "找不到 {name} 的語音按鈕：先在 {service} 裡打開一個對話，輸入框留空",
            "{name} の音声ボタンが見つかりません。{service} で会話を開き、入力欄を空にしてください",
        ],
        "call.failed" => ["呼叫失败：{error}", "Call failed: {error}", "呼叫失敗：{error}", "発信に失敗しました：{error}"],
        "call.pending" => [
            "{name} 的语音呼叫还在接入中，先在 Dock 上占个位",
            "Calling {name} isn't wired up yet; it sits on the Dock as a placeholder",
            "{name} 的語音呼叫還在接入中，先在 Dock 上佔個位",
            "{name} への音声発信はまだ準備中です（Dock にはプレースホルダーとして表示しています）",
        ],
        "probe.needs_human" => [
            "页面需要你看一眼（验证或未知弹窗）",
            "The page needs a look (a verification or an unexpected dialog)",
            "頁面需要你看一眼（驗證或未知彈窗）",
            "ページを確認してください（認証または予期しないダイアログ）",
        ],
        // why a target cannot be called (keys from a driver's roster `exclude`)
        "roster.group_chat" => [
            "「{target}」是群聊，群聊不能语音通话",
            "\"{target}\" is a group chat, and group chats can't take voice calls",
            "「{target}」是群組聊天，群組聊天不能語音通話",
            "「{target}」はグループチャットです。グループチャットは音声通話できません",
        ],
        "roster.hidden" => [
            "「{target}」在侧栏里被隐藏了",
            "\"{target}\" is hidden from the sidebar",
            "「{target}」在側邊欄裡被隱藏了",
            "「{target}」はサイドバーで非表示になっています",
        ],
        // apps and permissions
        "app.not_installed" => ["该应用尚未安装", "This app isn't installed", "該應用程式尚未安裝", "このアプリはインストールされていません"],
        "app.needs_ax" => [
            "先在 系统设置 › 辅助功能 里允许 AgentDock",
            "Allow AgentDock in System Settings › Accessibility first",
            "先在 系統設定 › 輔助使用 裡允許 AgentDock",
            "先に システム設定 › アクセシビリティ で AgentDock を許可してください",
        ],
        "icon.bad_format" => ["不支持的图片格式", "Unsupported image format", "不支援的圖片格式", "対応していない画像形式です"],
        "icon.too_large" => ["图片不能超过 8 MB", "Images must be 8 MB or smaller", "圖片不能超過 8 MB", "画像は 8 MB 以下にしてください"],
        // the user's Chrome
        "chrome.lost" => [
            "和 Chrome 的连接断开了，再试一次会重新连接",
            "Lost the connection to Chrome. Try again to reconnect",
            "和 Chrome 的連線中斷了，再試一次會重新連線",
            "Chrome との接続が切れました。もう一度試すと再接続します",
        ],
        "chrome.no_tab" => [
            "Chrome 里还没有这个 Agent 的标签页",
            "Chrome has no tab for this agent yet",
            "Chrome 裡還沒有這個 Agent 的分頁",
            "Chrome にこのエージェントのタブがまだありません",
        ],
        "chrome.refused" => [
            "Chrome 没有允许连接：在 Chrome 弹出的「允许远程调试？」里点允许",
            "Chrome didn't allow the connection. Click Allow in Chrome's \"Allow remote debugging?\" prompt",
            "Chrome 沒有允許連線：在 Chrome 跳出的「允許遠端偵錯？」裡點允許",
            "Chrome が接続を許可しませんでした。Chrome の「リモートデバッグを許可しますか？」で「許可」をクリックしてください",
        ],
        "chrome.not_enabled" => [
            "Chrome 没开远程调试：在 Chrome 打开 chrome://inspect/#remote-debugging 并启用",
            "Chrome remote debugging is off. Open chrome://inspect/#remote-debugging in Chrome and turn it on",
            "Chrome 沒開遠端偵錯：在 Chrome 打開 chrome://inspect/#remote-debugging 並啟用",
            "Chrome のリモートデバッグがオフです。Chrome で chrome://inspect/#remote-debugging を開いて有効にしてください",
        ],
        "chrome.just_refused" => [
            "Chrome 刚拒绝了连接，稍后再试",
            "Chrome just refused the connection. Try again in a moment",
            "Chrome 剛拒絕了連線，稍後再試",
            "Chrome が接続を拒否したばかりです。少し待ってから試してください",
        ],
        // menus
        "menu.expand" => ["展开", "Expand", "展開", "展開"],
        "menu.collapse" => ["收起", "Collapse", "收起", "折りたたむ"],
        "menu.to_vertical" => ["切换为竖向", "Switch to vertical", "切換為直向", "縦向きに切り替え"],
        "menu.to_horizontal" => ["切换为横向", "Switch to horizontal", "切換為橫向", "横向きに切り替え"],
        "menu.form_dot" => ["收起时显示小圆点", "Collapse to a dot", "收起時顯示小圓點", "折りたたみ時はドット表示"],
        "menu.form_pet" => ["收起时显示宠物形象", "Collapse to a pet", "收起時顯示寵物形象", "折りたたみ時はペット表示"],
        "menu.zoom_in" => ["放大 Dock (+10%)", "Enlarge Dock (+10%)", "放大 Dock (+10%)", "Dock を拡大 (+10%)"],
        "menu.zoom_out" => ["缩小 Dock (-10%)", "Shrink Dock (-10%)", "縮小 Dock (-10%)", "Dock を縮小 (-10%)"],
        "menu.zoom_reset" => ["重置大小 (当前 {pct}%)", "Reset size (now {pct}%)", "重設大小 (目前 {pct}%)", "サイズをリセット (現在 {pct}%)"],
        "menu.settings" => ["设置…", "Settings…", "設定…", "設定…"],
        "menu.quit" => ["退出 AgentDock", "Quit AgentDock", "結束 AgentDock", "AgentDock を終了"],
        "menu.toggle_dock" => ["显示 / 隐藏 Dock", "Show / Hide Dock", "顯示 / 隱藏 Dock", "Dock を表示 / 非表示"],
        "window.settings" => ["AgentDock 设置", "AgentDock Settings", "AgentDock 設定", "AgentDock 設定"],
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_locales_map_to_the_four_languages() {
        assert_eq!(from_locale("zh-Hans-CN"), Lang::ZhCn);
        assert_eq!(from_locale("zh_CN.UTF-8"), Lang::ZhCn);
        assert_eq!(from_locale("zh-Hant-TW"), Lang::ZhTw);
        assert_eq!(from_locale("zh-HK"), Lang::ZhTw);
        assert_eq!(from_locale("ja-JP"), Lang::Ja);
        assert_eq!(from_locale("en-US"), Lang::En);
        assert_eq!(from_locale("de-DE"), Lang::En, "unsupported languages read English");
        assert_eq!(resolve(Language::Ja, "zh-Hans"), Lang::Ja, "an explicit choice beats the system");
    }

    #[test]
    fn every_key_has_four_non_empty_strings_with_the_same_placeholders() {
        let keys = [
            "call.needs_auth", "call.web_not_found", "call.target_not_found", "call.voice_not_found", "call.failed", "call.pending",
            "probe.needs_human", "roster.group_chat", "roster.hidden", "app.not_installed", "app.needs_ax", "icon.bad_format",
            "icon.too_large", "chrome.lost", "chrome.no_tab", "chrome.refused", "chrome.not_enabled", "chrome.just_refused",
            "menu.expand", "menu.collapse", "menu.to_vertical", "menu.to_horizontal", "menu.form_dot", "menu.form_pet",
            "menu.zoom_in", "menu.zoom_out", "menu.zoom_reset", "menu.settings", "menu.quit", "menu.toggle_dock", "window.settings",
        ];
        let holes = |s: &str| {
            let mut v: Vec<String> = s.split('{').skip(1).filter_map(|p| p.split_once('}').map(|(h, _)| h.to_string())).collect();
            v.sort();
            v
        };
        for key in keys {
            let row = table(key).unwrap_or_else(|| panic!("{key} missing"));
            for s in row {
                assert!(!s.is_empty(), "{key}");
                assert_eq!(holes(s), holes(row[0]), "{key}: {s}");
            }
        }
        assert_eq!(table("nope"), None);
    }

    #[test]
    fn tf_fills_placeholders_in_the_current_language() {
        CURRENT.store(Lang::En as u8, Ordering::Relaxed);
        assert_eq!(tf("menu.zoom_reset", &[("pct", "120")]), "Reset size (now 120%)");
        CURRENT.store(Lang::ZhCn as u8, Ordering::Relaxed);
        assert_eq!(tf("menu.zoom_reset", &[("pct", "120")]), "重置大小 (当前 120%)");
        assert_eq!(t("not.a.key"), "not.a.key");
    }
}
