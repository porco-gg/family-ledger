// 纯逻辑：金额、余额、月度统计。不碰 DOM。

export const CATS = [
  { id: 'food', name: '吃饭', icon: '🍜' },
  { id: 'daily', name: '日用', icon: '🧴' },
  { id: 'baby', name: '宝宝', icon: '🍼' },
  { id: 'car', name: '车辆', icon: '🚗' },
  { id: 'flex', name: '弹性', icon: '🎁' },
  { id: 'house', name: '房贷物业', icon: '🏠' },
  { id: 'utility', name: '水电燃气', icon: '💡' },
  { id: 'commute', name: '通勤通讯', icon: '📱' },
  { id: 'insurance', name: '保险', icon: '🛡️' },
  { id: 'mom', name: '母亲补贴', icon: '👵' },
  { id: 'other', name: '其他', icon: '📦' },
];

export const INCOME_CATS = [
  { id: 'salary', name: '工资', icon: '💰' },
  { id: 'extra', name: '额外收入', icon: '🧧' },
];

const CAT_MAP = new Map([...CATS, ...INCOME_CATS].map((c) => [c.id, c]));

export function cat(id) {
  return CAT_MAP.get(id) || { id, name: id, icon: '📦' };
}

/* ---------------- 日期 ---------------- */

export function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function monthOf(dateStr) {
  return String(dateStr).slice(0, 7);
}

export function todayMonth() {
  return todayISO().slice(0, 7);
}

