// 云端同步。数据放在一个私有 GitHub 仓库里，按年分文件：
//
//   config.json    成员、账户、期初、月度计划、设置（几 KB，改得少）
//   tx/2026.json   这一年的全部流水
//
// 为什么按年分：GitHub 单文件上限 1MB。一天 8 笔、一笔 250 字节，
// 一年约 730KB，刚好装得下；十年也不会超。
//
// 写入一律「读最新 → 改 → 带 sha 写回」，409 就重读重试。
// 这样两台手机同时记一笔不会互相覆盖。

import * as api from './api.js';
import { save } from './store.js';

const PENDING_KEY = 'family-ledger-pending';
const SETTINGS_KEY = 'family-ledger-pending-settings';

/* ================= 待传队列 ================= */
// 元素形状：{ op: 'put', id, date, tx } 或 { op: 'del', id, date }

export function getPending() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => x && x.id) : [];
  } catch {
    return [];
  }
}

function setPending(arr) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(arr));
  } catch {
    /* 存不下就算了 */
  }
}

function addPending(item) {
  const arr = getPending().filter((x) => x.id !== item.id);
  arr.push(item);
  setPending(arr);
}

function dropPending(id) {
  setPending(getPending().filter((x) => x.id !== id));
}

export function pendingCount() {
  return getPending().length;
}

/* ================= 设置文件 ================= */

function getPendingSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function mergePendingSettings(patch) {
  const cur = getPendingSettings() || {};
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...cur, ...patch }));
}

function clearPendingSettings() {
  localStorage.removeItem(SETTINGS_KEY);
}

const CONFIG_KEYS = ['members', 'accounts', 'opening', 'monthlyPlan', 'plans', 'settings'];

/** 把云端 config 覆盖到本地 state 上（保持 state 形状不变） */
export function applyConfig(state, cfg) {
  if (!cfg) return state;
  for (const k of CONFIG_KEYS) {
    if (cfg[k] === undefined || cfg[k] === null) continue;
    if (k === 'opening') state.opening = { ...state.opening, ...cfg[k] };
    else if (k === 'settings') state.settings = { ...state.settings, ...cfg[k] };
    else state[k] = cfg[k];
  }
  return state;
}

function configOf(state) {
  const out = {};
  for (const k of CONFIG_KEYS) out[k] = state[k];
  return out;
}

/* ================= 年份 ================= */

function yearOf(date) {
  const y = String(date || '').slice(0, 4);
  return /^\d{4}$/.test(y) ? y : String(new Date().getFullYear());
}

let knownYears = null;   // 记住 config 里登记过哪些年份，省一次请求

async function readConfig() {
  const f = await api.readJSON('config.json');
  return f;   // { data, sha } 或 null
}

async function ensureYear(year) {
  if (knownYears && knownYears.has(year)) return;
  const f = await readConfig();
  if (!f) return;
  const years = new Set((f.data.years || []).map(String));
  if (years.has(year)) {
    knownYears = years;
    return;
  }
  years.add(year);
  f.data.years = [...years].sort();
  try {
    await api.writeJSON('config.json', f.data, f.sha, `登记年份 ${year}`);
  } catch {
    /* 登记失败不影响流水本身 */
  }
  knownYears = years;
}

/* ================= 读 ================= */

/**
 * 拉一份完整的云端状态，盖到本地 state 上。
 * 还没上传成功的本地记录会叠在最后，不会丢。
 */
export async function pull(state) {
  const cfgFile = await readConfig();
  if (!cfgFile) {
    const e = new Error('仓库里还没有账本');
    e.code = 404;
    throw e;
  }

  const years = new Set((cfgFile.data.years || []).map(String));
  years.add(String(new Date().getFullYear()));
  knownYears = years;

  const server = [];
  for (const y of [...years].sort()) {
    const f = await api.readJSON(`tx/${y}.json`);
    if (f && Array.isArray(f.data.tx)) {
      for (const t of f.data.tx) {
        if (t && t.id && !t.deletedAt) server.push(t);
      }
    }
  }

  applyConfig(state, cfgFile.data);

  const ids = new Set(server.map((t) => t.id));
  const pend = getPending()
    .filter((p) => p.op === 'put' && p.tx && !ids.has(p.tx.id))
    .map((p) => p.tx);

  state.transactions = server.concat(pend).sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  return state;
}

/* ================= 写 ================= */

/**
 * 改某一年的流水文件。mutate(doc) 返回 false 表示没有变化、不用写。
 * 409 说明别人刚写过，重读再来，最多三次。
 */
