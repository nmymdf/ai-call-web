/* AI 來電 練英文 — web version. UI, call flow, settings. */
"use strict";

const VERSION = "1.2";
const TEXT_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash"];
const PAGE_URL = location.origin + location.pathname;

// ================================================================ helpers

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "html") el.innerHTML = v;
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === "style") el.setAttribute("style", v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.appendChild(typeof kid === "string" || typeof kid === "number" ? document.createTextNode(String(kid)) : kid);
  }
  return el;
}
const $ = (id) => document.getElementById(id);
const pad2 = (n) => String(n).padStart(2, "0");
const mmss = (s) => pad2(Math.floor(s / 60)) + ":" + pad2(Math.floor(s % 60));

let toastTimer = null;
function toast(msg, ms) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), ms || 3200);
}

function modal(title, body, buttons) {
  const bg = h("div", { class: "modal" });
  const close = () => bg.remove();
  const btns = h("div", { class: "btns" }, (buttons || [{ text: "關閉" }]).map(b =>
    h("button", { class: b.primary ? "pill gold" : "pill", text: b.text, on: { click: () => { if (!b.onClick || b.onClick() !== false) close(); } } })));
  bg.appendChild(h("div", { class: "box" }, h("h3", { text: title }), body, btns));
  bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
  document.body.appendChild(bg);
  return close;
}

function card(title, ...kids) { return h("div", { class: "card" }, title ? h("h2", { text: title }) : null, kids); }
const note = (s) => h("div", { class: "note", text: s });
const gap = (n) => h("div", { class: "gap" + n });

function sw(title, sub, checked, onChange) {
  const input = h("input", { type: "checkbox", checked: !!checked, on: { change: () => onChange(input.checked) } });
  return h("div", { class: "swrow" },
    h("div", { class: "grow" }, h("div", { class: "t", text: title }), sub ? h("div", { class: "s", text: sub }) : null),
    h("label", { class: "switch" }, input, h("span")));
}

// ================================================================ storage

const DEFAULTS = {
  key: "", liveModel: "", persona: "random", topicId: "random", level: 3, style: "chatty",
  userName: "", showSubs: true, goalMin: 15, bargeIn: false, speed: 0, customTopics: []
};
let P = Object.assign({}, DEFAULTS);
try { Object.assign(P, JSON.parse(localStorage.getItem("aicall_prefs") || "{}")); } catch (e) {}
function savePrefs() { try { localStorage.setItem("aicall_prefs", JSON.stringify(P)); } catch (e) {} }

const Calls = {
  all() { try { return JSON.parse(localStorage.getItem("aicall_calls") || "[]"); } catch (e) { return []; } },
  put(list) { try { localStorage.setItem("aicall_calls", JSON.stringify(list.slice(0, 50))); } catch (e) {} },
  add(rec) { const l = this.all(); l.unshift(rec); this.put(l); },
  setFeedback(ts, fb) { const l = this.all(); const r = l.find(x => x.ts === ts); if (r) { r.feedback = fb; this.put(l); } },
  markSeen(ts) { const l = this.all(); const r = l.find(x => x.ts === ts); if (r) { r.seen = true; this.put(l); } },
  clear() { try { localStorage.removeItem("aicall_calls"); } catch (e) {} }
};

/** Lower-case letters and digits only, for comparing sentences. */
function normText(s) { return String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""); }

/** The review list. Nothing is ever removed automatically; the user decides. */
const Errs = {
  K: "aicall_errors",
  all() { try { return JSON.parse(localStorage.getItem(this.K) || "[]"); } catch (e) { return []; } },
  put(l) { try { localStorage.setItem(this.K, JSON.stringify(l)); } catch (e) {} },
  /** The same correction showing up again only raises its counter and puts it back to "to review". */
  addMany(items) {
    const l = this.all();
    for (const n of items) {
      const k = normText(n.better); if (!k) continue;
      const o = l.find(x => normText(x.better) === k);
      if (o) { o.lt = n.lt; o.count = (o.count || 1) + 1; o.done = false; o.said = n.said; if (n.why) o.why = n.why; o.sev = Math.max(o.sev || 2, n.sev || 2); }
      else l.push(n);
    }
    this.put(l);
  },
  setDone(id, v) { const l = this.all(); const r = l.find(x => x.id === id); if (r) { r.done = v; this.put(l); } },
  remove(id) { this.put(this.all().filter(x => x.id !== id)); },
  clearDone() { this.put(this.all().filter(x => !x.done)); },
  clear() { try { localStorage.removeItem(this.K); } catch (e) {} },
  exportText() {
    return this.all().sort((a, b) => (b.lt || b.ts) - (a.lt || a.ts)).map(e => {
      const d = new Date(e.lt || e.ts);
      return (e.done ? "[已學會] " : "") + (e.sev >= 3 ? "[重要] " : "") + d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + "（" + (e.count || 1) + " 次）\n" +
        "你說：" + e.said + "\n更好：" + e.better + (e.why ? "\n" + e.why : "");
    }).join("\n\n");
  }
};

const Diag = {
  lastError() { return localStorage.getItem("aicall_lasterr") || ""; },
  setError(s) { try { localStorage.setItem("aicall_lasterr", s); } catch (e) {} },
  logs() { try { return JSON.parse(localStorage.getItem("aicall_logs") || "[]"); } catch (e) { return []; } },
  addLog(entry) {
    const l = this.logs(); l.unshift(entry);
    try { localStorage.setItem("aicall_logs", JSON.stringify(l.slice(0, 10))); } catch (e) {}
  },
  clear() { try { localStorage.removeItem("aicall_lasterr"); localStorage.removeItem("aicall_logs"); } catch (e) {} }
};

function formatFeedback(json) {
  if (!json) return "";
  try {
    const o = JSON.parse(json), parts = [];
    if (o.praise) parts.push("👍 " + o.praise);
    if (Array.isArray(o.errors)) {
      for (const e of o.errors) parts.push("✏️ " + (e.sev >= 3 ? "【重要】" : "") + "你說：" + e.said + " → 更好：" + e.better + (e.why ? "（" + e.why + "）" : ""));
    } else {
      if (o.grammar) parts.push("✏️ " + o.grammar);
      if (o.phrase) parts.push("💬 " + o.phrase);
    }
    if (o.word) parts.push("📚 " + o.word);
    return parts.join("\n\n");
  } catch (e) { return ""; }
}

// ================================================================ audio unlock, ringtone

let AC = null;
function ensureAC() {
  if (!AC || AC.state === "closed") AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state !== "running") AC.resume().catch(() => {});
  try { // iOS: a silent sound played inside a tap unlocks audio
    const b = AC.createBuffer(1, 1, 22050), s = AC.createBufferSource(); s.buffer = b; s.connect(AC.destination); s.start(0);
  } catch (e) {}
  return AC;
}

