/* AI 來電 練英文 — 新手設定引導：一步一頁，帶著申請 Gemini 金鑰。 */
"use strict";

// ---- progress is kept on the phone, so leaving for Google's page and coming back lands on the same step
const SETUP_KEY = "aicall_setup";
const SETUP_TOTAL = 2;
const SETUP_NUM = { welcome: 1, apply: 1, paste: 2, test: 2 };
const SETUP_BACK = { paste: "apply" };

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

let SU = null;   // the open guide: { el, step, returned, acctOpen, ignoreLine, opened, pasteErr, test }

function openSetup(auto) {
  if (SU) return;
  const saved = setupLoad();
  SU = { el: h("div", { class: "setup" }), step: saved.step === "paste" ? "paste" : "apply", returned: false, ignoreLine: false, opened: false, pasteErr: "", test: null };
  document.body.appendChild(SU.el);
  document.body.classList.add("noscroll");
  setupSave({ step: SU.step, active: true });
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
  setupSave({ step, active: true });
  setupPaint();
  SU.el.scrollTop = 0;
  if (step === "test") setupRunTest();
}

// ---- the frame every page shares
function setupFrame(step, title, kids, opts) {
  opts = opts || {};
  const n = SETUP_NUM[step] || 1;
  const back = SETUP_BACK[step];
  const backTarget = back;
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
  else page = ({ apply: pgApply, paste: pgPaste, test: pgTest }[step] || pgApply)();
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

function pgApply() {
  const noAcct = h("details", { class: "sq" }, h("summary", { text: "我沒有 Google 帳號" }),
    h("div", { class: "sa" },
      sp("先建立一個，大約 5 分鐘，免費。建好後再回來按上面的「去申請金鑰」。"),
      h("button", { class: "sbtn outline", text: "建立 Google 帳號", on: { click: () => window.open(SIGNUP_URL, "_blank") } })));
  return setupFrame("apply", "取得免費金鑰", [
    sp("這個 App 需要一把免費的金鑰才能打電話。只有三個動作："),
    sli("1", "按下面的按鈕，到 Google 頁面（用你的 Google 帳號登入）。"),
    sli("2", "按「Create API key」（建立金鑰）。"),
    sli("3", "按金鑰旁邊的複製圖示，然後回到這裡。"),
    sbtn("去申請金鑰", () => { SU.opened = true; window.open(GUIDE_URL, "_blank"); }),
    sbtn("我已經複製好了", () => setupGo("paste"), "outline"),
    noAcct
  ], { noBack: true });
}

// No rule about how a key starts or which characters it holds (Google has changed the format before: "AIza..." then "AQ.…").
// Only rule out what is plainly not a key; the connection test decides the rest.
function takeKey(raw) {
  const t = String(raw || "").trim();
  if (t.length < 16 || t.length > 400) return "";
  if (/\s/.test(t)) return "";                 // a sentence or several words is not a key
  if (/^https?:\/\//i.test(t)) return "";      // a web address is not a key
  return t;
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
      else { SU.pasteErr = "剪貼簿裡的內容看起來不是金鑰（應該是一長串沒有空格的字，不是網址）。請回到 Google 頁面，重新複製一次。"; setupPaint(); }
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
  if (t.state === "ok") {
    const standalone = window.navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
    return setupFrame("test", "✓ 成功了！", [
      sp("金鑰可以用了，可以開始練英文。第一次打電話時，手機會問「要不要允許使用麥克風」，請按「允許」。"),
      t.live ? h("div", { class: "shint", text: t.live }) : null,
      standalone ? null : sp("小提醒：在 Safari 按「分享」→「加入主畫面」，以後像 App 一樣打開，金鑰也比較不會被清掉。"),
      sbtn("開始練習", () => closeSetup(false)),
      sbtn("打第一通電話", () => { closeSetup(false); setTimeout(() => { try { showIncoming(); } catch (e) {} }, 200); }, "outline")
    ], { noBack: true, noHelp: true });
  }
  const i = t.info;
  return setupFrame("test", i.t, [
    sp(i.hint),
    i.raw ? h("div", { class: "snote", text: "（技術訊息：" + i.raw + "）" }) : null,
    i.paste ? null : sbtn("再試一次", () => setupRunTest()),
    i.ok ? sbtn("先繼續，稍後再用", () => closeSetup(false), "outline") : null,
    sbtn("重新貼上金鑰", () => setupGo("paste"), i.paste ? "gold" : "outline")
  ]);
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
  if (SU.step === "apply" && SU.opened) { setupGo("paste"); SU.returned = true; setupPaint(); }
  else if (SU.step === "paste") { SU.returned = true; setupPaint(); }
});

// ---------------------------------------------------------------- start up: pick up where the person left off
(function setupAuto() {
  if (P.key) { setupClear(); return; }
  const s = setupLoad();
  if (s.active) openSetup(true);
})();
