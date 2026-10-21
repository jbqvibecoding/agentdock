/**
 * Interface strings for the settings window and the Dock in 简体中文 / English / 繁體中文 / 日本語.
 * The native side (menus, call failure reasons) keeps its own table in src-tauri/src/i18n.rs;
 * both resolve "follow the system" from the OS's first preferred language (`host_info.locale`).
 */

export type Lang = "zh-CN" | "en" | "zh-TW" | "ja";
export type LangSetting = Lang | "system";
const ORDER: Lang[] = ["zh-CN", "en", "zh-TW", "ja"];

/** Each entry: [简体中文, English, 繁體中文, 日本語]. `{name}` placeholders are filled by `t`. */
const M = {
  // language
  "lang.label": ["语言", "Language", "語言", "言語"],
  "lang.sub": ["设置窗口、Dock、菜单与提示", "Settings, Dock, menus and messages", "設定視窗、Dock、選單與提示", "設定ウィンドウ、Dock、メニュー、メッセージ"],
  "lang.system": ["跟随系统", "Follow system", "跟隨系統", "システムに合わせる"],

  // window, navigation, page titles
  "window.title": ["AgentDock 设置", "AgentDock Settings", "AgentDock 設定", "AgentDock 設定"],
  "nav.aria": ["设置分区", "Settings sections", "設定分區", "設定のセクション"],
  "nav.seats": ["Agent", "Agents", "Agent", "エージェント"],
  "nav.hotkeys": ["快捷键", "Shortcuts", "快速鍵", "ショートカット"],
  "nav.appearance": ["外观", "Appearance", "外觀", "外観"],
  "nav.mic": ["麦克风", "Microphone", "麥克風", "マイク"],
  "nav.memory": ["记忆", "Memory", "記憶", "メモリー"],
  "nav.about": ["关于", "About", "關於", "情報"],
  "sub.seats": ["拖动排序，顺序对应 {mod}1–{mod}9", "Drag to reorder; the order maps to {mod}1–{mod}9", "拖曳排序，順序對應 {mod}1–{mod}9", "ドラッグで並べ替え（順番が {mod}1–{mod}9 に対応）"],
  "sub.hotkeys": ["点击组合键重新录制，冲突会标红", "Click a shortcut to record a new one; conflicts turn red", "點擊組合鍵重新錄製，衝突會標紅", "ショートカットをクリックして再登録。重複は赤で表示"],
  "sub.appearance": ["语言、形态、颜色与布局", "Language, form, color and layout", "語言、形態、顏色與佈局", "言語、形、色、レイアウト"],
  "sub.mic": ["输入设备与闭麦方式", "Input device and muting", "輸入裝置與靜音方式", "入力デバイスとミュート方法"],
  "sub.memory": ["用 EverOS 记住每次通话，关闭时不上传任何内容", "Remember every call with EverOS; nothing is uploaded while it's off", "用 EverOS 記住每次通話，關閉時不上傳任何內容", "EverOS で通話を記憶します。オフの間は何もアップロードしません"],
  "sub.about": ["版本、隐私与驱动", "Version, privacy and drivers", "版本、隱私與驅動", "バージョン、プライバシー、ドライバー"],

  // accent colors
  "accent.custom": ["自定义颜色", "Custom color", "自訂顏色", "カスタムカラー"],
  "accent.aria": ["主题色：{name}", "Accent color: {name}", "主題色：{name}", "アクセントカラー：{name}"],
  "accent.none": ["无", "None", "無", "なし"],
  "accent.blue": ["蓝", "Blue", "藍", "ブルー"],
  "accent.indigo": ["靛", "Indigo", "靛", "インディゴ"],
  "accent.purple": ["紫", "Purple", "紫", "パープル"],
  "accent.pink": ["粉", "Pink", "粉", "ピンク"],
  "accent.orange": ["橙", "Orange", "橙", "オレンジ"],
  "accent.green": ["绿", "Green", "綠", "グリーン"],
  "accent.teal": ["青", "Teal", "青", "ティール"],
  "accent.graphite": ["石墨", "Graphite", "石墨", "グラファイト"],

  // Agent page: rows
  "status.connected": ["已连接", "Connected", "已連接", "接続済み"],
  "status.needsAuthApp": ["需要授权", "Needs permission", "需要授權", "許可が必要"],
  "status.needsAuthWeb": ["需要登录", "Needs sign-in", "需要登入", "ログインが必要"],
  "status.placeholder": ["待接入", "Coming soon", "待接入", "準備中"],
  "status.voiceClosed": ["语音未开放", "Voice not available yet", "語音未開放", "音声は未提供"],
  "status.unavailable": ["未安装", "Not installed", "未安裝", "未インストール"],
  "status.unknown": ["未连接", "Not connected", "未連接", "未接続"],
  "noun.target": ["对象", "target", "對象", "対象"],
  "where.app": ["桌面 App", "Desktop app", "桌面 App", "デスクトップアプリ"],
  "where.appTarget": ["桌面 App · {noun}「{target}」", "Desktop app · {noun} \"{target}\"", "桌面 App · {noun}「{target}」", "デスクトップアプリ · {noun}「{target}」"],
  "seat.tipApp": ["桌面 App，通过辅助功能控制", "Desktop app, driven through Accessibility", "桌面 App，透過輔助使用控制", "デスクトップアプリ（アクセシビリティで操作）"],
  "seat.tipUnverified": ["驱动尚未在真机校验", "Driver not yet verified on a real Mac", "驅動尚未在實機驗證", "ドライバーは実機で未検証"],
  "btn.signIn": ["登录", "Sign in", "登入", "ログイン"],
  "btn.grant": ["授权", "Allow", "授權", "許可"],
  "btn.more": ["更多", "More", "更多", "その他"],
  "btn.moreAria": ["{name} 更多操作", "More actions for {name}", "{name} 更多操作", "{name} のその他の操作"],
  "btn.reset": ["重置", "Reset", "重設", "リセット"],

  // Agent page: actions and toasts
  "toast.opening": ["正在打开…", "Opening…", "正在開啟…", "開いています…"],
  "toast.openedChrome": ["已在 Chrome 打开，沿用 Chrome 的登录", "Opened in Chrome, using Chrome's sign-in", "已在 Chrome 開啟，沿用 Chrome 的登入", "Chrome で開きました（Chrome のログインを使用）"],
  "toast.loginWindow": ["登录窗已打开，登录后会自动收起", "Sign-in window opened; it closes once you're signed in", "登入視窗已開啟，登入後會自動收起", "ログインウィンドウを開きました。ログインすると自動で閉じます"],
  "toast.axOpened": ["已打开 系统设置 › 辅助功能", "Opened System Settings › Accessibility", "已開啟 系統設定 › 輔助使用", "システム設定 › アクセシビリティ を開きました"],
  "toast.testing": ["正在测试呼叫…", "Testing a call…", "正在測試呼叫…", "テスト発信中…"],
  "toast.testOk": ["接通并已挂断 ✓", "Connected and hung up ✓", "接通並已掛斷 ✓", "接続して切断しました ✓"],
  "toast.testFail": ["没有检测到通话，驱动可能需要更新", "No call detected; the driver may need an update", "沒有偵測到通話，驅動可能需要更新", "通話を検出できません。ドライバーの更新が必要かもしれません"],
  "toast.iconChanged": ["图标已更换", "Icon changed", "圖示已更換", "アイコンを変更しました"],
  "toast.signedOut": ["已清除登录", "Sign-in cleared", "已清除登入", "ログイン情報を消去しました"],
  "toast.removed": ["已移除", "Removed", "已移除", "削除しました"],
  "toast.addedTarget": ["已添加 {name}", "Added {name}", "已新增 {name}", "{name} を追加しました"],
  "toast.addedPlaceholder": ["已把 {name} 放进 Dock，语音呼叫还在接入中", "{name} is on the Dock; calling it isn't wired up yet", "已把 {name} 放進 Dock，語音呼叫還在接入中", "{name} を Dock に追加しました（音声発信は準備中）"],
  "toast.addedWeb": ["已添加，点「登录」完成连接", "Added. Click \"Sign in\" to connect", "已新增，點「登入」完成連接", "追加しました。「ログイン」で接続を完了してください"],
  "toast.added": ["已添加", "Added", "已新增", "追加しました"],
  "rename.targetPlaceholder": ["{service} 侧栏里的 {noun} 名称", "{noun} name in {service}'s sidebar", "{service} 側邊欄裡的 {noun} 名稱", "{service} のサイドバーにある {noun} の名前"],
  "menu.test": ["测试呼叫", "Test call", "測試呼叫", "テスト発信"],
  "menu.relogin": ["重新登录", "Sign in again", "重新登入", "再ログイン"],
  "menu.showPage": ["查看后台页面", "Show background page", "查看背景頁面", "バックグラウンドのページを表示"],
  "menu.rename": ["重命名", "Rename", "重新命名", "名前を変更"],
  "menu.changeTarget": ["换一个 {noun}（当前：{target}）", "Change {noun} (now: {target})", "換一個 {noun}（目前：{target}）", "{noun} を変更（現在：{target}）"],
  "menu.pickTarget": ["指定 {noun}…", "Choose {noun}…", "指定 {noun}…", "{noun} を指定…"],
  "menu.changeIcon": ["更换图标…", "Change icon…", "更換圖示…", "アイコンを変更…"],
  "menu.resetIcon": ["恢复官方图标", "Restore official icon", "恢復官方圖示", "公式アイコンに戻す"],
  "menu.signOut": ["退出登录", "Sign out", "登出", "ログアウト"],
  "menu.signOutConfirm": ["确认清除登录？", "Clear the sign-in?", "確認清除登入？", "ログイン情報を消去しますか？"],
  "menu.remove": ["移除 Agent", "Remove agent", "移除 Agent", "エージェントを削除"],
  "menu.removeConfirm": ["确认移除？", "Remove it?", "確認移除？", "削除しますか？"],

  // Agent page: sign-in method
  "chrome.group": ["登录方式", "Sign-in", "登入方式", "ログイン方法"],
  "chrome.row": ["用 Chrome 的登录", "Use Chrome's sign-ins", "使用 Chrome 的登入", "Chrome のログインを使う"],
  "chrome.off": ["关闭时，网页版 Agent 在内置浏览器里单独登录", "When off, web agents sign in separately in the built-in browser", "關閉時，網頁版 Agent 在內建瀏覽器裡單獨登入", "オフの場合、Web 版エージェントは内蔵ブラウザで個別にログインします"],
  "chrome.connected": ["已连接 Chrome，直接用你在 Chrome 里的登录", "Connected to Chrome, using your Chrome sign-ins", "已連接 Chrome，直接使用你在 Chrome 裡的登入", "Chrome に接続済み。Chrome のログインをそのまま使います"],
  "chrome.available": ["Chrome 已开启远程调试，第一次用时 Chrome 会问一次是否允许", "Chrome remote debugging is on; Chrome asks once to allow the first connection", "Chrome 已開啟遠端偵錯，第一次使用時 Chrome 會詢問一次是否允許", "Chrome のリモートデバッグは有効です。初回の接続時に Chrome が許可を確認します"],
  "chrome.missing": ["未检测到：在 Chrome 打开 chrome://inspect/#remote-debugging 并开启远程调试", "Not found: open chrome://inspect/#remote-debugging in Chrome and turn on remote debugging", "未偵測到：在 Chrome 打開 chrome://inspect/#remote-debugging 並開啟遠端偵錯", "見つかりません：Chrome で chrome://inspect/#remote-debugging を開き、リモートデバッグを有効にしてください"],

  // Agent page: help
  "help.summary": ["登录与授权说明", "About sign-in and permissions", "登入與授權說明", "ログインと許可について"],
  "help.chrome": [
    "开启「用 Chrome 的登录」后，网页版 Agent 在你 Chrome 里的一个后台标签页运行，直接沿用 Chrome 的登录与 Cookie。连接期间 Chrome 顶部会提示「正受到自动测试软件的控制」。",
    "With \"Use Chrome's sign-ins\" on, each web agent runs in a background tab of your Chrome and uses Chrome's sign-ins and cookies. While connected, Chrome says it is being controlled by automated test software.",
    "開啟「使用 Chrome 的登入」後，網頁版 Agent 在你 Chrome 裡的一個背景分頁執行，直接沿用 Chrome 的登入與 Cookie。連線期間 Chrome 頂部會提示「Chrome 正受到自動測試軟體控制」。",
    "「Chrome のログインを使う」をオンにすると、Web 版エージェントは Chrome のバックグラウンドタブで動作し、Chrome のログインと Cookie をそのまま使います。接続中は Chrome 上部に「自動テスト ソフトウェアによって制御されています」と表示されます。",
  ],
  "help.builtin": [
    "没有 Chrome 时，登录在弹出的浏览器窗口里完成，支持 Google、Apple 与 Passkey。AgentDock 不接触密码，登录成功后窗口自动收起。",
    "Without Chrome, you sign in in a pop-up browser window (Google, Apple and passkeys work). AgentDock never sees your password, and the window closes once you're in.",
    "沒有 Chrome 時，登入在跳出的瀏覽器視窗裡完成，支援 Google、Apple 與通行密鑰。AgentDock 不接觸密碼，登入成功後視窗自動收起。",
    "Chrome がない場合は、表示されるブラウザウィンドウでログインします（Google、Apple、パスキーに対応）。AgentDock はパスワードに触れず、ログインするとウィンドウは自動で閉じます。",
  ],
  "help.background": [
    "之后呼叫、闭麦、挂断都在后台完成；会话过期时会显示「需要登录」。",
    "After that, calling, muting and hanging up all happen in the background; an expired session shows \"Needs sign-in\".",
    "之後呼叫、靜音、掛斷都在背景完成；工作階段過期時會顯示「需要登入」。",
    "その後の発信・ミュート・通話終了はすべてバックグラウンドで行われます。セッションが切れると「ログインが必要」と表示されます。",
  ],
  "help.mic": [
    "首次连接会请求一次麦克风权限，并自动做一次测试呼叫。",
    "The first connection asks once for microphone access and places a test call.",
    "首次連接會請求一次麥克風權限，並自動做一次測試呼叫。",
    "初回の接続時にマイクの許可を一度求め、テスト発信を行います。",
  ],
  "help.apps": [
    "桌面 App（如 Grok Bot）需要在系统设置里授予一次辅助功能权限，之后在后台按按钮，不会切到该 App。",
    "Desktop apps (such as Grok Bot) need Accessibility permission once in System Settings; buttons are then pressed in the background without switching to the app.",
    "桌面 App（如 Grok Bot）需要在系統設定裡授予一次輔助使用權限，之後在背景按按鈕，不會切到該 App。",
    "デスクトップアプリ（Grok Bot など）は、システム設定でアクセシビリティの許可が一度必要です。その後はアプリに切り替えずバックグラウンドでボタンを押します。",
  ],
  "help.bots": [
    "在「添加联系人」里，Grok Bot 会自动读出侧栏里的每个 Bot（群聊不能语音，不会列出），点名字即加为一个联系人；呼叫时先选中它再发起语音。",
    "Under \"Add contact\", Grok Bot lists every Bot from its sidebar (group chats can't take voice calls and are left out); tap a name to add it. A call selects that Bot first, then starts the voice chat.",
    "在「新增聯絡人」裡，Grok Bot 會自動讀出側邊欄裡的每個 Bot（群組聊天不能語音，不會列出），點名稱即加為一個聯絡人；呼叫時先選中它再發起語音。",
    "「連絡先を追加」では Grok Bot のサイドバーにある Bot が一覧表示されます（グループチャットは音声通話できないため除外）。名前をタップすると追加でき、発信時はその Bot を選んでから音声チャットを始めます。",
  ],
  "help.chatgpt": [
    "ChatGPT 有桌面 App 时选「ChatGPT dot · App」，不走网页、不用再登录；同样只需要辅助功能权限。",
    "If you have the ChatGPT desktop app, choose \"ChatGPT dot · App\": no web page and no second sign-in, just the same Accessibility permission.",
    "ChatGPT 有桌面 App 時選「ChatGPT dot · App」，不走網頁、不用再登入；同樣只需要輔助使用權限。",
    "ChatGPT のデスクトップアプリがあれば「ChatGPT dot · アプリ」を選びます。Web を使わず再ログインも不要で、必要なのは同じアクセシビリティの許可だけです。",
  ],

  // Agent page: add contact
  "add.open": ["添加联系人", "Add contact", "新增聯絡人", "連絡先を追加"],
  "add.close": ["收起", "Close", "收起", "閉じる"],
  "add.notInstalled": ["这台 Mac 上没有安装", "Not installed on this Mac", "這台 Mac 上沒有安裝", "この Mac にはインストールされていません"],
  "add.placeholder": ["先放图标占位，语音呼叫还在接入中", "Icon placeholder for now; calling isn't wired up yet", "先放圖示佔位，語音呼叫還在接入中", "今はアイコンのみ。音声発信は準備中です"],
  "add.webChrome": ["网页，在 Chrome 里运行，沿用 Chrome 的登录", "Web, runs in Chrome with your Chrome sign-in", "網頁，在 Chrome 裡執行，沿用 Chrome 的登入", "Web 版。Chrome で動作し、Chrome のログインを使います"],
  "add.webBuiltin": ["网页，在内置浏览器里登录一次", "Web, sign in once in the built-in browser", "網頁，在內建瀏覽器裡登入一次", "Web 版。内蔵ブラウザで一度ログインします"],
  "add.appTargets": ["桌面 App，每个 {noun} 一个联系人", "Desktop app, one contact per {noun}", "桌面 App，每個 {noun} 一個聯絡人", "デスクトップアプリ。{noun} ごとに連絡先を 1 件"],
  "add.app": ["桌面 App，在后台操作，不用登录", "Desktop app, driven in the background, no sign-in", "桌面 App，在背景操作，不用登入", "デスクトップアプリ。バックグラウンドで操作、ログイン不要"],
  "kind.web": ["网页", "Web", "網頁", "Web"],
  "kind.app": ["App", "App", "App", "アプリ"],
  "kind.soon": ["待接入", "Soon", "待接入", "準備中"],
  "add.reading": ["读取中…", "Reading…", "讀取中…", "読み込み中…"],
  "add.reread": ["重新读取", "Read again", "重新讀取", "再読み込み"],
  "add.read": ["读取 {noun}", "Read {noun}s", "讀取 {noun}", "{noun} を読み込む"],
  "add.added": ["已添加", "Added", "已新增", "追加済み"],
  "add.add": ["添加", "Add", "新增", "追加"],
  "add.noneFound": [
    "没读到 {noun}：确认 {app} 打开了主窗口，并已在 系统设置 › 辅助功能 里允许 AgentDock",
    "No {noun}s found. Make sure {app}'s main window is open and AgentDock is allowed in System Settings › Accessibility",
    "沒讀到 {noun}：確認 {app} 打開了主視窗，並已在 系統設定 › 輔助使用 裡允許 AgentDock",
    "{noun} が見つかりません。{app} のメインウィンドウが開いていて、システム設定 › アクセシビリティ で AgentDock が許可されているか確認してください",
  ],
  "add.inDock": ["已在 Dock 里", "Already on the Dock", "已在 Dock 裡", "Dock に追加済み"],
  "add.toDock": ["把 {name} 加到 Dock", "Add {name} to the Dock", "把 {name} 加到 Dock", "{name} を Dock に追加"],

  // shortcuts
  "hk.recordTip": ["点击后按下新的组合键；Esc 取消", "Click, then press the new shortcut; Esc cancels", "點擊後按下新的組合鍵；Esc 取消", "クリックして新しいキーを押します。Esc でキャンセル"],
  "hk.recording": ["按下组合键…", "Press keys…", "按下組合鍵…", "キーを押してください…"],
  "key.space": ["空格", "Space", "空白鍵", "スペース"],
  "hk.global": ["全局", "Global", "全域", "グローバル"],
  "hk.toggle": ["展开 / 收起 Dock", "Expand / collapse Dock", "展開 / 收起 Dock", "Dock を展開 / 折りたたむ"],
  "hk.toggleSub": ["通话中也可用", "Works during a call", "通話中也可用", "通話中も使えます"],
  "hk.mute": ["闭麦 / 开麦", "Mute / unmute", "靜音 / 取消靜音", "ミュート / ミュート解除"],
  "hk.hangup": ["挂断", "Hang up", "掛斷", "通話を終了"],
  "hk.orientation": ["横向 / 竖向", "Horizontal / vertical", "橫向 / 直向", "横向き / 縦向き"],
  "hk.form": ["小圆点 / 宠物", "Dot / pet", "小圓點 / 寵物", "ドット / ペット"],
  "hk.formSub": ["切换收起后的形象", "Switch the collapsed form", "切換收起後的形象", "折りたたみ時の表示を切り替え"],
  "hk.agents": ["Agent", "Agents", "Agent", "エージェント"],
  "hk.callNth": ["呼叫第 n 个 Agent", "Call agent n", "呼叫第 n 個 Agent", "n 番目のエージェントに発信"],
  "hk.noAgents": ["还没有启用的 Agent", "No agents enabled yet", "還沒有啟用的 Agent", "有効なエージェントはまだありません"],
  "hk.walkie": ["对讲机", "Walkie-talkie", "對講機", "トランシーバー"],
  "hk.ptt": ["按住说话", "Push to talk", "按住說話", "押して話す"],
  "hk.pttSub": ["按住「展开」键开麦，松开闭麦", "Hold the expand shortcut to unmute, release to mute", "按住「展開」鍵開麥，放開靜音", "展開キーを押している間だけマイクをオン"],
  "hk.conflicts": ["有 {n} 组快捷键冲突（标红），请调整。", "{n} shortcut conflicts (in red); please change them.", "有 {n} 組快速鍵衝突（標紅），請調整。", "{n} 件のショートカットが重複しています（赤色）。変更してください。"],
  "hk.note": ["被系统占用的组合会自动跳过。", "Combinations taken by the system are skipped.", "被系統佔用的組合會自動略過。", "システムが使用中の組み合わせは自動でスキップされます。"],

  // appearance
  "form.title": ["默认形态", "Default form", "預設形態", "デフォルトの形"],
  "form.dot": ["小圆点", "Dot", "小圓點", "ドット"],
  "form.capsule": ["胶囊", "Pill", "膠囊", "カプセル"],
  "form.expanded": ["完整展开", "Expanded", "完整展開", "全展開"],
  "form.pet": ["常驻宠物", "Pet", "常駐寵物", "常駐ペット"],
  "form.note": ["不通话时 Dock 的样子。「常驻宠物」显示最近一位 agent 的头像。", "How the Dock looks between calls. \"Pet\" shows the most recent agent's avatar.", "不通話時 Dock 的樣子。「常駐寵物」顯示最近一位 agent 的頭像。", "通話していないときの Dock の見た目。「常駐ペット」は直近のエージェントのアイコンを表示します。"],
  "color.title": ["颜色", "Color", "顏色", "カラー"],
  "color.theme": ["主题", "Theme", "主題", "テーマ"],
  "theme.light": ["浅色", "Light", "淺色", "ライト"],
  "theme.dark": ["深色", "Dark", "深色", "ダーク"],
  "theme.system": ["跟随系统", "System", "跟隨系統", "システム"],
  "color.accent": ["主题色", "Accent color", "主題色", "アクセントカラー"],
  "color.accentSub": ["给 Dock 的玻璃与图标染色", "Tints the Dock's glass and icons", "為 Dock 的玻璃與圖示染色", "Dock のガラスとアイコンに色を付けます"],
  "color.glass": ["玻璃质感", "Glass", "玻璃質感", "ガラスの質感"],
  "glass.visual": ["系统毛玻璃", "System blur", "系統毛玻璃", "システムのすりガラス"],
  "glass.fallback": ["模糊回退", "Blur fallback", "模糊回退", "ぼかし（代替）"],
  "layout.title": ["布局", "Layout", "佈局", "レイアウト"],
  "layout.size": ["大小", "Size", "大小", "サイズ"],
  "layout.sizeSub": ["也可在 Dock 上滚轮或拖动边缘", "Or scroll on the Dock, or drag its edge", "也可在 Dock 上滾輪或拖曳邊緣", "Dock 上でスクロールするか端をドラッグしても変更できます"],
  "layout.orientation": ["方向", "Orientation", "方向", "向き"],
  "layout.orientationSub": ["{keys} 或右键 Dock 切换", "{keys} or right-click the Dock", "{keys} 或右鍵 Dock 切換", "{keys} または Dock を右クリックで切り替え"],
  "orient.horizontal": ["横向", "Horizontal", "橫向", "横"],
  "orient.vertical": ["竖向", "Vertical", "直向", "縦"],
  "layout.position": ["位置", "Position", "位置", "位置"],
  "layout.positionSub": ["直接拖动 Dock 即可，位置会被记住", "Just drag the Dock; the position is remembered", "直接拖曳 Dock 即可，位置會被記住", "Dock をドラッグするだけ。位置は記憶されます"],
  "snap.free": ["自由", "Free", "自由", "自由"],
  "snap.top_center": ["顶部居中", "Top center", "頂部置中", "上中央"],
  "snap.bottom_center": ["底部居中", "Bottom center", "底部置中", "下中央"],
  "snap.top_left": ["左上", "Top left", "左上", "左上"],
  "snap.top_right": ["右上", "Top right", "右上", "右上"],
  "snap.bottom_left": ["左下", "Bottom left", "左下", "左下"],
  "snap.bottom_right": ["右下", "Bottom right", "右下", "右下"],
  "layout.collapse": ["收起方式", "Collapse", "收起方式", "折りたたみ"],
  "layout.collapseSub": ["固定收起：点开后鼠标移开即收回", "Always collapsed: opens on click, closes when the pointer leaves", "固定收起：點開後滑鼠移開即收回", "常に折りたたむ：クリックで開き、ポインタが離れると閉じます"],
  "collapse.auto": ["自动", "Auto", "自動", "自動"],
  "collapse.pinnedExpanded": ["固定展开", "Always open", "固定展開", "常に展開"],
  "collapse.pinnedCollapsed": ["固定收起", "Always collapsed", "固定收起", "常に折りたたむ"],
  "layout.autoCollapse": ["自动收起", "Auto-collapse", "自動收起", "自動で折りたたむ"],
  "layout.autoCollapseSub": ["空闲多久后收起，通话中不收起", "After how long idle; never during a call", "閒置多久後收起，通話中不收起", "待機してから折りたたむまでの時間（通話中は折りたたみません）"],
  "time.never": ["从不", "Never", "從不", "しない"],
  "time.secs": ["{n} 秒", "{n} s", "{n} 秒", "{n} 秒"],
  "layout.names": ["显示名字", "Show names", "顯示名稱", "名前を表示"],
  "names.hover": ["仅悬停", "On hover", "僅懸停", "ホバー時のみ"],
  "names.always": ["总是", "Always", "總是", "常に"],
  "names.never": ["从不", "Never", "從不", "しない"],
  "layout.reduceMotion": ["减弱动画", "Reduce motion", "減少動態效果", "視差効果を減らす"],
  "layout.reduceMotionSub": ["形变改为淡入淡出", "Fades instead of morphing", "形變改為淡入淡出", "変形の代わりにフェード"],
  "icon.title": ["应用图标", "App icon", "應用程式圖示", "アプリアイコン"],
  "icon.row": ["显示在", "Show in", "顯示在", "表示する場所"],
  "icon.sub": ["点程序坞图标打开设置；菜单栏图标里有同样的菜单", "Click the icon in the macOS Dock to open settings; the menu bar icon has the same menu", "點 Dock 圖示開啟設定；選單列圖示裡有同樣的選單", "Dock のアイコンで設定を開きます。メニューバーのアイコンにも同じメニューがあります"],
  "icon.both": ["程序坞和菜单栏", "Dock and menu bar", "Dock 和選單列", "Dock とメニューバー"],
  "icon.dock": ["仅程序坞", "Dock only", "僅 Dock", "Dock のみ"],
  "icon.menuBar": ["仅菜单栏", "Menu bar only", "僅選單列", "メニューバーのみ"],

  // microphone
  "mic.default": ["系统默认", "System default", "系統預設", "システムのデフォルト"],
  "mic.device": ["输入设备 {n}", "Input device {n}", "輸入裝置 {n}", "入力デバイス {n}"],
  "mic.input": ["输入", "Input", "輸入", "入力"],
  "mic.inputDevice": ["输入设备", "Input device", "輸入裝置", "入力デバイス"],
  "mic.inputDeviceSub": ["通话使用系统默认设备", "Calls use the system default device", "通話使用系統預設裝置", "通話にはシステムのデフォルトデバイスを使います"],
  "mic.level": ["电平", "Level", "音量", "入力レベル"],
  "mic.levelSub": ["说话时会跳动，用来确认麦克风可用", "Moves when you speak, so you know the mic works", "說話時會跳動，用來確認麥克風可用", "話すと動きます。マイクが使えるか確認できます"],
  "mic.noPermission": ["没有拿到麦克风权限或设备", "No microphone access or device", "沒有取得麥克風權限或裝置", "マイクの許可またはデバイスがありません"],
  "mic.call": ["通话", "Calls", "通話", "通話"],
  "mic.muteMode": ["闭麦方式", "Mute", "靜音方式", "ミュート方法"],
  "mic.muteModeSub": ["系统级会同时静音其他会议软件", "System-wide also mutes other meeting apps", "系統層級會同時將其他會議軟體靜音", "システム全体は他の会議アプリもミュートします"],
  "mute.system": ["系统级", "System-wide", "系統層級", "システム全体"],
  "mute.seat": ["仅 Agent", "Agent only", "僅 Agent", "エージェントのみ"],
  "mic.pauseMedia": ["通话时暂停音乐", "Pause music during calls", "通話時暫停音樂", "通話中は音楽を一時停止"],
  "mic.pauseMediaSub": ["挂断后自动恢复", "Resumes after hanging up", "掛斷後自動恢復", "通話終了後に再開"],
  "mic.confirmSwitch": ["切换前确认", "Confirm before switching", "切換前確認", "切り替え前に確認"],
  "mic.confirmSwitchSub": ["关闭时直接切换，3 秒内可撤销", "When off, switching is instant with 3 s to undo", "關閉時直接切換，3 秒內可復原", "オフの場合はすぐ切り替え、3 秒以内なら取り消せます"],

  // memory
  "mem.reason.noKey": ["未设置 EVEROS_API_KEY", "EVEROS_API_KEY isn't set", "未設定 EVEROS_API_KEY", "EVEROS_API_KEY が未設定です"],
  "mem.reason.off": ["已在设置中关闭", "Turned off in Settings", "已在設定中關閉", "設定でオフになっています"],
  "mem.reason.envOff": ["EVEROS_ENABLED 已关闭", "EVEROS_ENABLED is off", "EVEROS_ENABLED 已關閉", "EVEROS_ENABLED がオフです"],
  "mem.reason.badUrl": ["EVEROS_BASE_URL 不是 http(s) 地址", "EVEROS_BASE_URL isn't an http(s) address", "EVEROS_BASE_URL 不是 http(s) 位址", "EVEROS_BASE_URL が http(s) のアドレスではありません"],
  "mem.reason.active": ["已启用，呼叫时读写记忆", "On: memory is read and written during calls", "已啟用，呼叫時讀寫記憶", "有効：通話時にメモリーを読み書きします"],
  "mem.on": ["生效中", "Active", "生效中", "有効"],
  "mem.offChip": ["未生效", "Inactive", "未生效", "無効"],
  "mem.enable": ["启用长期记忆", "Long-term memory", "啟用長期記憶", "長期メモリーを有効にする"],
  "mem.enableSub": ["呼叫前检索相关记忆，通话内容写入 EverOS", "Looks up related memories before a call and writes the call to EverOS", "呼叫前檢索相關記憶，通話內容寫入 EverOS", "発信前に関連する記憶を検索し、通話内容を EverOS に保存します"],
  "mem.inject": ["把记忆带给对方", "Share memories with the agent", "把記憶帶給對方", "記憶をエージェントに渡す"],
  "mem.injectSub": ["填入网页版 Agent 的输入框，不会自动发送", "Fills the web agent's message box; never sent automatically", "填入網頁版 Agent 的輸入框，不會自動送出", "Web 版エージェントの入力欄に入れます（自動送信はしません）"],
  "mem.status": ["当前状态", "Status", "目前狀態", "現在の状態"],
  "mem.state": ["状态", "State", "狀態", "状態"],
  "mem.key": ["密钥", "Key", "金鑰", "キー"],
  "mem.keyFound": ["已检测到 EVEROS_API_KEY", "EVEROS_API_KEY found", "已偵測到 EVEROS_API_KEY", "EVEROS_API_KEY を検出しました"],
  "mem.keyMissing": ["未检测到 EVEROS_API_KEY", "EVEROS_API_KEY not found", "未偵測到 EVEROS_API_KEY", "EVEROS_API_KEY が見つかりません"],
  "mem.yes": ["有", "Yes", "有", "あり"],
  "mem.no": ["无", "No", "無", "なし"],
  "mem.service": ["服务", "Service", "服務", "サービス"],
  "mem.user": ["用户", "User", "使用者", "ユーザー"],
  "mem.userAuto": ["开启并检测到密钥后自动生成", "Created automatically once enabled with a key", "開啟並偵測到金鑰後自動產生", "有効にしてキーを検出すると自動で作成されます"],
  "mem.note": [
    "密钥只从环境变量 EVEROS_API_KEY 读取，不写进设置文件；从访达启动的 App 需要用 launchctl setenv 配置。自建服务用 EVEROS_BASE_URL。记忆请求失败不影响通话。",
    "The key is read only from the EVEROS_API_KEY environment variable and never written to the settings file; an app opened from Finder needs launchctl setenv. Use EVEROS_BASE_URL for a self-hosted server. A failed memory request never affects the call.",
    "金鑰只從環境變數 EVEROS_API_KEY 讀取，不寫進設定檔；從 Finder 啟動的 App 需要用 launchctl setenv 設定。自架服務用 EVEROS_BASE_URL。記憶請求失敗不影響通話。",
    "キーは環境変数 EVEROS_API_KEY からのみ読み込み、設定ファイルには書き込みません。Finder から起動したアプリでは launchctl setenv で設定してください。セルフホストには EVEROS_BASE_URL を使います。メモリーのリクエストが失敗しても通話には影響しません。",
  ],

  // about
  "about.version": ["版本 {v}", "Version {v}", "版本 {v}", "バージョン {v}"],
  "about.runsOn": ["运行于 {os} · 系统材质 {material}", "Running on {os} · system material {material}", "執行於 {os} · 系統材質 {material}", "{os} で実行中 · システムマテリアル {material}"],
  "about.noMaterial": ["不可用（使用模糊回退）", "unavailable (blur fallback)", "不可用（使用模糊回退）", "利用不可（ぼかしで代替）"],
  "about.privacy": ["隐私", "Privacy", "隱私", "プライバシー"],
  "about.privacySub": [
    "不录音、不保存密码。长期记忆默认关闭，开启并配置 EVEROS_API_KEY 后才会上传。",
    "No recording, no stored passwords. Long-term memory is off by default and uploads only once enabled with EVEROS_API_KEY set.",
    "不錄音、不儲存密碼。長期記憶預設關閉，開啟並設定 EVEROS_API_KEY 後才會上傳。",
    "録音もパスワードの保存もしません。長期メモリーは初期設定でオフで、有効にして EVEROS_API_KEY を設定した場合のみアップロードします。",
  ],
  "about.local": ["本地", "Local", "本機", "ローカル"],
  "about.drivers": ["驱动", "Drivers", "驅動", "ドライバー"],
  "about.verified": ["已在真机校验", "Verified on a Mac", "已在實機驗證", "実機で検証済み"],
  "about.unverified": ["待真机校验", "Not yet verified", "待實機驗證", "実機検証待ち"],
  "about.driversNote": [
    "驱动是 JSON 文件，放进 配置目录/drivers/ 即可热更新，版本号更高者生效。",
    "Drivers are JSON files: drop one into <config dir>/drivers/ to hot-update; the higher version wins.",
    "驅動是 JSON 檔案，放進 設定目錄/drivers/ 即可熱更新，版本號較高者生效。",
    "ドライバーは JSON ファイルです。設定フォルダ/drivers/ に置くとすぐ更新され、バージョンが高いものが使われます。",
  ],
  "about.quit": ["退出", "Quit", "結束", "終了"],
  "about.quitSub": ["Dock 与后台 Agent 一起关闭", "Closes the Dock and the background agents", "Dock 與背景 Agent 一起關閉", "Dock とバックグラウンドのエージェントを終了します"],
  "about.quitBtn": ["退出 AgentDock", "Quit AgentDock", "結束 AgentDock", "AgentDock を終了"],

  // Dock
  "dock.disabled": ["未启用", "Off", "未啟用", "オフ"],
  "dock.pending": ["待接入", "Coming soon", "待接入", "準備中"],
  "dock.needsAuth": ["需登录 · 点击仍可尝试", "Needs sign-in · click to try anyway", "需登入 · 點擊仍可嘗試", "ログインが必要 · クリックで試せます"],
  "dock.silent": ["无感呼叫", "Silent call", "無感呼叫", "バックグラウンド発信"],
  "dock.appCall": ["App 呼叫", "App call", "App 呼叫", "アプリで発信"],
  "dock.expand": ["展开 AgentDock", "Expand AgentDock", "展開 AgentDock", "AgentDock を展開"],
  "dock.inCallExpand": ["通话中 {time} · 点击展开", "In call {time} · click to expand", "通話中 {time} · 點擊展開", "通話中 {time} · クリックで展開"],
  "dock.mute": ["闭麦", "Mute", "靜音", "ミュート"],
  "dock.unmute": ["开麦", "Unmute", "取消靜音", "ミュート解除"],
  "dock.collapse": ["收起", "Collapse", "收起", "折りたたむ"],
  "dock.addAgent": ["添加 Agent", "Add agent", "新增 Agent", "エージェントを追加"],
  "dock.calling": ["正在呼叫…", "Calling…", "正在呼叫…", "発信中…"],
  "dock.hangup": ["挂断", "Hang up", "掛斷", "通話を終了"],
  "dock.switchTo": ["切到 {name}…", "Switching to {name}…", "切到 {name}…", "{name} に切り替え中…"],
  "dock.hangingUp": ["正在挂断 {name}", "Hanging up {name}", "正在掛斷 {name}", "{name} との通話を終了中"],
  "dock.muted": ["已闭麦", "muted", "已靜音", "ミュート中"],
  "dock.undo": ["撤销 {n}", "Undo {n}", "復原 {n}", "取り消し {n}"],
  "dock.hangupAll": ["全部挂断", "Hang up all", "全部掛斷", "すべて終了"],
  "dock.needsYou": ["需要你看一眼", "Needs a look", "需要你看一眼", "確認が必要です"],
  "dock.callTimeout": ["呼叫超时，可能需要你看一眼", "The call timed out; it may need a look", "呼叫逾時，可能需要你看一眼", "発信がタイムアウトしました。確認が必要かもしれません"],
  "dock.showPage": ["查看页面", "Show page", "查看頁面", "ページを表示"],
  "dock.gripVertical": ["点一下：放平为横向 · 按住拖动：移动", "Click: lay flat · Drag: move", "點一下：放平為橫向 · 按住拖曳：移動", "クリック：横向きに · ドラッグ：移動"],
  "dock.gripHorizontal": ["点一下：立起为竖向 · 按住拖动：移动", "Click: stand up · Drag: move", "點一下：立起為直向 · 按住拖曳：移動", "クリック：縦向きに · ドラッグ：移動"],
} satisfies Record<string, [string, string, string, string]>;

