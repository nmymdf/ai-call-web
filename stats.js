/* Practice statistics, kept on this device only (localStorage). Port of Stats.kt. */
"use strict";

const Stats = (() => {
  const KEY = "aicall_stats";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} };
  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const sec = (days, d) => (days[dayKey(d)] || [0, 0])[0];
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  function add(seconds, startMs, persona, topic, level) {
    const s = load();
    s.days = s.days || {};
    const k = dayKey(new Date());
    const cur = s.days[k] || [0, 0];
    s.days[k] = [cur[0] + seconds, cur[1] + 1];
    s.dims = s.dims || {};
    const bump = (g, n) => { s.dims[g] = s.dims[g] || {}; s.dims[g][n] = (s.dims[g][n] || 0) + seconds; };
    bump("hour", String(new Date(startMs).getHours()));
    bump("persona", persona);
    bump("topic", topic);
    bump("level", String(level));
    s.totalSec = (s.totalSec || 0) + seconds;
    s.totalCalls = (s.totalCalls || 0) + 1;
    save(s);
  }

  const days = () => load().days || {};
  const dim = (g) => (load().dims || {})[g] || {};

  function daily(n) {
    const d = days(), out = [];
    let c = new Date();
    for (let i = 0; i < n; i++) { out.push({ label: (c.getMonth() + 1) + "/" + c.getDate(), sec: sec(d, c) }); c = addDays(c, -1); }
    return out.reverse();
  }
  function weekly(n) {
    const d = days(), out = [];
    let c = new Date();
    for (let w = 0; w < n; w++) {
      let sum = 0;
      const end = (c.getMonth() + 1) + "/" + c.getDate();
      for (let i = 0; i < 7; i++) { sum += sec(d, c); c = addDays(c, -1); }
      out.push({ label: end, sec: sum });
    }
    return out.reverse();
  }
  function monthly(n) {
    const d = days(), sums = {};
    for (const k of Object.keys(d)) { const ym = k.slice(0, 7); sums[ym] = (sums[ym] || 0) + d[k][0]; }
    const out = [];
    let c = new Date(); c.setDate(1);
    for (let i = 0; i < n; i++) {
      const ym = c.getFullYear() + "-" + pad(c.getMonth() + 1);
      out.push({ label: (c.getMonth() + 1) + "月", sec: sums[ym] || 0 });
      c.setMonth(c.getMonth() - 1);
    }
    return out.reverse();
  }
  function firstDay() { const k = Object.keys(days()).sort()[0]; return k ? new Date(k + "T00:00:00") : null; }
  function monthsSinceFirst() {
    const f = firstDay(); if (!f) return 1;
    const n = new Date();
    return Math.max(1, (n.getFullYear() - f.getFullYear()) * 12 + (n.getMonth() - f.getMonth()) + 1);
  }
  function weeksSinceFirst() {
    const f = firstDay(); if (!f) return 1;
    const n = Math.floor((Date.now() - f.getTime()) / 86400000) + 1;
    return Math.max(1, Math.ceil(n / 7));
  }
  function activeDays() { return Object.keys(days()).length; }
  function weekday() {
    const d = days(), out = [0, 0, 0, 0, 0, 0, 0];
    for (const k of Object.keys(d)) out[(new Date(k + "T00:00:00").getDay() + 6) % 7] += d[k][0];
    return out;
  }
  function weekCompare() {
    const d = days();
    let a = 0, b = 0, c = new Date();
    for (let i = 0; i < 14; i++) { if (i < 7) a += sec(d, c); else b += sec(d, c); c = addDays(c, -1); }
    return [a, b];
  }
  function goalStreak(goalSec) {
    const d = days();
    let c = new Date();
    if (sec(d, c) < goalSec) c = addDays(c, -1);
    let n = 0;
    while (goalSec > 0 && sec(d, c) >= goalSec) { n++; c = addDays(c, -1); }
    return n;
  }
  function summary() {
    const s = load(), d = days();
    const today = sec(d, new Date());
    let c = new Date();
    if (sec(d, c) === 0) c = addDays(c, -1);
    let streak = 0;
    while (sec(d, c) > 0) { streak++; c = addDays(c, -1); }
    return { todaySec: today, totalSec: s.totalSec || 0, totalCalls: s.totalCalls || 0, streakDays: streak };
  }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }

  function fmt(s) {
    const m = Math.floor(s / 60);
    if (s <= 0) return "0 分";
    if (m < 1) return "不到 1 分";
    if (m < 60) return m + " 分";
    return Math.floor(m / 60) + " 小時 " + (m % 60) + " 分";
  }
  function shortFmt(s) {
    const m = Math.floor(s / 60);
    if (s <= 0) return "—";
    if (m < 1) return "<1分";
    if (m < 60) return m + "分";
    return Math.floor(m / 60) + "時" + (m % 60) + "分";
  }

  return { add, dim, daily, weekly, monthly, monthsSinceFirst, weeksSinceFirst, activeDays, weekday, weekCompare, goalStreak, summary, clear, fmt, shortFmt };
})();
