/* Realtime voice conversation over the Gemini Live API (WebSocket), in the browser.
   Microphone streams up as 16 kHz PCM, the model's 24 kHz voice streams back and is scheduled for playback. */
"use strict";

const LIVE_FALLBACK_MODELS = [
  "gemini-2.5-flash-native-audio-preview-12-2025",
  "gemini-2.5-flash-native-audio-preview-09-2025",
  "gemini-2.0-flash-live-001"
];

function b64FromBytes(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x2000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x2000));
  return btoa(s);
}
function bytesFromB64(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

class LiveSession {
  /**
   * o: { apiKey, savedModel, voice, system, cue, ctx, stream, isMuted(), allowBargeIn(),
   *      onModelChosen(m), onLog(s), onModelText(s), onUserText(s), onFail(err) }
   */
  constructor(o) {
    this.o = o;
    this.ctx = o.ctx;
    this.closed = false;
    this.ready = false;
    this.gotAudio = false;
    this.candidates = [];
    this.candIdx = 0;
    this.ws = null;
    this.sources = new Set();
    this.nextTime = 0;
    this.sent = 0;
    this.micNode = null;
    this.out = null;
  }

  async start() {
    try {
      const list = [];
      if (this.o.savedModel) list.push(this.o.savedModel);
      try { for (const m of await this.discover()) if (!list.includes(m)) list.push(m); }
      catch (e) { this.o.onLog("查詢即時模型失敗：" + (e.message || e)); }
      if (!list.length) for (const m of LIVE_FALLBACK_MODELS) list.push(m);
      this.candidates = list.slice(0, 4);
      this.connect();
    } catch (e) { if (!this.closed) this.o.onFail(e); }
  }

  async discover() {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=" + encodeURIComponent(this.o.apiKey));
    if (!r.ok) return [];
    const j = await r.json();
    const found = [];
    for (const m of (j.models || [])) {
      if (!(m.supportedGenerationMethods || []).includes("bidiGenerateContent")) continue;
      const name = m.name.replace(/^models\//, "");
      const ver = parseFloat((name.match(/(\d+(?:\.\d+)?)/) || [0, "0"])[1]) || 0;
      let s = ver;
      if (name.includes("native-audio") || name.includes("live")) s += 100;
      if (name.includes("preview") || name.includes("exp")) s -= 0.5;
      if (name.includes("thinking") || name.includes("extended")) s -= 3;
      found.push({ s, name });
    }
    found.sort((a, b) => b.s - a.s);
    return found.map(f => f.name);
  }

  connect() {
    const model = this.candidates[this.candIdx];
    this.o.onLog("連線即時模型：" + model);
    const url = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=" + encodeURIComponent(this.o.apiKey);
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      ws.send(JSON.stringify({
        setup: {
          model: "models/" + model,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.o.voice } } }
          },
          systemInstruction: { parts: [{ text: this.o.system }] },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          contextWindowCompression: { slidingWindow: {} }
        }
      }));
    };
    ws.onmessage = (ev) => {
      if (ws !== this.ws) return;
      let text;
      if (typeof ev.data === "string") text = ev.data;
      else text = new TextDecoder().decode(ev.data);
      this.handle(text, model);
    };
    ws.onclose = (ev) => { if (ws === this.ws) this.fail(model, "連線被關閉（" + ev.code + "）" + (ev.reason || "")); };
    ws.onerror = () => { if (ws === this.ws && !opened) this.fail(model, "連線失敗（網路不通，或 key 無法使用）"); };
  }

  fail(model, msg) {
    if (this.closed) return;
    if (!this.ready && this.candIdx + 1 < this.candidates.length) {
      this.o.onLog(model + " 不能用（" + msg + "），換下一個");
      this.candIdx++;
      try { this.ws && (this.ws.onclose = null, this.ws.onerror = null, this.ws.close()); } catch (e) {}
      this.connect();
      return;
    }
    this.closed = true;
    this.stopAudio();
    const low = msg.toLowerCase();
    let friendly = null;
    if (low.includes("quota") || low.includes("exhausted") || low.includes("429") || low.includes("rate"))
      friendly = "即時語音的免費額度用完了，請稍後再試（每天會重置）。\n" + msg;
    else if (low.includes("api key") || low.includes("403") || low.includes("permission") || low.includes("1008"))
      friendly = "這組 API key 沒有即時語音的權限，或已失效。\n" + msg;
    this.o.onFail(new Error(friendly || msg));
  }

  handle(raw, model) {
    let o;
    try { o = JSON.parse(raw); } catch (e) { return; }
    if (o.setupComplete) {
      this.ready = true;
      this.o.onModelChosen(model);
      this.o.onLog("即時連線成功，開始通話");
      this.startAudio().then(() => {
        this.sendCue(false);
        setTimeout(() => {
          if (!this.closed && !this.gotAudio) { this.o.onLog("6 秒沒聲音，改用另一種方式叫對方開口"); this.sendCue(true); }
        }, 6000);
      }).catch(e => { if (!this.closed) { this.closed = true; this.stopAudio(); this.o.onFail(e); } });
      return;
    }
    if (o.goAway) this.o.onLog("伺服器通知即將中斷連線");
    const sc = o.serverContent;
    if (!sc) return;
    if (sc.interrupted) { this.flushPlayback(); this.o.onLog("你插話了，對方停下"); }
    const parts = sc.modelTurn && sc.modelTurn.parts;
    if (parts) {
      for (const p of parts) {
        const d = p.inlineData && p.inlineData.data;
        if (!d) continue;
        if (!this.gotAudio) { this.gotAudio = true; this.o.onLog("收到對方第一段聲音"); }
        this.play(bytesFromB64(d));
      }
    }
    if (sc.inputTranscription && sc.inputTranscription.text && sc.inputTranscription.text.trim()) {
      this.o.onLog("你：" + sc.inputTranscription.text.trim());
      this.o.onUserText(sc.inputTranscription.text);
    }
    if (sc.outputTranscription && sc.outputTranscription.text && sc.outputTranscription.text.trim())
      this.o.onModelText(sc.outputTranscription.text);
    if (sc.turnComplete) this.o.onModelText("\u0000");
  }

  sendCue(asRealtime) {
    const msg = asRealtime
      ? { realtimeInput: { text: this.o.cue } }
      : { clientContent: { turns: [{ role: "user", parts: [{ text: this.o.cue }] }], turnComplete: true } };
    this.send(msg);
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  // ---------------------------------------------------------------- audio

  async startAudio() {
    const ctx = this.ctx;
    if (ctx.state !== "running") { try { await ctx.resume(); } catch (e) {} }
    this.out = ctx.createGain();
    this.out.connect(ctx.destination);

    const src = ctx.createMediaStreamSource(this.o.stream);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    mute.connect(ctx.destination);
    if (ctx.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      await ctx.audioWorklet.addModule("mic-worklet.js");
      const node = new AudioWorkletNode(ctx, "mic-proc");
      node.port.onmessage = (e) => this.onMic(new Int16Array(e.data));
      src.connect(node);
      node.connect(mute);
      this.micNode = node;
    } else {
      // Fallback for old browsers: ScriptProcessor in the main thread
      const proc = ctx.createScriptProcessor(2048, 1, 1);
      const ratio = ctx.sampleRate / 16000;
      let phase = 0, sum = 0, cnt = 0, buf = new Int16Array(640), n = 0;
      proc.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0);
        for (let i = 0; i < ch.length; i++) {
          sum += ch[i]; cnt++; phase += 1;
          if (phase >= ratio) {
            let v = Math.max(-1, Math.min(1, sum / cnt));
            sum = 0; cnt = 0; phase -= ratio;
            buf[n++] = v < 0 ? v * 32768 : v * 32767;
            if (n === 640) { this.onMic(buf); buf = new Int16Array(640); n = 0; }
          }
        }
      };
      src.connect(proc);
      proc.connect(mute);
      this.micNode = proc;
    }
  }

  /** True while the model's voice is playing (or just finished). */
  speaking() {
    return this.ctx.currentTime < this.nextTime + 0.35;
  }

  onMic(pcm) {
    if (this.closed || !this.ready) return;
    if (this.o.isMuted()) return;
    let data = pcm;
    // Without headphones the speaker would feed the microphone, so keep the mic silent while the caller talks.
    if (!this.o.allowBargeIn() && this.speaking()) data = new Int16Array(pcm.length);
    this.send({ realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: b64FromBytes(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)) } } });
    if (++this.sent === 1) this.o.onLog("開始傳送麥克風聲音");
  }

  play(bytes) {
    if (this.closed) return;
    const n = Math.floor(bytes.length / 2);
    if (!n) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = view.getInt16(i * 2, true) / 32768;
    const buf = this.ctx.createBuffer(1, n, 24000);
    buf.copyToChannel(f, 0);
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.connect(this.out);
    const now = this.ctx.currentTime;
    const t = Math.max(now + 0.04, this.nextTime);
    s.start(t);
    this.nextTime = t + buf.duration;
    this.sources.add(s);
    s.onended = () => this.sources.delete(s);
  }

  flushPlayback() {
    for (const s of this.sources) { try { s.onended = null; s.stop(); } catch (e) {} }
    this.sources.clear();
    this.nextTime = 0;
  }

  stopAudio() {
    this.flushPlayback();
    try { if (this.micNode) { this.micNode.disconnect(); if (this.micNode.port) this.micNode.port.onmessage = null; } } catch (e) {}
    this.micNode = null;
  }

  close() {
    if (this.closed) { this.stopAudio(); return; }
    this.closed = true;
    try { if (this.ws) { this.ws.onclose = null; this.ws.onerror = null; this.ws.close(1000, "bye"); } } catch (e) {}
    this.stopAudio();
  }
}

/** One-shot request used for the after-call tip and the connection test. */
async function geminiGenerate(apiKey, models, text, json) {
  let last = null;
  for (const m of models) {
    try {
      const body = { contents: [{ parts: [{ text }] }] };
      if (json) body.generationConfig = { responseMimeType: "application/json", temperature: 0.4 };
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent?key=" + encodeURIComponent(apiKey), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
      const t = await r.text();
      if (!r.ok) throw new Error("HTTP " + r.status + " " + t.slice(0, 200));
      const j = JSON.parse(t);
      return j.candidates[0].content.parts[0].text;
    } catch (e) { last = e; }
  }
  throw last || new Error("沒有可用的模型");
}