export type MsgKey = keyof typeof M;

let current: Lang = "zh-CN";

/** A locale such as "zh-Hans-CN" → one of the four; anything unsupported reads English. */
export function fromLocale(locale: string | undefined): Lang {
  const l = (locale ?? "").toLowerCase().replace(/_/g, "-");
  if (l.startsWith("zh")) return /hant|-tw|-hk|-mo/.test(l) ? "zh-TW" : "zh-CN";
  if (l.startsWith("ja")) return "ja";
  return "en";
}

export const resolveLang = (setting: LangSetting | undefined, locale: string | undefined): Lang =>
  !setting || setting === "system" ? fromLocale(locale) : setting;

export function setLang(lang: Lang) {
  current = lang;
  document.documentElement.lang = lang;
}

export const lang = () => current;

export function t(key: MsgKey, vars?: Record<string, string | number>): string {
  const s: string = M[key][ORDER.indexOf(current)];
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

/** The language menu: native names, so each reads right whatever the current language. */
export const LANGUAGES: [LangSetting, string][] = [["system", ""], ["zh-CN", "简体中文"], ["en", "English"], ["zh-TW", "繁體中文"], ["ja", "日本語"]];

/** Static markup: `data-i18n` sets the text, `data-i18n-aria` the aria-label. */
export function translateDom(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((e) => { e.textContent = t(e.dataset.i18n as MsgKey); });
  root.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((e) => e.setAttribute("aria-label", t(e.dataset.i18nAria as MsgKey)));
}