const Ring = {
  timer: null,
  start(vibrate) {
    this.stop();
    const burst = () => {
      if (!AC || AC.state !== "running") return;
      const t = AC.currentTime;
      for (const f of [440, 480]) {
        const o = AC.createOscillator(), g = AC.createGain();
        o.frequency.value = f; o.type = "sine";
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.03);
        g.gain.setValueAtTime(0.12, t + 0.95); g.gain.linearRampToValueAtTime(0, t + 1.0);
        o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + 1.05);
      }
      if (vibrate && navigator.vibrate) navigator.vibrate([500, 300, 500]);
    };
    burst();
    this.timer = setInterval(burst, 2600);
  },
  stop() { clearInterval(this.timer); this.timer = null; if (navigator.vibrate) navigator.vibrate(0); }
};

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on) { if (navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); } }
    else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && (C || quick)) keepAwake(true);
  if (C) logLine(document.visibilityState === "visible" ? "回到前景" : "網頁被切到背景");
  if (document.visibilityState === "visible") checkQuick();
});

// ================================================================ navigation

const screens = ["main", "sub", "incoming", "call"];
function show(name) {
  for (const s of screens) $(s).classList.toggle("hidden", s !== name);
  window.scrollTo(0, 0);
}

// ================================================================ main screen

let quick = null; // { at, timer }
let quickLabel = null;

function resolvePersona(id) {
  return PERSONAS.find(p => p.id === id) || PERSONAS[Math.floor(Math.random() * PERSONAS.length)];
}

function renderMain() {
  const root = $("main");
  root.replaceChildren();

  root.appendChild(h("div", { class: "header" },
    h("div", { class: "titles" },
      h("h1", { text: "AI 來電 練英文" }),
      h("div", { class: "author", text: "作者：ArchieKuo" }),
      h("div", { class: "ver", text: "版本 v" + VERSION })),
    h("img", { src: "img/logo.jpg", alt: "" })));

  if (!P.key) {
    root.appendChild(h("div", { class: "card warn" }, h("h2", { text: "還差一步就能使用" }),
      h("div", { class: "sub", text: "需要貼上免費的 Gemini 金鑰才能通話。" }), gap(10),
      h("button", { class: "btn gold", text: "去設定金鑰", on: { click: () => showSub("system") } })));
  }

  // feedback from the last call
  const fbRec = Calls.all().find(r => r.feedback && !r.seen);
  if (fbRec && formatFeedback(fbRec.feedback)) {
    root.appendChild(card("上一通電話的小重點",
      h("div", { class: "fb", text: formatFeedback(fbRec.feedback) }), gap(10),
      h("button", { class: "btn outline", text: "知道了", on: { click: () => { Calls.markSeen(fbRec.ts); renderMain(); } } })));
  }

  // ---- quick call
  quickLabel = h("span", { class: "sub" });
  const customIn = h("input", { class: "pill", type: "number", inputMode: "numeric", placeholder: "自訂", min: 1 });
  const quickGrid = h("div", { class: "quick" }, [["0.1", 6000], ["1", 60000], ["3", 180000], ["5", 300000], ["10", 600000], ["30", 1800000]].map(([t, ms]) =>
    h("button", { text: t, on: { click: () => startQuick(ms, t + " 分鐘") } })));
  const cancelBtn = h("button", { class: "pill line", text: "取消", style: quick ? "" : "display:none", on: { click: cancelQuick } });
  cancelBtn.id = "quickCancel";
  quickLabel.id = "quickLabel";
  root.appendChild(card("快速來電",
    h("button", { class: "btn gold", on: { click: dial } }, "撥出：打給 AI", h("small", { text: "CALL OUT" })),
    gap(14),
    h("div", { style: "margin-bottom:8px" }, h("span", { class: "in-label", text: "CALL IN" }), h("span", { class: "sub", style: "font-size:13px", text: "　分鐘後來電" })),
    quickGrid, gap(10),
    h("div", { class: "row" }, customIn,
      h("button", { class: "pill gold", text: "開始", on: { click: () => {
        const m = parseInt(customIn.value, 10);
        if (!m || m < 1) toast("請輸入 1 以上的分鐘數"); else startQuick(m * 60000, m + " 分鐘");
      } } }),
      h("div", { class: "grow" }), quickLabel, cancelBtn),
    note("要保持這個網頁開著、螢幕不要鎖，時間到才會響。")));
  updateQuickUi();

  // ---- topic
  const topicSel = h("select", { class: "field" });
  const addOpt = (v, t) => topicSel.appendChild(h("option", { value: v, text: t }));
  addOpt("random", "隨機");
  TOPICS.forEach(t => addOpt(t.id, t.label));
  P.customTopics.forEach(c => addOpt(c.id, "★ " + c.name));
  if (![...topicSel.options].some(o => o.value === P.topicId)) { P.topicId = "random"; savePrefs(); }
  topicSel.value = P.topicId;
  const delBtn = h("button", { class: "btn outline", text: "刪除這個主題", style: P.topicId.startsWith("c:") ? "" : "display:none", on: { click: deleteTopic } });
  topicSel.addEventListener("change", () => { P.topicId = topicSel.value; savePrefs(); delBtn.style.display = P.topicId.startsWith("c:") ? "" : "none"; });
  root.appendChild(card("對話主題", topicSel, gap(8),
    h("div", { class: "row" }, h("div", { class: "grow" }, h("button", { class: "btn outline", text: "＋ 新增主題", on: { click: addTopic } })), h("div", { class: "grow" }, delBtn))));

  // ---- caller + style
  const grid = h("div", { class: "personas" });
  const entries = PERSONAS.map(p => ({ id: p.id, name: p.name, photo: p.photo })).concat([{ id: "random", name: "隨機" }]);
  entries.forEach(e => {
    const el = h("button", { class: "persona" + (P.persona === e.id ? " sel" : ""), on: { click: () => {
      P.persona = e.id; savePrefs();
      grid.querySelectorAll(".persona").forEach(x => x.classList.toggle("sel", x === el));
    } } },
      h("div", { class: "ring" }, e.photo ? h("img", { src: e.photo, alt: e.name }) : h("div", { class: "q", text: "?" })),
      h("span", { text: e.name }));
    grid.appendChild(el);
  });
  const styleSel = h("select", { class: "field" },
    h("option", { value: "chatty", text: "活潑親切（愛聊生活小事）" }),
    h("option", { value: "focused", text: "簡潔直接（比較正經）" }),
    h("option", { value: "gentle", text: "溫柔鼓勵（多肯定、有耐心）" }),
    h("option", { value: "curious", text: "愛追問（會多問你幾句）" }),
    h("option", { value: "funny", text: "幽默風趣（愛開玩笑）" }));
  styleSel.value = P.style;
  styleSel.addEventListener("change", () => { P.style = styleSel.value; savePrefs(); });
  const speedSel = h("select", { class: "field" },
    h("option", { value: "0", text: "正常" }),
    h("option", { value: "1", text: "稍慢" }),
    h("option", { value: "2", text: "更慢（很慢、停頓清楚）" }));
  speedSel.value = String(P.speed || 0);
  speedSel.addEventListener("change", () => { P.speed = parseInt(speedSel.value, 10) || 0; savePrefs(); });
  root.appendChild(card("來電者", grid, note("每位來電者的臉、聲音、名字都是固定的。選「隨機」，每通電話會換一位。"), gap(10),
    h("div", { class: "flabel", text: "對方說話風格" }), styleSel, gap(10),
    h("div", { class: "flabel", text: "對方說話速度" }), speedSel,
    note("速度只是請對方說得慢一點，聲音本身不會變。")));

  // ---- level
  const levelDesc = h("div", { class: "note", style: "font-size:13px;margin-top:10px" });
  const heights = [4, 10, 18, 28, 40];
  const lvBtns = heights.map((hh, i) => h("button", { on: { click: () => { P.level = i + 1; savePrefs(); paintLevel(); } } },
    h("div", { class: "bar", style: "height:" + hh + "px" }), h("div", { class: "num", text: String(i + 1) })));
  function paintLevel() {
    lvBtns.forEach((b, i) => b.classList.toggle("sel", P.level === i + 1));
    levelDesc.textContent = LEVEL_TEXTS[P.level - 1];
  }
  paintLevel();
  root.appendChild(card("英文難度", h("div", { class: "level" }, lvBtns), levelDesc));

  // ---- call options
  const nameIn = h("input", { class: "field", type: "text", placeholder: "你的名字（對方會這樣叫你）", value: P.userName, autocapitalize: "words",
    on: { input: () => { P.userName = nameIn.value.trim(); savePrefs(); } } });
  root.appendChild(card("通話方式",
    sw("顯示對話文字", "關閉＝純聽聲音", P.showSubs, (v) => { P.showSubs = v; savePrefs(); }), gap(8), nameIn));

  // ---- nav cards
  root.appendChild(h("div", { class: "navrow" },
    h("div", { class: "card click", on: { click: () => showSub("stats") } }, h("h2", { text: "統計" }), note("時間、走勢")),
    h("div", { class: "card click", on: { click: () => showSub("review") } }, h("h2", { text: "複習" }), note("錯誤、測驗")),
    h("div", { class: "card click", on: { click: () => showSub("system") } }, h("h2", { text: "系統" }), note("金鑰、教學"))));

  root.appendChild(h("div", { class: "footer", text: "AI 來電 練英文  ·  ArchieKuo  ·  v" + VERSION }));
}