export function shiftMonth(mk, delta) {
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(mk) {
  const [y, m] = mk.split('-');
  return `${y}年${Number(m)}月`;
}

export function daysInMonth(mk) {
  const [y, m] = mk.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export function dayLabel(dateStr) {
  const [, m, d] = dateStr.split('-');
  const today = todayISO();
  if (dateStr === today) return '今天';
  const y = new Date();
  const yest = new Date(y.getFullYear(), y.getMonth(), y.getDate() - 1);
  const p = (n) => String(n).padStart(2, '0');
  const yStr = `${yest.getFullYear()}-${p(yest.getMonth() + 1)}-${p(yest.getDate())}`;
  if (dateStr === yStr) return '昨天';
  return `${Number(m)}月${Number(d)}日`;
}

/* ---------------- 金额 ---------------- */

export function fmt(cents) {
  const n = Math.round(cents || 0);
  const neg = n < 0;
  const v = Math.abs(n);
  const yuan = Math.floor(v / 100);
  const fen = v % 100;
  return (neg ? '-' : '') + yuan.toLocaleString('zh-CN') + '.' + String(fen).padStart(2, '0');
}

export function fmtInt(cents) {
  const n = Math.round((cents || 0) / 100);
  return (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('zh-CN');
}

export function parseAmount(str) {
  const s = String(str || '').trim();
  if (!s || s === '.') return 0;
  const num = Number(s);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100);
}

export function centsToInput(cents) {
  const v = Math.round(cents || 0);
  return v % 100 === 0 ? String(v / 100) : (v / 100).toFixed(2);
}

/* ---------------- 余额 ---------------- */

export function account(state, id) {
  return state.accounts.find((a) => a.id === id) || null;
}

export function joint(state) {
  return state.accounts.find((a) => a.type === 'joint');
}

export function allowanceOf(state, memberId) {
  return state.accounts.find((a) => a.type === 'allowance' && a.ownerId === memberId);
}

export function balanceOf(state, accountId) {
  let bal = state.opening[accountId] || 0;
  for (const t of state.transactions) {
    if (t.type === 'expense') {
      if (t.accountId === accountId) bal -= t.amount;
    } else if (t.type === 'refund') {
      if (t.accountId === accountId) bal += t.amount;
    } else if (t.type === 'income') {
      if (t.accountId === accountId) bal += t.amount;
    } else if (t.type === 'transfer') {
      if (t.accountId === accountId) bal -= t.amount;
      if (t.toAccountId === accountId) bal += t.amount;
    }
  }
  return bal;
}

/* ---------------- 月度统计 ---------------- */

export function monthExpense(state, mk, accountId) {
  let sum = 0;
  for (const t of state.transactions) {
    const sign = t.type === 'expense' ? 1 : t.type === 'refund' ? -1 : 0;
    if (!sign) continue;
    if (monthOf(t.date) !== mk) continue;
    if (accountId && t.accountId !== accountId) continue;
    sum += sign * t.amount;
  }
  return sum;
}

export function monthExpenseByCat(state, mk, accountId) {
  const map = new Map();
  for (const t of state.transactions) {
    const sign = t.type === 'expense' ? 1 : t.type === 'refund' ? -1 : 0;
    if (!sign) continue;
    if (monthOf(t.date) !== mk) continue;
    if (accountId && t.accountId !== accountId) continue;
    map.set(t.category, (map.get(t.category) || 0) + sign * t.amount);
  }
  return map;
}

/** 某一笔原支出已经被退回来的总额（部分退货会退多次）。 */
export function refundedOf(state, txId) {
  let sum = 0;
  for (const t of state.transactions) {
    if (t.type === 'refund' && t.refundOf === txId) sum += t.amount;
  }
  return sum;
}

export function planOf(state, mk) {
  const v = state.plans[mk];
  return typeof v === 'number' ? v : state.monthlyPlan;
}

export function txOfMonth(state, mk) {
  return state.transactions
    .filter((t) => monthOf(t.date) === mk)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
}

export function hasPayroll(state, mk) {
  return state.transactions.some((t) => t.type === 'income' && t.category === 'salary' && monthOf(t.date) === mk);
}

/* ---------------- 垫付 ---------------- */

/**
 * 垫付的钱：算共同池的支出（预算已扣），但卡没动，等对方转账过来。
 * 所以余额在记账时就扣了，结算只是把"谁欠谁"这笔账标掉，不再动余额。
 */
export function advanceList(state) {
  return state.transactions.filter((t) => t.advance && !t.settledAt);
}

/**
 * 待结算的垫付，按"谁垫的"分组。
 * 老数据没有 paidBy，一律算老公垫的（历史上只有他会垫）。
 */
export function advancePending(state) {
  const list = advanceList(state);
  const m1 = { count: 0, total: 0 };
  const m2 = { count: 0, total: 0 };
  for (const t of list) {
    const bucket = t.paidBy === 'm2' ? m2 : m1;
    bucket.count += 1;
    bucket.total += t.amount;
  }
  return { count: list.length, total: m1.total + m2.total, m1, m2 };
}

/** 把某一条补记成垫付 / 取消垫付。只改标记，不动金额和余额。 */
export function setAdvance(state, id, on, paidBy) {
  const t = state.transactions.find((x) => x.id === id);
  if (!t) return null;
  if (on) {
    t.advance = true;
    t.paidBy = paidBy || 'm1';
    delete t.settledAt;
  } else {
    delete t.advance;
    delete t.paidBy;
    delete t.settledAt;
  }
  return t;
}

/** 把这些垫付标记为已结算，返回标记掉的记录（要推上云） */
export function settleAdvances(state, dateStr) {
  const list = advanceList(state);
  for (const t of list) t.settledAt = dateStr;
  return list;
}

/* ---------------- 排序 ---------------- */

/**
 * key: 'time' | 'amount'，dir: 'asc' | 'desc'。
 * 按金额排时转账固定排在最后——记工资那两笔金额大，会把真实支出挤下去。
 */
export function sortTx(list, key, dir) {
  const mul = dir === 'asc' ? 1 : -1;
  const out = list.slice();

  if (key === 'amount') {
    const normal = out.filter((t) => t.type !== 'transfer');
    const transfers = out.filter((t) => t.type === 'transfer');
    normal.sort((a, b) => (a.amount - b.amount) * mul || (a.id < b.id ? -1 : 1));
    transfers.sort((a, b) => b.amount - a.amount);
    return normal.concat(transfers);
  }

  out.sort((a, b) => {
    if (a.date !== b.date) return (a.date < b.date ? -1 : 1) * mul;
    return ((a.createdAt || 0) - (b.createdAt || 0)) * mul;
  });
  return out;
}

/* ---------------- 写操作 ---------------- */

let seq = 0;
function nid() {
  seq += 1;
  const rand = Math.random().toString(36).slice(2, 6);
  return `t_${Date.now().toString(36)}_${seq.toString(36)}${rand}`;
}

export function addTx(state, tx) {
  const record = {
    id: nid(),
    createdAt: Date.now(),
    note: '',
    ...tx,
    amount: Math.round(tx.amount),
  };
  state.transactions.push(record);
  return record;
}

export function removeTx(state, id) {
  const i = state.transactions.findIndex((t) => t.id === id);
  if (i >= 0) state.transactions.splice(i, 1);
}

/**
 * 记一笔工资：每人到手金额进共同池，再按零花钱额度转出到各自账户。
 * entries: [{ memberId, amount }]
 */
export function recordPayroll(state, mk, dateStr, entries) {
  const jt = joint(state);
  const created = [];
  for (const e of entries) {
    if (!e.amount) continue;
    const m = state.members.find((x) => x.id === e.memberId);
    created.push(addTx(state, {
      type: 'income',
      accountId: jt.id,
      amount: e.amount,
      category: 'salary',
      memberId: e.memberId,
      date: dateStr,
      note: `${m ? m.name : ''}工资`,
    }));
  }
  for (const e of entries) {
    const m = state.members.find((x) => x.id === e.memberId);
    if (!m || !m.allowance) continue;
    const acc = allowanceOf(state, m.id);
    if (!acc) continue;
    created.push(addTx(state, {
      type: 'transfer',
      accountId: jt.id,
      toAccountId: acc.id,
      amount: m.allowance,
      category: 'other',
      date: dateStr,
      note: `${m.name}零花钱`,
    }));
  }
  return created;
}
