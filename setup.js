/* AI 來電 練英文 — 新手設定引導：一步一頁，帶著申請 Gemini 金鑰。 */
"use strict";

// ---- progress is kept on the phone, so leaving for Google's page and coming back lands on the same step
const SETUP_KEY = "aicall_setup";
const SETUP_TOTAL = 7;
const SETUP_NUM = { welcome: 1, acct: 2, "acct-new": 2, apply: 3, copy: 4, paste: 5, test: 6, home: 7, done: 7 };
const SETUP_BACK = { acct: "welcome", "acct-new": "acct", apply: "acct", copy: "apply", paste: "copy", test: "paste", home: "test" };

function setupLoad() { try { return JSON.parse(localStorage.getItem(SETUP_KEY) || "null") || {}; } catch (e) { return {}; } }
function setupSave(o) { try { localStorage.setItem(SETUP_KEY, JSON.stringify(o)); } catch (e) {} }
function setupClear() { try { localStorage.removeItem(SETUP_KEY); } catch (e) {} }

/** LINE, Facebook, Instagram … open links in their own little browser, where Google sign-in and the microphone often do not work. */
function inAppBrowser() {
  const ua = navigator.userAgent || "";
  if (/Line\//i.test(ua)) return "LINE";
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return "Facebook";
  if (/Instagram/i.test(ua)) return "Instagram";
  if (/MicroMessenger/i.test(ua)) return "微信";
  return "";
}

const GUIDE_URL = "https://aistudio.google.com/apikey";
const SIGNUP_URL = "https://accounts.google.com/signup";
const LOOKUP_URL = "https://accounts.google.com/";

let SU = null;   // the open guide: { el, step, returned, acctOpen, ignoreLine, opened, pasteErr, test }

function openSetup(auto) {
  if (SU) return;
  const saved = setupLoad();
  SU = { el: h("div", { class: "setup" }), step: saved.step && SETUP_NUM[saved.step] ? saved.step : "welcome", returned: false, acctOpen: false, ignoreLine: false, opened: false, pasteErr: "", test: null, acct: saved.acct || "" };
  if (SU.step === "test") SU.step = "paste";
  if (SU.step === "home" || SU.step === "done") SU.step = "welcome";
  document.body.appendChild(SU.el);
  document.body.classList.add("noscroll");
  setupSave({ step: SU.step, acct: SU.acct, active: true });
  setupPaint();
}

function closeSetup(keepStep) {
  if (!SU) return;
  SU.el.remove(); SU = null;
  document.body.classList.remove("noscroll");
  const s = setupLoad(); s.active = false; if (keepStep) setupSave(s); else setupClear();
  renderMain();
}

function setupGo(step) {
  SU.step = step; SU.returned = false; SU.pasteErr = ""; SU.test = null;
  setupSave({ step, acct: SU.acct, active: true });
  setupPaint();
  SU.el.scrollTop = 0;
  if (step === "test") setupRunTest();
}

// ---- simple drawings (not screenshots: Google changes its pages, so the words always win)
const DIAG_NOTE = "示意圖，實際畫面可能略有不同，以文字為準";
function diagCreate() {
  return h("div", { class: "diag" }, h("div", { html:
    '<svg viewBox="0 0 300 130" role="img" aria-label="示意圖：找到 Create API key 按鈕">' +
    '<rect x="6" y="6" width="288" height="118" rx="14" fill="#121A2E" stroke="#3A4A78"/>' +
    '<text x="20" y="32" fill="#8FA0C4" font-size="13">Google AI Studio</text>' +
    '<text x="20" y="54" fill="#EAF0FF" font-size="15" font-weight="700">API keys</text>' +
    '<rect x="150" y="68" width="130" height="38" rx="10" fill="#D4AF37"/>' +
    '<text x="215" y="92" fill="#1A1405" font-size="14" font-weight="700" text-anchor="middle">Create API key</text>' +
    '<path d="M110 100 L140 90" stroke="#FF6B6B" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M132 82 L142 90 L131 96" fill="none" stroke="#FF6B6B" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<text x="20" y="108" fill="#FF6B6B" font-size="13" font-weight="700">按這個</text></svg>' }),
    h("div", { class: "dnote", text: DIAG_NOTE }));
}
function diagCopy() {
  return h("div", { class: "diag" }, h("div", { html:
    '<svg viewBox="0 0 300 120" role="img" aria-label="示意圖：金鑰旁邊的複製圖示">' +
    '<rect x="6" y="6" width="288" height="108" rx="14" fill="#121A2E" stroke="#3A4A78"/>' +
    '<text x="20" y="32" fill="#8FA0C4" font-size="13">你的金鑰</text>' +
    '<rect x="16" y="46" width="268" height="40" rx="10" fill="#1A2440" stroke="#232E4D"/>' +
    '<text x="28" y="72" fill="#EAF0FF" font-size="15" font-family="monospace">AIzaSy••••••••••••••••</text>' +
    '<rect x="238" y="52" width="38" height="28" rx="8" fill="#0A0F1E" stroke="#D4AF37"/>' +
    '<rect x="249" y="58" width="12" height="14" rx="2" fill="none" stroke="#D4AF37" stroke-width="2"/>' +
    '<rect x="253" y="62" width="12" height="14" rx="2" fill="#0A0F1E" stroke="#D4AF37" stroke-width="2"/>' +
    '<text x="214" y="104" fill="#FF6B6B" font-size="13" font-weight="700" text-anchor="end">按複製圖示 ↗</text></svg>' }),
    h("div", { class: "dnote", text: DIAG_NOTE }));
}

// ---- the frame every page shares
function setupFrame(step, title, kids, opts) {
  opts = opts || {};
  const n = SETUP_NUM[step] || 1;
  const back = SETUP_BACK[step];
  const backTarget = step === "apply" && SU.acct === "new" ? "acct-new" : back;
  return h("div", { class: "sbox" },
    h("div", { class: "sbar" },
      backTarget && !opts.noBack ? h("button", { class: "sback", text: "‹ 上一步", on: { click: () => setupGo(backTarget) } }) : h("span", { class: "sback ph", text: "" }),
      h("div", { class: "scount", text: opts.noCount ? "" : "第 " + n + " 步 / 共 " + SETUP_TOTAL + " 步" }),
      h("button", { class: "sx", text: "✕", "aria-label": "先離開", on: { click: () => closeSetup(true) } })),
    h("div", { class: "sprog" }, h("div", { class: "sfill", style: "width:" + Math.round((opts.noCount ? 100 : n / SETUP_TOTAL * 100)) + "%" })),
    h("h1", { class: "stitle", text: title }),
    SU.returned && opts.returnedHint ? h("div", { class: "shint", text: opts.returnedHint }) : null,
    kids,
    opts.noHelp ? null : h("button", { class: "shelp", text: "🙋 我卡住了", on: { click: showSetupHelp } }));
}

const sp = (t) => h("p", { class: "sp", text: t });
const sbtn = (t, fn, cls) => h("button", { class: "sbtn " + (cls || "gold"), text: t, on: { click: fn } });
const sli = (n, t) => h("div", { class: "sli" }, h("span", { class: "sn", text: n }), h("span", { class: "st", text: t }));

function setupPaint() {
  if (!SU) return;
  const step = SU.step;
  let page;
  if (inAppBrowser() && !SU.ignoreLine) page = pgBrowser();
  else page = ({ welcome: pgWelcome, acct: pgAcct, "acct-new": pgAcctNew, apply: pgApply, copy: pgCopy, paste: pgPaste, test: pgTest, home: pgHome, done: pgDone }[step] || pgWelcome)();
  SU.el.replaceChildren(page);
}

// ---------------------------------------------------------------- pages

function pgBrowser() {
  const name = inAppBrowser();
  return setupFrame("welcome", "請先改用 Safari 開啟", [
    sp("你現在是在 " + name + " 裡面打開的。這種小視窗常常不能登入 Google，也不能用麥克風，所以請換成 Safari："),
    sli("1", "點畫面右下角（或右上角）的「⋯」或分享圖示"),
    sli("2", "選「用 Safari 開啟」（有些版本叫「在瀏覽器中開啟」）"),
    sli("3", "在 Safari 裡看到這個畫面後，再繼續"),
    sp("找不到的話，按下面「複製網址」，再自己打開 Safari，貼到網址列。"),
    sbtn("複製網址", () => copyText(PAGE_URL), "gold"),
    h("button", { class: "slink", text: "我已經在 Safari 了，繼續", on: { click: () => { SU.ignoreLine = true; setupPaint(); } } })
  ], { noCount: true, noBack: true, noHelp: true });
}

function pgWelcome() {
  return setupFrame("welcome", "第一次使用，3 分鐘就好", [
    sp("這個 App 需要一把免費的「金鑰（通行碼）」才能打電話。我們一步一步來，你只要照著做。"),
    sli("✓", "免費，不用信用卡"),
    sli("✓", "金鑰只存在這支手機，不會傳給別人"),
    sli("✓", "需要一個 Google 帳號（沒有的話，我們會教你建立）"),
    sp("大約 3 分鐘；如果要先建立 Google 帳號，大約 10 分鐘。"),
    sbtn("開始", () => setupGo("acct"))
  ], { noBack: true, noHelp: true });
}

function pgAcct() {
  const more = h("div", { class: "smore" },
    h("div", { class: "stp", text: "任選一個方法找找看：" }),
    sli("1", "打開 Gmail、YouTube 或 Google 地圖，看右上角的圓形頭像，點進去會看到信箱。"),
    sli("2", "打開「設定」→「密碼」，在搜尋框輸入 google，看有沒有 google.com 的項目。"),
    sli("3", "用 Safari 打開 accounts.google.com，如果顯示一個帳號就是了；想不起來，按「忘記電子郵件地址？」，輸入手機號碼或備用信箱找。"),
    sli("4", "到你的信箱搜尋「Google」，找「安全性快訊」或「歡迎使用 Google」的信，會寫出帳號。"),
    h("button", { class: "sbtn outline", text: "開啟 Google 帳號頁（方法 3）", on: { click: () => window.open(LOOKUP_URL, "_blank") } }));
  return setupFrame("acct", "你有 Google 帳號嗎？", [
    sp("用過 Gmail、YouTube，或在手機上登入過 Google 的人，通常已經有了。"),
    h("div", { class: "scard" },
      h("div", { class: "stp", text: "最簡單的確認方式" }),
      sp("打開 Google 地圖或 Gmail，點右上角的圓形頭像。看到像 xxx@gmail.com 的信箱，就是你的 Google 帳號，請把它記下來。")),
    sp("注意：如果是公司或學校給的帳號，可能不能用，請改用個人帳號。"),
    sbtn("我有，信箱記好了", () => { SU.acct = "have"; setupGo("apply"); }),
    sbtn("我沒有 Google 帳號", () => { SU.acct = "new"; setupGo("acct-new"); }, "outline"),
    sbtn(SU.acctOpen ? "收起說明" : "不確定，教我怎麼找", () => { SU.acctOpen = !SU.acctOpen; setupPaint(); }, "outline"),
    SU.acctOpen ? more : null
  ]);
}

function pgAcctNew() {
  return setupFrame("acct-new", "先建立 Google 帳號", [
    sp("很簡單，大約 5 分鐘。按下面的按鈕，會用 Safari 打開建立頁面："),
    sli("1", "填姓名、生日、性別。"),
    sli("2", "選一個新的 Gmail 地址，或用你原本的信箱（不一定要 Gmail）。"),
    sli("3", "設定密碼。Google 可能會要你輸入手機號碼，收驗證碼。"),
    sli("4", "建好後，把「信箱」和「密碼」寫在紙上或備忘錄。"),
    sbtn("開啟建立帳號頁", () => window.open(SIGNUP_URL, "_blank")),
    sbtn("我建好了，下一步", () => setupGo("apply"), "outline")
  ], { returnedHint: "歡迎回來！如果帳號建好了，就按「我建好了，下一步」。" });
}

function pgApply() {
  return setupFrame("apply", "去申請金鑰", [
    sp("按下面的按鈕，會用 Safari 打開 Google 的申請頁。照下面的順序做："),
    sli("1", "如果要你登入：請用剛才記下的信箱。想不起密碼，就按「忘記密碼」。"),
    sli("2", "第一次進去會出現「條款」，按同意。"),
    sli("3", "找到並按「Create API key」（建立 API 金鑰）。"),
    sli("4", "如果問你要選哪個專案，選「建立新專案」。"),
    sli("5", "出現一長串 AIza 開頭的字，就成功了。"),
    diagCreate(),
    sbtn("開啟申請頁", () => { SU.opened = true; window.open(GUIDE_URL, "_blank"); }),
    sbtn("我看到金鑰了，下一步", () => setupGo("copy"), "outline")
  ], { returnedHint: "歡迎回來！看到那串 AIza 開頭的字了嗎？看到就按「我看到金鑰了，下一步」；還沒有的話，再按「開啟申請頁」。" });
}

function pgCopy() {
  return setupFrame("copy", "複製金鑰", [
    sp("金鑰是一長串 AIza 開頭的英文和數字。請把整串複製起來。"),
    diagCopy(),
    sli("1", "按金鑰旁邊的複製圖示（像兩張疊在一起的紙），看到「已複製」就好。"),
    sli("2", "找不到圖示的話：長按那串字，選「拷貝」。"),
    sli("3", "複製完，回到這個 App（用下方的返回，或切換 App）。"),
    sbtn("我複製好了，下一步", () => setupGo("paste")),
    sbtn("再去看一次申請頁", () => window.open(GUIDE_URL, "_blank"), "outline")
  ], { returnedHint: "歡迎回來！金鑰複製好了就按下面「我複製好了，下一步」。" });
}

const KEY_RE = /^AIza[0-9A-Za-z_\-]{30,60}$/;
function takeKey(raw) {
  const t = String(raw || "").replace(/\s+/g, "");
  if (KEY_RE.test(t)) return t;
  return "";
}

function pgPaste() {
  const field = h("input", { class: "field sfield", type: "text", placeholder: "長按這裡，選「貼上」", autocomplete: "off", autocapitalize: "off", spellcheck: false, id: "setupkey",
    on: { input: () => { const k = takeKey(field.value); if (k) acceptKey(k); } } });
  return setupFrame("paste", "貼上金鑰", [
    sp("按下面大按鈕，把剛剛複製的金鑰貼進來。iPhone 可能會跳出「允許貼上」，請按「允許」。"),
    SU.pasteErr ? h("div", { class: "serr", text: SU.pasteErr }) : null,
    sbtn("貼上金鑰", async () => {
      let t = "";
      try { t = await navigator.clipboard.readText(); } catch (e) { SU.pasteErr = "沒辦法自動貼上。請改用下面的方法：長按那一格，選「貼上」。"; setupPaint(); return; }
      const k = takeKey(t);
      if (k) acceptKey(k);
      else { SU.pasteErr = "剪貼簿裡的內容看起來不是金鑰（應該是 AIza 開頭的一長串）。請回到 Google 頁面，重新複製一次。"; setupPaint(); }
    }),
    h("div", { class: "stp", style: "margin-top:18px", text: "貼不上來？" }),
    sp("長按下面這一格，選「貼上」，會自動檢查。"),
    field,
    sbtn("回去 Google 頁面再複製", () => window.open(GUIDE_URL, "_blank"), "outline")
  ], { returnedHint: "歡迎回來！請按下面的「貼上金鑰」。" });
}

function acceptKey(k) {
  P.key = k; savePrefs();
  setupGo("test");
}

// ---- the test: a real request, in plain words when it fails
function explainKeyError(msg) {
  const m = String(msg || "");
  if (/API key not valid|API_KEY_INVALID|invalid api key|\b400\b/i.test(m)) return { t: "這把金鑰不正確", hint: "可能是複製時少了一段。請回去 Google 頁面，重新複製整串，再貼一次。", paste: true };
  if (/\b403\b|PERMISSION|not enabled|denied|forbidden/i.test(m)) return { t: "這把金鑰沒有權限", hint: "請回到 Google 申請頁，重新建立一把新的金鑰（選「建立新專案」），再貼一次。", paste: true };
  if (/\b429\b|quota|RESOURCE_EXHAUSTED|rate/i.test(m)) return { t: "免費額度暫時用完了", hint: "金鑰本身沒問題。過幾分鐘再按「再試一次」，或明天再用。", ok: true };
  if (/location|region|not supported|FAILED_PRECONDITION|unavailable in your/i.test(m)) return { t: "這個地區或帳號暫時不能使用", hint: "可能是 Google 對地區或年齡的限制。可以換一個個人 Google 帳號試試。" };
  if (/Failed to fetch|NetworkError|network|load failed|timeout/i.test(m)) return { t: "網路好像有問題", hint: "請確認有連上網路（Wi-Fi 或行動網路），再按「再試一次」。" };
  return { t: "測試沒有成功", hint: "請按「再試一次」。還是不行，按「我卡住了」，或把畫面截圖（記得蓋住金鑰）給 Archie 看。", raw: m.slice(0, 140) };
}

async function setupRunTest() {
  const me = SU;
  me.test = { state: "run" }; setupPaint();
  try {
    await geminiGenerate(P.key, ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash"], "Reply with the single word: OK", false);
    let live = "", liveOk = true;
    try { const ms = await new LiveSession({ apiKey: P.key }).discover(); if (!ms.length) { liveOk = false; live = "這把金鑰找不到「即時語音」功能，通話可能不能用。"; } }
    catch (e) { liveOk = false; live = "即時語音暫時查不到，可以先繼續，打電話時再看看。"; }
    if (SU !== me) return;
    me.test = { state: "ok", live, liveOk };
  } catch (e) {
    if (SU !== me) return;
    const info = explainKeyError((e && e.message) || e);
    if (info.paste) { P.key = ""; savePrefs(); }   // a key Google refused is not a key: do not leave it half-set-up
    me.test = { state: "fail", info };
  }
  setupPaint();
}

function pgTest() {
  const t = SU.test || { state: "run" };
  if (t.state === "run") return setupFrame("test", "正在測試…", [
    h("div", { class: "spin" }), sp("正在確認金鑰能不能用，請稍等幾秒。")], { noBack: true, noHelp: true });
  if (t.state === "ok") return setupFrame("test", "✓ 成功了！", [
    sp("金鑰可以用了。"),
    t.live ? h("div", { class: "shint", text: t.live }) : null,
    sbtn("下一步", () => setupGo("home"))], { noBack: true });
  const i = t.info;
  return setupFrame("test", i.t, [
    sp(i.hint),
    i.raw ? h("div", { class: "snote", text: "（技術訊息：" + i.raw + "）" }) : null,
    i.paste ? null : sbtn("再試一次", () => setupRunTest()),
    i.ok ? sbtn("先繼續，稍後再用", () => setupGo("home"), "outline") : null,
    sbtn("重新貼上金鑰", () => setupGo("paste"), i.paste ? "gold" : "outline")
  ]);
}

function pgHome() {
  const standalone = window.navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
  if (standalone) return setupFrame("home", "已經在主畫面了 ✓", [
    sp("你現在就是從主畫面開啟的，很好，不用再做。"),
    sbtn("完成", () => setupGo("done"))], { noBack: true });
  return setupFrame("home", "加入主畫面（建議）", [
    sp("加進主畫面後，它會像一般 App 一樣用，而且你的金鑰比較不會被 Safari 清掉。"),
    sli("1", "在 Safari 畫面最下面（或最上面），點「分享」圖示（方框加一個向上的箭頭）。"),
    sli("2", "往下滑，選「加入主畫面」。"),
    sli("3", "右上角按「加入」。"),
    sli("4", "以後從主畫面的圖示打開它。"),
    sbtn("我加好了，下一步", () => setupGo("done")),
    sbtn("先不要，之後再說", () => setupGo("done"), "outline")
  ]);
}

function pgDone() {
  return setupFrame("done", "全部完成 🎉", [
    sp("可以開始練英文了。第一次打電話時，iPhone 會問「要不要允許使用麥克風」，請按「允許」。"),
    sp("之後想換金鑰，可以到「系統」頁，按「如何申請 key？」。"),
    sbtn("開始練習", () => { closeSetup(false); }),
    sbtn("打第一通電話", () => { closeSetup(false); setTimeout(() => { try { showIncoming(); } catch (e) {} }, 200); }, "outline")
  ], { noBack: true, noHelp: true, noCount: true });
}

// ---------------------------------------------------------------- "I'm stuck"
function showSetupHelp() {
  const q = (title, body) => h("details", { class: "sq" }, h("summary", { text: title }), h("div", { class: "sa", text: body }));
  const box = h("div", { class: "sqs" },
    q("找不到「Create API key」", "請先確認已經用 Google 帳號登入。頁面上通常有一個金色或藍色的按鈕寫著 Create API key；如果頁面是中文，可能叫「建立 API 金鑰」。往下滑看看，或按頁面右上角重新整理。"),
    q("一直要我建立專案", "選「建立新專案」（Create API key in new project）就可以，不用自己取名字。"),
    q("頁面說不能使用 / 不支援", "可能是帳號的限制：公司或學校的帳號常常不行，請改用個人的 Google 帳號。也可能是地區或年齡限制，這部分 Google 可能會變，請把畫面截圖（蓋住金鑰）給 Archie。"),
    q("想不起來密碼", "在 Google 登入頁，輸入信箱後按「忘記密碼？」，照畫面重設。"),
    q("貼上沒反應", "iPhone 第一次貼上會跳出「貼上」的小方塊，要按它。或者長按輸入框，選「貼上」。"),
    q("測試一直失敗", "最常見是金鑰少複製了一段。回到 Google 頁面，重新複製整串，再貼一次。"),
    sp("還是不行？請把畫面截圖，記得把金鑰蓋起來，傳給 Archie。"));
  modal("我卡住了", box, [{ text: "關閉", primary: true }]);
}

// ---------------------------------------------------------------- coming back from Google's page
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !SU) return;
  if (["acct-new", "apply", "copy", "paste"].includes(SU.step)) { SU.returned = true; setupPaint(); }
});

// ---------------------------------------------------------------- start up: pick up where the person left off
(function setupAuto() {
  if (P.key) { setupClear(); return; }
  const s = setupLoad();
  if (s.active) openSetup(true);
})();