// ---- custom topics
function addTopic() {
  const ta = h("textarea", { class: "field", rows: 3, placeholder: "例如：點一份外帶披薩、跟老闆請假、聊我的新工作" });
  modal("新增主題", ta, [{ text: "取消" }, { text: "儲存", primary: true, onClick: () => {
    const text = ta.value.trim();
    if (!text) { toast("請先輸入主題"); return false; }
    const t = { id: "c:" + Date.now(), name: text.slice(0, 16), text };
    P.customTopics.push(t); P.topicId = t.id; savePrefs();
    renderMain(); toast("已新增，在選單最下面（★）");
  } }]);
  setTimeout(() => ta.focus(), 50);
}
function deleteTopic() {
  const t = P.customTopics.find(x => x.id === P.topicId);
  if (!t) return;
  modal("刪除「" + t.name + "」？", h("div"), [{ text: "取消" }, { text: "刪除", primary: true, onClick: () => {
    P.customTopics = P.customTopics.filter(x => x.id !== t.id); P.topicId = "random"; savePrefs(); renderMain();
  } }]);
}

// ---- quick call timer
function startQuick(ms, label) {
  ensureAC();
  if (!P.key) toast("還沒有 Gemini 金鑰，" + label + "後響了也無法通話", 4500);
  else toast(label + "後會來電，請讓這個網頁開著、螢幕不要鎖", 4500);
  cancelQuick(true);
  quick = { at: Date.now() + ms, timer: setInterval(checkQuick, 500) };
  keepAwake(true);
  updateQuickUi();
}
function cancelQuick(silent) {
  if (quick) { clearInterval(quick.timer); quick = null; }
  if (!C) keepAwake(false);
  if (silent !== true) updateQuickUi();
}
function checkQuick() {
  if (!quick) return;
  updateQuickUi();
  if (Date.now() >= quick.at) { cancelQuick(true); updateQuickUi(); showIncoming(); }
}
function updateQuickUi() {
  const l = $("quickLabel"), c = $("quickCancel");
  if (!l || !c) return;
  if (quick) { l.textContent = "還有 " + mmss(Math.max(0, (quick.at - Date.now()) / 1000)); c.style.display = ""; }
  else { l.textContent = ""; c.style.display = "none"; }
}

// ================================================================ incoming / call

let pending = null; // { persona, topic } while ringing
let ringTimeout = null;
let C = null;       // the active call

function showIncoming() {
  if (C) return;
  pending = { persona: drawPersona(P.persona), topic: drawTopic(P.topicId, P.customTopics) };
  const el = $("incoming");
  el.className = "screen call ringing";
  el.replaceChildren(
    h("div", { class: "tag", text: "AI 來電" }),
    h("div", { class: "spacer" }),
    h("img", { class: "photo", src: pending.persona.photo, alt: "" }),
    h("div", { class: "name", text: pending.persona.name }),
    h("div", { class: "status", text: "來電中…" }),
    h("div", { class: "spacer" }),
    h("div", { class: "actions" },
      h("div", {}, h("button", { class: "round red", text: "✕", on: { click: () => declineIncoming(false) } }), h("div", { class: "lbl", text: "拒接" })),
      h("div", {}, h("button", { class: "round green", text: "✆", on: { click: acceptIncoming } }), h("div", { class: "lbl", text: "接聽" }))));
  show("incoming");
  keepAwake(true);
  if (AC) AC.resume().catch(() => {});
  Ring.start(true);
  // if the phone blocked sound until a tap, start ringing on the first touch
  const first = () => { ensureAC(); Ring.start(false); el.removeEventListener("pointerdown", first); };
  el.addEventListener("pointerdown", first);
  clearTimeout(ringTimeout);
  ringTimeout = setTimeout(() => declineIncoming(true), 30000);
}
function declineIncoming(missed) {
  clearTimeout(ringTimeout);
  Ring.stop();
  pending = null;
  if (!quick) keepAwake(false);
  show("main"); renderMain();
  if (missed) toast("錯過了一通來電");
}
function acceptIncoming() {
  clearTimeout(ringTimeout);
  Ring.stop();
  const p = pending; pending = null;
  beginCall(false, p.persona, p.topic);
}

