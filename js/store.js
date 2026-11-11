const KEY = 'family-ledger-v1';
const VERSION = 1;

export function defaultState() {
  return {
    version: VERSION,
    members: [
      { id: 'm1', name: '老公', allowance: 100000 },
      { id: 'm2', name: '媳妇', allowance: 200000 },
    ],
    accounts: [
      { id: 'joint', name: '共同池', type: 'joint', ownerId: null },
      { id: 'm1_allow', name: '老公零花', type: 'allowance', ownerId: 'm1' },
      { id: 'm2_allow', name: '媳妇零花', type: 'allowance', ownerId: 'm2' },
    ],
    // 期初余额（分）。改这里等于"从现在开始记账"
    opening: { joint: 0, m1_allow: 0, m2_allow: 0 },
    transactions: [],
    // 共同池月度计划（分），可按月覆盖
    monthlyPlan: 1950000,
    plans: {},
    settings: { bigThreshold: 50000 },
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return migrate(parsed);
  } catch (err) {
    console.error('读取本地数据失败', err);
    return defaultState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.error('保存失败', err);
  }
}

export function wipe() {
  localStorage.removeItem(KEY);
}

function migrate(s) {
  const base = defaultState();
  return {
    ...base,
    ...s,
    members: s.members || base.members,
    accounts: s.accounts || base.accounts,
    opening: { ...base.opening, ...(s.opening || {}) },
    transactions: s.transactions || [],
    plans: s.plans || {},
    settings: { ...base.settings, ...(s.settings || {}) },
    version: VERSION,
  };
}

export function exportJSON(state) {
  return JSON.stringify(state, null, 2);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.transactions)) {
    throw new Error('文件格式不对：缺少 transactions');
  }
  return migrate(parsed);
}