async function mutateYear(year, mutate, message) {
  const path = `tx/${year}.json`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const f = await api.readJSON(path);
    const doc = f ? f.data : { year: Number(year), tx: [] };
    if (!Array.isArray(doc.tx)) doc.tx = [];

    const changed = mutate(doc);
    if (!changed) return;

    try {
      await api.writeJSON(path, doc, f ? f.sha : null, message || `记账 ${year}`);
      await ensureYear(year);
      return;
    } catch (e) {
      if (e.code !== 409) throw e;
      // 别人刚写过，等半秒重读
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
    }
  }
  throw new Error('写入冲突，稍后再点一次');
}

function upsertInto(doc, tx) {
  const i = doc.tx.findIndex((t) => t.id === tx.id);
  if (i >= 0) {
    const cur = doc.tx[i];
    if (cur.deletedAt) return false;                             // 已删，别复活
    if ((cur.updatedAt || 0) > (tx.updatedAt || 0)) return false; // 服务器上更新
    doc.tx[i] = { ...cur, ...tx };
    return true;
  }
  doc.tx.push(tx);
  return true;
}

function deleteFrom(doc, id) {
  const i = doc.tx.findIndex((t) => t.id === id);
  if (i < 0) return false;
  if (doc.tx[i].deletedAt) return false;
  doc.tx[i] = { ...doc.tx[i], deletedAt: new Date().toISOString() };
  return true;
}

async function applyPut(tx) {
  await mutateYear(yearOf(tx.date), (doc) => upsertInto(doc, tx), `记账 ${tx.date} ¥${(tx.amount / 100).toFixed(2)}`);
}

async function applyDelete(date, id) {
  await mutateYear(yearOf(date), (doc) => deleteFrom(doc, id), `删除一笔 ${date}`);
}

/**
 * 记一笔：先落本地队列再传。返回 true 表示已经上云。
 * 传不上去也不报错——留在队列里，下次打开或回到前台自动补。
 */
export async function pushTx(state, tx) {
  addPending({ op: 'put', id: tx.id, date: tx.date, tx });
  save(state);
  try {
    await applyPut(tx);
    dropPending(tx.id);
    return true;
  } catch {
    return false;
  }
}

export async function pushDelete(state, id) {
  const i = state.transactions.findIndex((t) => t.id === id);
  const t = i >= 0 ? state.transactions[i] : null;
  if (i >= 0) state.transactions.splice(i, 1);
  dropPending(id);
  save(state);
  if (!t) return true;

  addPending({ op: 'del', id, date: t.date });
  try {
    await applyDelete(t.date, id);
    dropPending(id);
    return true;
  } catch {
    return false;
  }
}

/* ---------- 设置 ---------- */

async function applySettingsPatch(patch) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const f = await readConfig();
    if (!f) throw new Error('仓库里还没有账本');
    for (const k of CONFIG_KEYS) {
      if (patch[k] === undefined) continue;
      f.data[k] = patch[k];
    }
    try {
      await api.writeJSON('config.json', f.data, f.sha, '改设置');
      return;
    } catch (e) {
      if (e.code !== 409) throw e;
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
    }
  }
  throw new Error('写入冲突，稍后再点一次');
}

export async function pushSettings(state, patch) {
  Object.assign(state, patch);
  save(state);
  try {
    await applySettingsPatch(patch);
    return true;
  } catch {
    mergePendingSettings(patch);
    return false;
  }
}

async function flushSettings() {
  const patch = getPendingSettings();
  if (!patch) return;
  try {
    await applySettingsPatch(patch);
    clearPendingSettings();
  } catch (e) {
    if (e.code >= 400 && e.code < 500) clearPendingSettings();
    throw e;
  }
}

/* ================= 补传 ================= */

/** 把积压的记录补上去，返回成功条数 */
export async function flush() {
  const arr = getPending();
  let done = 0;
  for (const item of arr) {
    try {
      if (item.op === 'put') await applyPut(item.tx);
      else await applyDelete(item.date, item.id);
      dropPending(item.id);
      done++;
    } catch (e) {
      // 队列本身不合法（比如 400/404）就丢掉，免得永远卡住；
      // 409 是冲突，网络错误是 0，都留到下次
      if (e.code >= 400 && e.code < 500 && e.code !== 409) {
        dropPending(item.id);
        continue;
      }
      break;
    }
  }
  await flushSettings();
  return done;
}

/* ================= 首次初始化 ================= */

/**
 * 仓库还是空的时，把本地 state 写成 config.json（years 先留空）。
 * 只在第一次连接用。
 */
export async function initRepo(state) {
  const f = await readConfig();
  if (f) return false;   // 已经有账本了，别覆盖
  const cfg = configOf(state);
  cfg.version = 1;
  cfg.years = [String(new Date().getFullYear())];
  await api.writeJSON('config.json', cfg, null, '初始化账本');
  knownYears = new Set(cfg.years);
  return true;
}