function dial() {
  if (C) return;
  ensureAC();
  beginCall(true, drawPersona(P.persona), drawTopic(P.topicId, P.customTopics));
}

function logLine(msg) {
  if (!C) return;
  C.log.push("[" + ((Date.now() - C.t0) / 1000).toFixed(1).padStart(5) + "s] " + msg);
}

async function beginCall(outgoing, persona, topic) {
  if (!P.key) { toast("還沒有 Gemini 金鑰，請先到「系統」頁設定"); showSub("system"); return; }
  const ctx = ensureAC();
  C = { outgoing, persona, topic, t0: Date.now(), startMs: Date.now(), lines: [], lastSpeaker: "", liveText: "", cur: null, curWho: "", newBubble: false, muted: false, live: null, stream: null, ended: false, ready: false, log: [], timer: null, level: P.level };
  logLine("通話開始（" + (outgoing ? "撥出" : "來電") + "）" + persona.name + " / " + topic.label + " / 難度 " + P.level);
  buildCallScreen();
  show("call");
  keepAwake(true);
  if (outgoing) Ring.start(false);
  C.timer = setInterval(tickCall, 500);

  try {
    C.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    logLine("麥克風已開啟");
  } catch (e) { failCall(new Error("沒有麥克風權限，或麥克風被佔用。請到瀏覽器／系統設定允許這個網頁使用麥克風。\n" + (e.message || e))); return; }
  if (C.ended) { stopStream(); return; }

  if (outgoing) { await new Promise(r => setTimeout(r, 2600)); Ring.stop(); if (C.ended) { stopStream(); return; } }

  const mine = C;
  C.live = new LiveSession({
    apiKey: P.key, savedModel: P.liveModel, voice: persona.voice,
    system: livePrompt(topic, P.style, P.userName, P.level, persona, outgoing, P.speed || 0),
    cue: outgoing ? OUTGOING_CUE : OPENING_CUE,
    ctx, stream: C.stream,
    isMuted: () => mine.muted,
    allowBargeIn: () => P.bargeIn,
    onModelChosen: (m) => { P.liveModel = m; savePrefs(); },
    onLog: (m) => { if (C === mine) { logLine(m); if (m.startsWith("開始傳送")) { mine.ready = true; } } },
    onModelText: (t) => {
      if (C !== mine) return;
      if (t === "\u0000") { mine.liveText = ""; mine.newBubble = true; return; }
      addText("Caller", t); mine.liveText += t;
      bubble("Caller", t);
    },
    onUserText: (t) => { if (C === mine) { addText("You", t); bubble("You", t); } },
    onFail: (e) => { if (C === mine) failCall(e); }
  });
  C.live.start();
}

function stopStream() {
  if (C && C.stream) { C.stream.getTracks().forEach(t => t.stop()); C.stream = null; }
}

function addText(who, t) {
  if (!t || !t.trim() || !C) return;
  if (who !== C.lastSpeaker) {
    if (C.lines.length) C.lines.push("\n");
    C.lines.push(who + ": ");
    C.lastSpeaker = who;
  }
  C.lines.push(t);
}

// ---- Chat bubbles: shown only when "顯示對話文字" is on. They live on screen only and are never saved.
function bubble(who, piece) {
  const box = $("chat");
  if (!box || !C || !piece) return;
  if (!piece.trim() && !C.cur) return;
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
  if (!C.cur || C.curWho !== who || C.newBubble) {
    if (!piece.trim()) return;
    C.cur = makeBubble(box, who === "Caller");
    C.curWho = who; C.newBubble = false;
  }
  C.cur.textContent += C.cur.textContent ? piece : piece.replace(/^\s+/, "");
  if (near) box.scrollTop = box.scrollHeight;
}

function makeBubble(box, caller) {
  const bub = h("div", { class: "bub" });
  const kids = [bub];
  if (caller) {
    const tr = h("div", { class: "tr hidden" });
    kids.push(h("button", { class: "tbtn", text: "譯", on: { click: () => translateBubble(bub, tr) } }), tr);
  }
  const m = h("div", { class: "m " + (caller ? "caller" : "me") }, kids);
  box.appendChild(m);
  return bub;
}

/** Translates one bubble to Chinese, only when the user taps 譯 (tap again to hide). */
async function translateBubble(bub, tr) {
  if (tr.dataset.done) { tr.classList.toggle("hidden"); return; }
  const src = bub.textContent.trim();
  if (!src) return;
  tr.classList.remove("hidden"); tr.textContent = "翻譯中…";
  try {
    const out = await geminiGenerate(P.key, TEXT_MODELS, "Translate the following English into natural Traditional Chinese (Taiwan). Output only the translation, with no notes.\n\n" + src, false);
    tr.textContent = String(out).trim(); tr.dataset.done = "1";
  } catch (e) { tr.textContent = "翻譯失敗，請稍後再試"; }
}

function buildCallScreen() {
  const el = $("call");
  el.className = "screen call";
  const muteBtn = h("button", { class: "round grey", text: "靜音", on: { click: () => {
    C.muted = !C.muted; muteBtn.classList.toggle("on", C.muted); logLine(C.muted ? "靜音" : "取消靜音");
  } } });
  const chat = !!P.showSubs; // bubbles on: smaller photo to make room
  el.replaceChildren(...[
    h("div", { class: "tag", id: "callTag", text: C.topic.label }),
    h("img", { class: "photo", src: C.persona.photo, alt: "", style: chat ? "width:84px;height:84px;margin-top:0" : "width:150px;height:150px;margin-top:6px" }),
    h("div", { class: "name", text: C.persona.name, style: chat ? "font-size:26px;margin:8px 0 2px" : null }),
    h("div", { class: "status", id: "callStatus", text: C.outgoing ? "撥號中…" : "連線中…" }),
    chat ? h("div", { class: "chat", id: "chat" }) : null,
    h("div", { id: "callErr", class: "err" }),
    chat ? null : h("div", { class: "spacer" }),
    h("div", { class: "actions" },
      h("div", {}, muteBtn, h("div", { class: "lbl", text: "麥克風" })),
      h("div", {}, h("button", { class: "round red", text: "✆", style: "transform:rotate(135deg)", on: { click: () => endCall() } }), h("div", { class: "lbl", text: "掛斷" })))].filter(Boolean));
}

function tickCall() {
  if (!C) return;
  const st = $("callStatus");
  if (!st || C.failed) return;
  const secs = (Date.now() - C.startMs) / 1000;
  if (C.live && C.live.ready && C.live.gotAudio) st.textContent = mmss(secs);
  else if (C.live && C.live.ready) st.textContent = "對方接起來了…";
  else if (!C.outgoing || secs > 2.6) st.textContent = "連線中…";
}

function failCall(e) {
  if (!C || C.failed) return;
  C.failed = true;
  const msg = (e && e.message) || String(e);
  logLine("通話失敗：" + msg);
  Diag.setError(new Date().toLocaleString() + "\n" + msg);
  Ring.stop();
  const st = $("callStatus"); if (st) st.textContent = "通話失敗";
  const er = $("callErr"); if (er) er.textContent = msg;
  const mine = C;
  setTimeout(() => { if (C === mine) endCall(); }, 12000);
}

function endCall() {
  if (!C || C.ended) return;
  const c = C;
  c.ended = true;
  clearInterval(c.timer);
  Ring.stop();
  try { c.live && c.live.close(); } catch (e) {}
  stopStream.call(null);
  if (c.stream) c.stream.getTracks().forEach(t => t.stop());
  saveCall(c);
  C = null;
  if (!quick) keepAwake(false);
  show("main"); renderMain();
}

function saveCall(c) {
  try {
    const dur = Math.round((Date.now() - c.startMs) / 1000);
    if (dur >= 10 && c.live && c.live.ready) Stats.add(dur, c.startMs, c.persona.name, c.topic.label, c.level);
    const text = c.lines.join("").trim();
    const userLines = text.split("\n").filter(l => l.startsWith("You:"));
    const userWords = userLines.reduce((n, l) => n + l.slice(4).trim().split(/\s+/).filter(Boolean).length, 0);
    Diag.addLog({ ts: c.startMs, persona: c.persona.name, topic: c.topic.label, lines: c.log.slice(-150) });
    if (dur < 20 || !userLines.length) return;
    // The conversation text is NOT kept: only date, length, caller and topic stay in the call list.
    const rec = { ts: c.startMs, durationSec: dur, persona: c.persona.name, topic: c.topic.label, level: c.level, transcript: "", feedback: "", seen: false };
    Calls.add(rec);
    if (userLines.length >= 2 && userWords >= 12 && P.key) {
      analyzeCall(text, P.key).then(r => {
        Calls.setFeedback(rec.ts, JSON.stringify({ praise: r.praise, word: r.word, errors: r.errors }));
        Errs.addMany(r.errors.map((e, i) => ({ id: rec.ts + "-" + i, ts: rec.ts, lt: rec.ts, said: e.said, better: e.better, why: e.why, sev: e.sev, count: 1, done: false, topic: rec.topic })));
        if (!$("main").classList.contains("hidden") && !C) renderMain();
      }).catch(() => {});
    }
  } catch (e) { /* never block hanging up */ }
}

// ================================================================ after-call analysis

const TURNS_PER_PART = 8, MAX_FIX = 5;
function parseJson(t) { return JSON.parse(String(t).trim().replace(/^```json/, "").replace(/^```/, "").replace(/```$/, "").trim()); }

/** Reads the whole conversation in parts and keeps the most serious mistakes (at most 5), plus a praise line and a word. */
async function analyzeCall(text, key) {
  const turns = text.split("\n").map(l => l.startsWith("You:") ? { me: true, text: l.slice(4).trim() } : l.startsWith("Caller:") ? { me: false, text: l.slice(7).trim() } : null).filter(m => m && m.text);
  const parts = []; let cur = [], n = 0;
  for (const m of turns) { cur.push(m); if (m.me && ++n >= TURNS_PER_PART) { parts.push(cur); cur = []; n = 0; } }
  if (cur.some(m => m.me)) { if (n < 3 && parts.length) parts[parts.length - 1].push(...cur); else parts.push(cur); }
  const found = []; let okParts = 0, lastErr = null, order = 0;
  for (const part of parts) {
    const body = part.map(m => (m.me ? "Learner: " : "Partner: ") + m.text).join("\n");
    const mine = normText(part.filter(m => m.me).map(m => m.text).join(" "));
    let o = null;
    for (let tryNo = 0; tryNo < 2 && !o; tryNo++) {
      try { o = parseJson(await geminiGenerate(key, TEXT_MODELS, ERRORS_PROMPT + "\n" + body, true)); }
      catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 1500)); }
    }
    if (!o) continue;
    okParts++;
    for (const x of (Array.isArray(o.errors) ? o.errors : [])) {
      if (!x || !x.said || !x.better) continue;
      const said = normText(x.said);
      if (said.length < 3 || !mine.includes(said)) continue;          // must really be something the learner said
      if (said === normText(x.better)) continue;
      found.push({ said: String(x.said).trim(), better: String(x.better).trim(), why: String(x.why || "").trim(), sev: Number(x.sev) >= 3 ? 3 : 2, order: order++ });
    }
  }
  if (!okParts) throw lastErr || new Error("分析失敗");
  const seen = new Set(), uniq = [];
  for (const f of found) { const k = normText(f.said); if (!seen.has(k)) { seen.add(k); uniq.push(f); } }
  uniq.sort((a, b) => b.sev - a.sev || a.order - b.order);
  const errors = uniq.slice(0, MAX_FIX).map(({ order, ...rest }) => rest);
  let praise = "", word = "";
  try {
    const mineText = turns.filter(m => m.me).map(m => m.text).join("\n").slice(0, 6000);
    const s = parseJson(await geminiGenerate(key, TEXT_MODELS, SUMMARY_PROMPT + "\n" + mineText, true));
    praise = String(s.praise || ""); word = String(s.word || "");
  } catch (e) {}
  return { praise, errors, word };
}

// ================================================================ sub pages (stats / review / system)

let subTab = "stats";
function showSub(tab) {
  subTab = tab;
  const root = $("sub");
  root.replaceChildren();
  root.appendChild(h("div", { class: "topbar" },
    h("button", { class: "back", text: "‹ 返回", on: { click: hideSub } }),
    h("button", { class: "tab" + (tab === "stats" ? " on" : ""), text: "統計", on: { click: () => showSub("stats") } }),
    h("button", { class: "tab" + (tab === "review" ? " on" : ""), text: "複習", on: { click: () => showSub("review") } }),
    h("button", { class: "tab" + (tab === "system" ? " on" : ""), text: "系統", on: { click: () => showSub("system") } })));
  if (tab === "stats") buildStats(root); else if (tab === "review") buildReview(root); else buildSystem(root);
  show("sub");
  if (tab === "stats") setTimeout(() => charts.forEach(c => c.redraw && c.redraw()), 0);
}
function hideSub() { show("main"); renderMain(); }
window.addEventListener("resize", () => { if (!$("sub").classList.contains("hidden")) charts.forEach(c => c.redraw && c.redraw()); });
window.addEventListener("popstate", () => { if (!$("sub").classList.contains("hidden")) hideSub(); });

let charts = [];

function barRows(items) {
  const max = Math.max(0, ...items.map(i => i[1]));
  if (max <= 0) return [note("還沒有資料")];
  return items.map(([name, sec]) => h("div", { class: "brow" },
    h("div", { class: "name", text: name }),
    h("div", { class: "track" }, h("div", { class: "fill" + (sec === max ? " hot" : ""), style: "width:" + (sec / max * 100) + "%" })),
    h("div", { class: "val", text: Stats.shortFmt(sec) })));
}

function buildStats(root) {
  charts = [];
  const st = Stats.summary();
  const goalSec = () => P.goalMin * 60;

  // 1. overview
  const [last7, prev7] = Stats.weekCompare();
  let changeEl;
  if (prev7 > 0) {
    const pct = Math.trunc((last7 - prev7) * 100 / prev7);
    changeEl = h("div", { class: pct >= 0 ? "up" : "down", text: (pct >= 0 ? "▲ " + pct : "▼ " + (-pct)) + "%  較前 7 天" });
  } else changeEl = h("div", { class: "sub", text: last7 > 0 ? "本週開始累積" : "最近 7 天還沒有練習" });
  const avg = st.totalCalls > 0 ? Math.floor(st.totalSec / st.totalCalls) : 0;
  const weekAvg = st.totalSec > 0 ? Math.floor(st.totalSec / Stats.weeksSinceFirst()) : 0;
  root.appendChild(card("累積總覽",
    h("div", { class: "ov" },
      h("div", { class: "grow" }, h("div", { class: "big", text: st.totalSec > 0 ? Stats.fmt(st.totalSec) : "0 分" }), changeEl),
      h("div", { class: "r" }, h("div", { class: "k", text: "練習天數" }), h("div", { class: "v", text: Stats.activeDays() + " 天" }),
        h("div", { class: "k", text: "每週平均" }), h("div", { class: "v", text: Stats.shortFmt(weekAvg) }))),
    h("div", { class: "tiles" },
      h("div", { class: "tile" }, h("div", { class: "k", text: "通話次數" }), h("div", { class: "v", text: st.totalCalls + " 通" })),
      h("div", { class: "tile" }, h("div", { class: "k", text: "平均每通" }), h("div", { class: "v", text: Stats.shortFmt(avg) }))),
    note("只計算超過 10 秒的通話，資料只存在這台裝置裡。")));

  // 2. trend
  const readout = h("div", { style: "font-size:13px;margin-top:6px", text: "點一下長條，看詳細時間" });
  const sumText = h("div", { class: "note", style: "margin-top:4px" });
  const legend = h("div", { class: "note", text: "金＝當天　綠＝達標　白線＝7 天平均" });
  let range = 0;
  const chart = createBarChart((i, b) => {
    readout.textContent = (range === 2 ? b.label + " 結束的那一週　" : b.label + "　") + Stats.fmt(b.sec);
  });
  charts.push(chart);
  const names = ["週", "月", "季", "年", "全部"];
  const btns = names.map((n, i) => h("button", { text: n, on: { click: () => { range = i; load(); } } }));
  function load() {
    const bars = [() => Stats.daily(7), () => Stats.daily(30), () => Stats.weekly(13), () => Stats.monthly(12),
      () => Stats.monthly(Math.min(60, Math.max(3, Stats.monthsSinceFirst())))][range]();
    const daily = range <= 1;
    chart.set(bars, { showAverage: daily, goalSec: daily ? goalSec() : 0 });
    legend.style.display = daily ? "" : "none";
    readout.textContent = "點一下長條，看詳細時間";
    const total = bars.reduce((a, b) => a + b.sec, 0);
    sumText.textContent = "區間合計 " + Stats.shortFmt(total) + (daily ? "　日均 " + Stats.shortFmt(Math.floor(total / bars.length)) : "");
    btns.forEach((b, i) => b.classList.toggle("on", i === range));
  }
  const trendCard = card("走勢圖", h("div", { class: "ranges" }, btns), chart.el, readout, sumText, legend);
  root.appendChild(trendCard);
  load();

  // 3. goal
  const ring = createRing();
  const goalTitle = h("div", { style: "font-weight:700;font-size:15px" });
  const streakEl = h("div", { class: "sub", style: "font-size:13px;margin-top:4px" });
  const weekEl = h("div", { class: "sub", style: "font-size:13px;margin-top:2px" });
  const goalVal = h("div", { class: "val" });
  function updateGoal() {
    const g = goalSec(), today = st.todaySec;
    ring.set(g > 0 ? today / g : 0, String(Math.floor(today / 60)), "/ " + P.goalMin + " 分");
    goalTitle.textContent = today >= g ? "今天達標 ✓" : "今天還差 " + Math.ceil((g - today) / 60) + " 分";
    const s = Stats.goalStreak(g);
    streakEl.textContent = s > 0 ? "連續達標 " + s + " 天" : "連續達標：尚未開始";
    weekEl.textContent = "最近 7 天達標 " + Stats.daily(7).filter(b => b.sec >= g).length + " / 7 天";
    goalVal.textContent = P.goalMin + " 分";
  }
  const step = (t, d) => h("button", { class: "pill", text: t, on: { click: () => { P.goalMin = Math.min(180, Math.max(5, P.goalMin + d)); savePrefs(); updateGoal(); load(); } } });
  root.appendChild(card("目標",
    h("div", { class: "goalrow" }, ring.el, h("div", { class: "grow" }, goalTitle, streakEl, weekEl)),
    h("div", { class: "stepper" }, h("div", { class: "grow", text: "每天目標" }), step("−5", -5), goalVal, step("＋5", 5))));
  updateGoal();

  // 4. when you practise
  const hours = Stats.dim("hour");
  const bucket = (from, to) => Object.entries(hours).reduce((s, [k, v]) => {
    const hh = parseInt(k, 10);
    return s + ((from < to ? (hh >= from && hh < to) : (hh >= from || hh < to)) ? v : 0);
  }, 0);
  const wk = Stats.weekday(), wkNames = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"];
  root.appendChild(card("練習分布",
    h("div", { class: "subhead", text: "時段" }),
    h("div", { class: "bars" }, barRows([["早上 5–11", bucket(5, 11)], ["下午 11–17", bucket(11, 17)], ["晚上 17–23", bucket(17, 23)], ["深夜 23–5", bucket(23, 5)]])),
    h("div", { class: "subhead", text: "星期" }),
    h("div", { class: "bars" }, barRows(wkNames.map((n, i) => [n, wk[i]])))));

  // 5. who and what
  const pers = Object.entries(Stats.dim("persona")).sort((a, b) => b[1] - a[1]);
  const tops = Object.entries(Stats.dim("topic")).sort((a, b) => b[1] - a[1]).slice(0, 5);
  root.appendChild(card("對象與主題排行",
    h("div", { class: "subhead", text: "對象" }), h("div", { class: "bars" }, barRows(pers)),
    h("div", { class: "subhead", text: "主題 前 5 名" }), h("div", { class: "bars" }, barRows(tops))));

  // 6. difficulty
  const lv = Stats.dim("level");
  root.appendChild(card("難度趨勢", h("div", { class: "bars" }, barRows([1, 2, 3, 4, 5].map(i => ["第 " + i + " 級", lv[String(i)] || 0]))),
    note("看你多半在哪個難度練習；慢慢往上調。")));

  // call history
  const recs = Calls.all();
  const histBox = h("div");
  recs.slice(0, 20).forEach(r => {
    const d = new Date(r.ts);
    histBox.appendChild(h("div", { class: "hist", on: { click: () => showCallDetail(r) } },
      h("div", { text: r.persona + " · " + r.topic }),
      h("div", { class: "s", text: (d.getMonth() + 1) + "/" + d.getDate() + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + "　" + Math.floor(r.durationSec / 60) + "分" + (r.durationSec % 60) + "秒" })));
  });
  root.appendChild(card("通話紀錄",
    recs.length ? histBox : note("還沒有通話紀錄。只記日期、時長、對象、主題和小重點，不存對話內容（也不存聲音），保留最近 50 通。"),
    recs.length ? h("button", { class: "btn danger", text: "全部清除", on: { click: () => modal("清除全部通話紀錄？", h("div"), [{ text: "取消" }, { text: "清除", primary: true, onClick: () => { Calls.clear(); showSub("stats"); } }]) } }) : null));

  root.appendChild(h("button", { class: "btn danger", text: "清除全部統計", on: { click: () =>
    modal("清除全部統計？", h("div", { class: "sub", text: "累積時間、走勢與排行都會歸零，無法復原。" }), [{ text: "取消" }, { text: "清除", primary: true, onClick: () => { Stats.clear(); showSub("stats"); } }]) } }));
}

// ---- review of mistakes
let reviewTab = "todo"; // "todo" | "done"
function reviewRefresh() { const y = window.scrollY; showSub("review"); window.scrollTo(0, y); }

function buildReview(root) {
  const all = Errs.all().sort((a, b) => (b.lt || b.ts) - (a.lt || a.ts));
  const todo = all.filter(e => !e.done), done = all.filter(e => e.done);
  const seg = (id, t) => h("button", { class: "seg" + (reviewTab === id ? " on" : ""), text: t, on: { click: () => { reviewTab = id; showSub("review"); } } });
  root.appendChild(h("div", { class: "segs" }, seg("todo", "待複習 " + todo.length), seg("done", "已學會 " + done.length)));
  if (reviewTab === "todo" && todo.length) root.appendChild(h("button", { class: "btn gold", text: "開始複習（" + todo.length + "）", on: { click: () => startQuiz(todo) } }));
  if (all.length) {
    root.appendChild(gap(8));
    root.appendChild(h("div", { class: "row" },
      h("div", { class: "grow" }, h("button", { class: "btn outline", text: "複製全部", on: { click: () => copyText(Errs.exportText()) } })),
      h("div", { class: "grow" }, h("button", { class: "btn outline", text: "清空已學會", style: done.length ? "" : "opacity:.4", on: { click: () => {
        if (!done.length) return;
        modal("清空「已學會」？", h("div", { class: "sub", text: "已學會的 " + done.length + " 項會被刪除，無法復原。" }), [{ text: "取消" }, { text: "清空", primary: true, onClick: () => { Errs.clearDone(); reviewRefresh(); } }]);
      } } }))));
    root.appendChild(gap(10));
  }
  const list = reviewTab === "todo" ? todo : done;
  if (!list.length) root.appendChild(note(reviewTab === "todo"
    ? "還沒有待複習的項目。每通電話結束後，系統會把最嚴重的幾個錯誤放進來。"
    : "還沒有學會的項目。複習時按「會了」，或在項目上按「我學會了」。"));
  list.forEach(e => root.appendChild(errCard(e)));
  if (all.length) root.appendChild(h("button", { class: "btn danger", text: "清空全部", on: { click: () =>
    modal("清空全部錯誤？", h("div", { class: "sub", text: "待複習和已學會共 " + all.length + " 項都會被刪除，無法復原。" }), [{ text: "取消" }, { text: "清空", primary: true, onClick: () => { Errs.clear(); reviewRefresh(); } }]) } }));
}

function errCard(e) {
  const d = new Date(e.lt || e.ts);
  const meta = (e.sev >= 3 ? "【重要】 " : "") + (d.getMonth() + 1) + "/" + d.getDate() + ((e.count || 1) > 1 ? "　出現 " + e.count + " 次" : "") + (e.topic ? "　" + e.topic : "");
  return h("div", { class: "ecard" },
    h("div", { class: "meta" + (e.sev >= 3 ? " imp" : ""), text: meta }),
    h("div", { class: "said", text: e.said }),
    h("div", { class: "better", text: e.better }),
    e.why ? h("div", { class: "why", text: e.why }) : null,
    h("div", { class: "acts" },
      h("button", { class: "pill", text: e.done ? "放回待複習" : "✓ 我學會了", on: { click: () => { Errs.setDone(e.id, !e.done); reviewRefresh(); } } }),
      h("button", { class: "pill", text: "複製", on: { click: () => copyText(e.said + " → " + e.better + (e.why ? "（" + e.why + "）" : "")) } }),
      h("button", { class: "pill", text: "刪除", on: { click: () => { Errs.remove(e.id); reviewRefresh(); } } })));
}

/** Flash-card review: shows what you said, then the better version; "會了" moves it to learned. */
function startQuiz(items) {
  const list = items.slice().sort(() => Math.random() - 0.5);
  let i = 0, revealed = false, close = null;
  const box = h("div", { class: "quiz" });
  function paint() {
    const e = list[i];
    box.replaceChildren(
      h("div", { class: "sub", text: (i + 1) + " / " + list.length }),
      h("div", { class: "sub", style: "margin-top:12px", text: "你當時說：" }),
      h("div", { class: "q", text: e.said }),
      revealed
        ? h("div", {}, h("div", { class: "sub", style: "margin-top:12px", text: "更好的說法：" }), h("div", { class: "a", text: e.better }), e.why ? h("div", { class: "note", style: "font-size:14px", text: e.why }) : null)
        : h("div", { class: "sub", style: "margin-top:12px", text: "先想想看，怎麼說比較好？" }),
      gap(14),
      h("div", { class: "row" }, !revealed
        ? h("button", { class: "pill gold", text: "看答案", on: { click: () => { revealed = true; paint(); } } })
        : [h("button", { class: "pill gold", text: "會了", on: { click: () => { Errs.setDone(e.id, true); next(); } } }),
           h("button", { class: "pill", text: "還不熟", on: { click: next } })]));
  }
  function next() { i++; revealed = false; if (i >= list.length) { close && close(); reviewRefresh(); toast("複習完了，做得好！"); } else paint(); }
  paint();
  close = modal("複習", box, [{ text: "結束", onClick: () => { setTimeout(reviewRefresh, 0); } }]);
}

function showCallDetail(r) {
  const fb = formatFeedback(r.feedback);
  const body = [fb, r.transcript].filter(Boolean).join("\n\n────────\n\n") || "（這通沒有留下文字）";
  modal(r.persona + " · " + r.topic, h("div", { class: "fb", style: "font-size:14px", text: body }), [
    { text: "複製", onClick: () => { copyText(body); return false; } }, { text: "關閉", primary: true }]);
}

function copyText(s) {
  const done = () => toast("已複製");
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(done).catch(() => fallbackCopy(s, done));
  else fallbackCopy(s, done);
}
function fallbackCopy(s, done) {
  const ta = h("textarea", { value: s, style: "position:fixed;opacity:0" });
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); done(); } catch (e) { toast("複製失敗，請長按文字手動複製"); }
  ta.remove();
}

function buildSystem(root) {
  // ---- Gemini key
  const keyIn = h("input", { class: "field", type: "password", placeholder: "Gemini API key", value: P.key, autocomplete: "off", autocapitalize: "off", spellcheck: false,
    on: { input: () => { P.key = keyIn.value.trim(); savePrefs(); } } });
  const result = h("div", { class: "note", style: "font-size:13px;white-space:pre-wrap;user-select:text" });
  const paste = h("button", { class: "btn outline", text: "貼上剪貼簿的 key", on: { click: async () => {
    try {
      const t = ((await navigator.clipboard.readText()) || "").trim();
      if (t.length < 20 || /\s/.test(t)) toast("剪貼簿裡沒有看起來像 key 的內容，請先複製 key");
      else { keyIn.value = t; P.key = t; savePrefs(); toast("已貼上，按「測試連線」確認"); }
    } catch (e) { toast("無法讀取剪貼簿，請長按輸入框貼上"); }
  } } });
  const test = h("button", { class: "btn gold", text: "測試連線", on: { click: async () => {
    if (!P.key) { result.textContent = "還沒有填 key"; return; }
    result.textContent = "測試中…";
    try {
      const reply = await geminiGenerate(P.key, ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash"], "Reply with the single word: OK", false);
      let live = "";
      try { const ms = await new LiveSession({ apiKey: P.key }).discover(); live = ms.length ? "\n即時語音：可用（" + ms[0] + "）" : "\n即時語音：這組 key 找不到支援的模型"; }
      catch (e) { live = "\n即時語音：查詢失敗"; }
      result.textContent = "✓ 連線成功（" + String(reply).trim().slice(0, 20) + "）" + live;
    } catch (e) { result.textContent = "✗ 失敗：" + (e.message || e); }
  } } });
  root.appendChild(card("Gemini 金鑰", keyIn, gap(10),
    h("div", { class: "row" }, h("div", { class: "grow" }, paste), h("div", { class: "grow" }, test)),
    h("button", { class: "btn ghost", text: "如何申請 key？", on: { click: showKeyGuide } }), result));

  // ---- barge-in
  root.appendChild(card(null,
    sw("允許插話（建議戴耳機）", "關閉時，對方說話那段時間不會收你的聲音，不會重複回應；開啟後可隨時打斷對方。", P.bargeIn, (v) => { P.bargeIn = v; savePrefs(); })));

  // ---- phone tips
  const url = PAGE_URL + "?ring=1";
  const steps = h("div", { class: "steps" },
    h("div", { class: "subhead", text: "加入主畫面（像 App 一樣用）" }),
    h("div", { text: "1.  用 Safari 開這個網頁，點下方的「分享」圖示" }),
    h("div", { text: "2.  選「加入主畫面」，按「加入」" }),
    h("div", { class: "subhead", text: "每天自動來電（用「捷徑」）" }),
    h("div", { text: "1.  打開「捷徑」App → 自動化 → 新增 → 特定時間" }),
    h("div", { text: "2.  選時間與重複，動作選「打開 URL」，貼上下面的網址" }),
    h("div", { text: "3.  關掉「執行前先詢問」，時間到網頁會自己打開並響鈴" }));
  root.appendChild(card("手機設定教學", steps, gap(8),
    h("div", { class: "field", style: "font-size:13px;word-break:break-all;user-select:all", text: url }), gap(8),
    h("button", { class: "btn outline", text: "複製網址", on: { click: () => copyText(url) } }),
    note("網頁沒辦法在背景自己響鈴；通話中切到別的 App 或鎖屏，聲音可能中斷。")));

  // ---- diagnostics
  const logs = Diag.logs();
  const err = Diag.lastError();
  const body = (err ? "最後一次錯誤：\n" + err + "\n\n" : "") + logs.map(l =>
    "── " + new Date(l.ts).toLocaleString() + "  " + l.persona + " · " + l.topic + "\n" + l.lines.join("\n")).join("\n\n");
  root.appendChild(card("診斷紀錄",
    body ? h("pre", { class: "log", text: body }) : note("目前沒有紀錄（每通電話會留下過程，保留最近 10 通）。"),
    body ? [gap(10), h("div", { class: "row" },
      h("div", { class: "grow" }, h("button", { class: "btn outline", text: "複製", on: { click: () => copyText(body) } })),
      h("div", { class: "grow" }, h("button", { class: "btn outline", text: "清除", on: { click: () => { Diag.clear(); showSub("system"); } } })))] : null));

  root.appendChild(h("div", { class: "footer", text: "AI 來電 練英文  ·  v" + VERSION }));
}

function showKeyGuide() {
  const body = h("div", { class: "steps" },
    h("div", { text: "1.  按下面「開啟申請頁」，用 Google 帳號登入" }),
    h("div", { text: "2.  按「Create API key」（建立 API 金鑰），選一個專案" }),
    h("div", { text: "3.  按 key 旁邊的複製圖示" }),
    h("div", { text: "4.  回到這個網頁，按「貼上剪貼簿的 key」" }),
    h("div", { text: "5.  按「測試連線」，看到 ✓ 就完成" }),
    note("免費額度內不收費，不用信用卡。免費層的內容可能被 Google 用來改進產品。key 是私人的，不要分享給別人，它只存在這台裝置的瀏覽器裡。"));
  modal("如何申請 Gemini key（免費）", body, [
    { text: "關閉" },
    { text: "開啟申請頁", primary: true, onClick: () => { window.open("https://aistudio.google.com/apikey", "_blank"); return false; } }]);
}

// ================================================================ start

window.addEventListener("error", (e) => { Diag.setError(new Date().toLocaleString() + "\n網頁錯誤：" + e.message); });
renderMain();
show("main");
if (new URLSearchParams(location.search).get("ring")) {
  history.replaceState(null, "", PAGE_URL);
  if (!P.key) toast("還沒有 Gemini 金鑰，請先到「系統」頁設定", 4500);
  setTimeout(showIncoming, 300);
}
