import { load, save, wipe, exportJSON, importJSON } from './store.js';
import * as M from './model.js';
import * as api from './api.js';
import * as sync from './sync.js';

const app = document.getElementById('app');

let state = load();
let view = 'home';            // home | list | more | add
let month = M.todayMonth();
let add = null;
let filterAcc = 'all';   // 明细筛选：全部 / 某个账户
let filterCat = '';      // 明细筛选：空 = 全部分类
let sortKey = 'time';    // 明细排序：time | amount
let sortDir = 'desc';    // desc 新→旧 / 大→小；asc 旧→新 / 小→大
let session = api.getSession();
let syncMsg = '';
let connectErr = '';     // 连接页的错误提示
let connectRole = 'm1';  // 这台手机是谁在用

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

/* ================= 工具 ================= */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function persist() {
  save(state);
  render();
}

/** 改设置：本地先生效，再往云端推（没网就排队） */
function saveSettings(patch) {
  Object.assign(state, patch);
  save(state);
  render();
  sync.pushSettings(state, patch).then((okDone) => {
    if (!okDone) {
      syncMsg = '设置先存在手机上，联网后自动同步';
      render();
    }
  });
}

function setView(v) {
  view = v;
  if (v === 'add') {
    if (!add) add = newAdd();
  } else {
    add = null;
  }
  window.scrollTo(0, 0);
  render();
}

function newAdd() {
  // 老公的共同支出基本都走他自己的卡/信用卡，所以默认勾上「我垫的」；
  // 媳妇付的共同支出直接从共同池的卡出，默认不勾。
  const role = session && session.role ? session.role : '';
  return {
    mode: 'expense',
    amountStr: '',
    catId: 'food',
    accountId: 'joint',
    note: '',
    date: M.todayISO(),
    advance: role === 'm1',
    paidBy: role || 'm1',
  };
}

/* ================= 渲染入口 ================= */

function render() {
  if (!session) {
    app.classList.remove('no-tab');
    app.innerHTML = renderLogin();
    return;
  }
  if (view === 'add') {
    app.classList.add('no-tab');   // 记一笔页不渲染底部导航，别给它留 62px 的空
    // 每按一个数字都会整页重绘，滚动位置默认会跳回顶部，看着像内容在动。
    // 记住再还原，手指不用重新找位置。
    const prev = app.querySelector ? app.querySelector('.add-scroll') : null;
    const top = prev ? prev.scrollTop : 0;
    app.innerHTML = renderAdd();
    if (top) {
      const next = app.querySelector ? app.querySelector('.add-scroll') : null;
      if (next) next.scrollTop = top;
    }
    return;
  }
  app.classList.remove('no-tab');
  let body = '';
  if (view === 'home') body = renderHome();
  else if (view === 'list') body = renderList();
  else body = renderMore();
  app.innerHTML = body + (view !== 'add' ? fab() : '') + renderTabbar();
}

function renderLogin() {
  const roleBtn = (id, label) =>
    `<button class="${connectRole === id ? 'on' : ''}" data-act="cf-role" data-v="${id}">${label}</button>`;
  return `
  <div class="login-wrap">
    <div class="login-logo">账</div>
    <div class="login-title">家庭账本</div>
    <div class="login-sub">两个人，一本账</div>
    <label class="login-field"><input id="cf-owner" placeholder="GitHub 用户名" autocapitalize="off" autocorrect="off" autocomplete="off"></label>
    <label class="login-field"><input id="cf-repo" placeholder="数据仓库名" autocapitalize="off" autocorrect="off" autocomplete="off" value="family-ledger-data"></label>
    <label class="login-field"><input id="cf-token" type="password" placeholder="访问令牌（github_pat_ 开头）" autocomplete="off"></label>
    <div class="setup-sec">这个手机是谁在用</div>
    <div class="seg" style="margin:0 0 16px">${roleBtn('m1', '老公')}${roleBtn('m2', '媳妇')}</div>
    <button class="login-btn" data-act="login">连接</button>
    <div class="login-err" id="login-err">${esc(connectErr)}</div>
    <div class="login-foot">令牌只存在这台手机上，不会传到别处</div>
  </div>`;
}

function fab() {
  return `<button class="fab" data-act="nav" data-v="add" aria-label="记一笔">＋</button>`;
}

function renderTabbar() {
  const tabs = [
    { id: 'home', name: '首页', ico: '🏠' },
    { id: 'list', name: '明细', ico: '🧾' },
    { id: 'more', name: '更多', ico: '⚙️' },
  ];
  return `<nav class="tabbar">${tabs.map((t) => `
    <button class="tab ${view === t.id ? 'on' : ''}" data-act="nav" data-v="${t.id}">
      <span class="ico">${t.ico}</span><span>${t.name}</span>
    </button>`).join('')}</nav>`;
}

function monthSwitch() {
  return `<div class="month-switch">
    <button data-act="month" data-v="-1">‹</button>
    <span class="cur">${M.monthLabel(month)}</span>
    <button data-act="month" data-v="1">›</button>
  </div>`;
}

/* ================= 首页 ================= */

function memberName(role) {
  const m = state.members.find((x) => x.id === role);
  return m ? m.name : (role === 'm2' ? '媳妇' : '老公');
}

/** 首页那条垫付提示：一个人垫就说清是谁，两个人都垫了就只说总数 */
function advText(adv) {
  const total = `共 ${M.fmtInt(adv.total)} 元`;
  if (adv.m1.count && adv.m2.count) return `${adv.count} 笔垫付待结算 · ${total}`;
  if (adv.m2.count) return `${memberName('m2')}垫付 ${adv.m2.count} 笔 · ${M.fmtInt(adv.total)} 元待结算`;
  return `${memberName('m1')}垫付 ${adv.m1.count} 笔 · ${M.fmtInt(adv.total)} 元待结算`;
}

function renderHome() {
  const jt = M.joint(state);
  const plan = M.planOf(state, month);
  const spentJoint = M.monthExpense(state, month, jt.id);
  const left = plan - spentJoint;
  const over = left < 0;
  const pct = plan > 0 ? Math.min(100, (spentJoint / plan) * 100) : 0;

  const curM = M.todayMonth();
  const isCur = month === curM;
  const isPast = month < curM;
  const dim = M.daysInMonth(month);
  const day = new Date().getDate();
  const daysLeft = dim - day;
  const dayPct = isCur ? Math.min(100, (day / dim) * 100) : 0;

  const label = over ? '本月共同池超支' : isPast ? '本月共同池结余' : '本月共同池还能花';

  const subs = [`<span>计划 <b>${M.fmtInt(plan)}</b></span>`, `<span>已花 <b>${M.fmtInt(spentJoint)}</b></span>`];
  if (isCur) {
    subs.push(daysLeft > 0
      ? `<span>还剩 <b>${daysLeft}</b> 天</span>`
      : `<span>今天是本月最后一天</span>`);
  } else if (!isPast) {
    subs.push(`<span>还没到这个月</span>`);
  }

  let paceHtml = '';
  if (isCur) {
    let tip = '节奏正常';
    if (pct > dayPct + 12) tip = '花得比时间快';
    else if (pct < dayPct - 12) tip = '比计划从容';
    paceHtml = `<div class="pace">
        <div class="pace-bar">
          <div class="pace-fill ${over ? 'over' : ''}" style="width:${pct}%"></div>
          <div class="pace-mark" style="left:${dayPct}%"></div>
        </div>
        <div class="pace-tip">已花 ${Math.round(pct)}% · 时间过了 ${Math.round(dayPct)}% · ${tip}</div>
      </div>`;
  }

  const totalSpent = M.monthExpense(state, month);
  const adv = M.advancePending(state);

  const negAcc = state.accounts.find(
    (a) => (state.opening[a.id] || 0) === 0 && M.balanceOf(state, a.id) < 0
  );

  return `
  <div class="topbar">
    <h1>家庭账本</h1>
    ${monthSwitch()}
  </div>
  <div class="page">
    ${syncMsg ? `<div class="sync-tip">${esc(syncMsg)}</div>` : ''}
    <div class="hero">
      <div class="hero-label">${label}</div>
      <div class="hero-num ${over ? 'over' : ''}">
        <span class="unit">¥</span><span class="num">${M.fmt(Math.abs(left))}</span>
      </div>
      <div class="hero-sub">${subs.join('')}</div>
      ${paceHtml}
    </div>

    <div class="section">
      <div class="section-title">账户余额</div>
      <div class="accounts">
        ${state.accounts.map((a) => {
          const bal = M.balanceOf(state, a.id);
          const spent = M.monthExpense(state, month, a.id);
          const m = a.type === 'allowance' ? state.members.find((x) => x.id === a.ownerId) : null;
          const quota = m ? m.allowance : 0;
          const left = quota - spent;
          const sub = a.type === 'allowance'
            ? `本月花 ${M.fmtInt(spent)}<br>${left < 0 ? '超了 ' + M.fmtInt(-left) : '还能花 ' + M.fmtInt(left)}`
            : `本月花 ${M.fmtInt(spent)}`;
          return `<div class="account">
            <div class="name">${esc(a.name)}</div>
            <div class="val num ${bal < 0 ? 'neg' : ''}">${M.fmtInt(bal)}</div>
            <div class="sub">${sub}</div>
          </div>`;
        }).join('')}
      </div>
      ${negAcc ? `<button class="tip-link" data-act="edit-open" data-v="${negAcc.id}">
        账户是负数，因为还没设期初余额 · 去设置 ›
      </button>` : ''}
      ${adv && adv.count ? `<button class="tip-link" data-act="settle">
        ${advText(adv)} ›
      </button>` : ''}
    </div>

    <div class="section">
      ${M.hasPayroll(state, month)
        ? `<button class="btn ghost" data-act="nav" data-v="add">＋ 记一笔</button>`
        : `<button class="btn" data-act="payroll">💰 记本月工资</button>
           <button class="btn ghost" data-act="nav" data-v="add">＋ 记一笔</button>`}
    </div>

    <div class="section">
      <button class="list-row card" data-act="nav" data-v="list" style="padding:15px 16px">
        <span>本月明细</span>
        <span class="v">共支出 ${M.fmtInt(totalSpent)} 元 ›</span>
      </button>
    </div>

    <div class="footer-note">数据存在云端，两台手机看的是同一本账 · 换手机重装前先在「更多 → 导出备份」留一份</div>
  </div>`;
}

/* ================= 明细 ================= */

function renderList() {
  const all = M.txOfMonth(state, month);
  const filtered = all.filter((t) => {
    if (filterAcc !== 'all' && t.accountId !== filterAcc && t.toAccountId !== filterAcc) return false;
    if (filterCat && t.category !== filterCat) return false;
    return true;
  });
  const list = M.sortTx(filtered, sortKey, sortDir);

  // 退款要冲减支出，所以不能只加 expense
  const netOut = (arr) =>
    arr.reduce((s, t) => s + (t.type === 'expense' ? t.amount : t.type === 'refund' ? -t.amount : 0), 0);

  const spent = netOut(list);

  let html = '';
  if (!list.length) {
    html = `<div class="empty">${all.length ? '没有符合筛选条件的记录' : '这个月还没有记录'}</div>`;
  } else if (sortKey === 'time') {
    // 按时间排时保留「按天分组」，翻起来更像账本
    const groups = new Map();
    for (const t of list) {
      if (!groups.has(t.date)) groups.set(t.date, []);
      groups.get(t.date).push(t);
    }
    for (const [date, txs] of groups) {
      const dayOut = netOut(txs);
      html += `<div class="day-group">
        <div class="day-head"><span>${M.dayLabel(date)}</span><span>${dayOut ? '支出 ' + M.fmt(dayOut) : ''}</span></div>
        <div class="tx-list">
          ${txs.map(txRow).join('')}
        </div>
      </div>`;
    }
  } else {
    // 按金额排时不分天，否则每组只剩一笔，分组没意义
    html = `<div class="tx-list">${list.map(txRow).join('')}</div>`;
  }

  const accChip = (id, name) => `<button class="fchip ${filterAcc === id ? 'on' : ''}" data-act="filter-acc" data-v="${id}">${esc(name)}</button>`;
  const catChip = (id, name) => `<button class="fchip ${filterCat === id ? 'on' : ''}" data-act="filter-cat" data-v="${id}">${esc(name)}</button>`;
  const sortLabel = `${sortKey === 'time' ? '时间' : '金额'} ${sortDir === 'desc' ? '↓' : '↑'}`;

  return `
  <div class="topbar">
    <h1>明细</h1>
    ${monthSwitch()}
  </div>
  <div class="page">
    <div class="filter-bar">
      ${accChip('all', '全部')}
      ${state.accounts.map((a) => accChip(a.id, a.name)).join('')}
    </div>
    <div class="filter-bar">
      ${catChip('', '全部分类')}
      ${M.CATS.map((c) => catChip(c.id, c.name)).join('')}
    </div>
    <div class="filter-sum">
      <span>共 ${list.length} 笔${filterAcc !== 'all' || filterCat ? '（筛选后）' : ''} · 支出合计 <b>${M.fmtInt(spent)}</b> 元</span>
      <button class="fchip sort" data-act="sort">${sortLabel}</button>
    </div>
    ${html}
  </div>`;
}

function txRow(t) {
  const c = M.cat(t.category);
  const acc = M.account(state, t.accountId);
  const isExpense = t.type === 'expense';
  const isRefund = t.type === 'refund';
  const isTransfer = t.type === 'transfer';
  const sign = isExpense ? '−' : isTransfer ? '' : '+';
  const cls = isExpense ? '' : isTransfer ? 'transfer' : isRefund ? 'refund' : 'income';
  const amountText = isTransfer
    ? `→ ${M.fmt(t.amount)}`
    : `${sign}${M.fmt(t.amount)}`;
  const sub = [acc ? acc.name : '', t.note].filter(Boolean).join(' · ');
  const refunded = isExpense ? M.refundedOf(state, t.id) : 0;
  const tags = isRefund
    ? ' · 退款'
    : [
        t.advance ? (t.settledAt ? ' · 已结算' : ' · 待结算') : '',
        refunded ? ` · 已退 ${M.fmtInt(refunded)}` : '',
      ].join('');
  return `<button class="tx" data-act="tx" data-v="${t.id}">
    <span class="tx-ico">${c.icon}</span>
    <span class="tx-main">
      <span class="tx-cat">${c.name}</span>
      <span class="tx-note">${esc(sub)}${tags}</span>
    </span>
    <span class="tx-amt num ${cls}">${amountText}</span>
  </button>`;
}

/* ================= 更多 ================= */

function renderMore() {
  const row = (label, value, act, v, extra = '') =>
    `<button class="list-row" data-act="${act}" ${v != null ? `data-v="${v}"` : ''} ${extra}>
      <span>${label}</span><span class="v num">${value}</span>
    </button>`;

  const jt = M.joint(state);
  const m1 = state.members[0];
  const m2 = state.members[1];
  const adv = M.advancePending(state);

  return `
  <div class="topbar"><h1>更多</h1></div>
  <div class="page">
    <div class="section">
      <div class="section-title">计划</div>
      <div class="list-card">
        ${row('共同池月度计划', M.fmtInt(M.planOf(state, month)), 'edit-plan')}
        ${row(`${m1 ? m1.name : '老公'}零花钱`, M.fmtInt(m1 ? m1.allowance : 0), 'edit-allow', m1 ? m1.id : '')}
        ${row(`${m2 ? m2.name : '媳妇'}零花钱`, M.fmtInt(m2 ? m2.allowance : 0), 'edit-allow', m2 ? m2.id : '')}
      </div>
    </div>

    ${adv.count ? `
    <div class="section">
      <div class="section-title">垫付</div>
      <div class="list-card">
        ${row(`待结算 ${adv.count} 笔`, `${M.fmtInt(adv.total)} 元`, 'settle')}
      </div>
    </div>` : ''}

    <div class="section">
      <div class="section-title">期初余额（决定"现在开始记账"的起点）</div>
      <div class="list-card">
        ${state.accounts.map((a) => row(a.name, M.fmtInt(state.opening[a.id] || 0), 'edit-open', a.id)).join('')}
      </div>
    </div>

    <div class="section">
      <div class="section-title">数据</div>
      <div class="list-card">
        ${row('导出备份', '生成 JSON 文件', 'export')}
        ${row('导入备份', '从文件恢复', 'import')}
        ${row('立刻同步', sync.pendingCount() ? `还有 ${sync.pendingCount()} 笔没传` : '重拉一次云端', 'sync-now')}
      </div>
    </div>

    <div class="section">
      <div class="section-title">仓库</div>
      <div class="list-card">
        <div class="list-row"><span>数据仓库</span><span class="v">${esc(session ? session.owner + '/' + session.repo : '—')}</span></div>
        <div class="list-row"><span>这个手机是</span><span class="v">${esc(memberName(session ? session.role : ''))}</span></div>
        ${row('断开连接', '', 'logout')}
      </div>
    </div>

    <div class="section">
      <button class="btn danger" data-act="reset">清空这台设备上的数据</button>
    </div>

    <div class="footer-note">家庭账本 · v1<br>数据存在云端，两台手机共用一本账</div>
  </div>`;
}

/* ================= 记一笔 ================= */

function renderAdd() {
  const a = add;
  const cats = a.mode === 'income' ? M.INCOME_CATS : M.CATS;
  const accounts = a.mode === 'income'
    ? state.accounts.filter((x) => x.type === 'joint')
    : state.accounts;
  const canSave = M.parseAmount(a.amountStr) > 0;

  return `
  <div class="add-page">
    <div class="add-head">
      <button class="icon-btn" data-act="add-cancel">✕</button>
      <div class="title">${a.mode === 'income' ? '记收入' : '记一笔'}</div>
      <button class="small muted" data-act="add-mode">${a.mode === 'income' ? '记支出' : '记收入'}</button>
    </div>

    <div class="add-scroll">
      <div class="amount-box">
        <span class="amount-val ${a.amountStr ? '' : 'empty'}">
          <span class="cur">¥</span><span class="digits num">${a.amountStr || '0.00'}</span>
        </span>
      </div>

      <div class="chips">
        ${cats.map((c) => `<button class="chip ${a.catId === c.id ? 'on' : ''}" data-act="add-cat" data-v="${c.id}">
          <span class="ico">${c.icon}</span><span>${c.name}</span>
        </button>`).join('')}
      </div>

      <div class="section">
        <div class="section-title">${a.mode === 'income' ? '入到哪个账户' : '从哪个账户出'}</div>
        <div class="seg">
          ${accounts.map((acc) => `<button class="${a.accountId === acc.id ? 'on' : ''}" data-act="add-account" data-v="${acc.id}">${esc(acc.name)}</button>`).join('')}
        </div>
      </div>

      ${a.mode === 'expense' && a.accountId === M.joint(state).id ? `
      <div class="section">
        <label class="field">
          <span class="adv-label">这笔是我垫的，月底结算</span>
          <input type="checkbox" id="adv-toggle" class="adv-check" ${a.advance ? 'checked' : ''}>
        </label>
        <div class="adv-hint">勾上 = 算共同池的开销，但钱是从我卡里出的，月底对方转给我。</div>
      </div>` : ''}

      <div class="section">
        <div class="field">
          <input id="note-input" placeholder="备注（可选）" maxlength="40" value="${esc(a.note)}">
          <input type="date" id="date-input" class="date-in" value="${a.date}">
        </div>
      </div>
    </div>

    <div class="keypad">
      ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) => `
        <button class="key ${k === '⌫' ? 'fn' : ''}" data-act="add-key" data-v="${k}">${k}</button>`).join('')}
      <button class="key save" data-act="add-save" ${canSave ? '' : 'disabled'}>保存</button>
    </div>
  </div>`;
}

/* ================= 弹层 ================= */

function sheet(html, mount) {
  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  mask.innerHTML = `<div class="sheet">${html}</div>`;
  mask.addEventListener('click', (e) => { if (e.target === mask) mask.remove(); });
  document.body.appendChild(mask);
  if (mount) mount(mask);
  return mask;
}

function editMoney({ title, hint, cents, onDone }) {
  const el = sheet(`
    <h3>${esc(title)}</h3>
    ${hint ? `<div class="small muted" style="margin:-8px 0 12px">${esc(hint)}</div>` : ''}
    <div class="field"><input id="sheet-input" inputmode="decimal" value="${M.centsToInput(cents)}"></div>
    <button class="btn" id="sheet-ok">保存</button>
  `, (root) => {
    const input = root.querySelector('#sheet-input');
    input.focus();
    input.select();
    const ok = () => {
      const v = M.parseAmount(input.value);
      if (!Number.isFinite(v) || v < 0) return;
      root.remove();
      onDone(v);
    };
    root.querySelector('#sheet-ok').addEventListener('click', ok);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
  });
  return el;
}

/* ================= 事件 ================= */

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const v = el.dataset.v;

  switch (act) {
    case 'nav':
      setView(v);
      break;

    case 'month':
      month = M.shiftMonth(month, Number(v));
      render();
      break;

    /* ---------- 记账 ---------- */
    case 'add-cancel':
      setView('home');
      break;

    case 'add-mode':
      add.mode = add.mode === 'expense' ? 'income' : 'expense';
      if (add.mode === 'income') {
        add.accountId = M.joint(state).id;
        add.catId = 'extra';
      } else {
        add.catId = 'food';
      }
      render();
      break;

    case 'add-cat':
      add.catId = v;
      render();
      break;

    case 'add-account':
      add.accountId = v;
      render();
      break;

    case 'add-key': {
      const s = add.amountStr;
      if (v === '⌫') {
        add.amountStr = s.slice(0, -1);
      } else if (v === '.') {
        if (!s.includes('.')) add.amountStr = (s || '0') + '.';
      } else {
        if (s.includes('.')) {
          const dec = s.split('.')[1] || '';
          if (dec.length >= 2) break;
        }
        if (s === '0') add.amountStr = v;
        else add.amountStr = s + v;
      }
      render();
      break;
    }

    case 'add-save': {
      const amount = M.parseAmount(add.amountStr);
      if (!amount) return;
      const tx = M.addTx(state, {
        type: add.mode,
        accountId: add.accountId,
        amount,
        category: add.catId,
        date: add.date,
        note: add.note.trim(),
        ...(add.mode === 'expense' && add.accountId === M.joint(state).id && add.advance
          ? { advance: true, paidBy: add.paidBy || 'm1' }
          : {}),
      });
      month = M.monthOf(add.date);
      add = null;
      view = 'home';
      save(state);
      render();
      sync.pushTx(state, tx).then((uploaded) => {
        if (!uploaded) {
          syncMsg = '这笔先存在手机上，联网后自动补传';
          render();
        } else if (syncMsg) {
          syncMsg = '';
          render();
        }
      });
      break;
    }

    /* ---------- 明细 ---------- */
    case 'filter-acc':
      filterAcc = v;
      render();
      break;

    case 'filter-cat':
      filterCat = v;
      render();
      break;

    case 'sort':
      // 时间↓ → 时间↑ → 金额↓ → 金额↑ → 回到时间↓
      if (sortKey === 'time' && sortDir === 'desc') sortDir = 'asc';
      else if (sortKey === 'time') { sortKey = 'amount'; sortDir = 'desc'; }
      else if (sortDir === 'desc') sortDir = 'asc';
      else { sortKey = 'time'; sortDir = 'desc'; }
      render();
      break;

    case 'settle': {
      const p = M.advancePending(state);
      if (!p.count) break;
      const lines = [];
      if (p.m1.count) {
        lines.push(`${memberName('m1')}垫付 ${p.m1.count} 笔，<b>${M.fmt(p.m1.total)}</b> 元 —— 由${memberName('m2')}转给${memberName('m1')}`);
      }
      if (p.m2.count) {
        lines.push(`${memberName('m2')}垫付 ${p.m2.count} 笔，<b>${M.fmt(p.m2.total)}</b> 元 —— 由${memberName('m1')}转给${memberName('m2')}`);
      }
      sheet(`
        <h3>结算垫付</h3>
        <div class="small muted" style="margin:-8px 0 14px;line-height:1.7">
          ${lines.join('<br>')}
        </div>
        <div class="small" style="margin:0 0 14px;line-height:1.7">
          线下转完账，点下面的按钮把这几笔标掉。<br>
          <span class="muted">标记不影响余额——记账时已经扣过了。</span>
        </div>
        <button class="btn" id="settle-ok">全部标为已结算</button>
        <button class="btn ghost" id="settle-no">先不结</button>
      `, (root) => {
        root.querySelector('#settle-ok').addEventListener('click', () => {
          const marked = M.settleAdvances(state, M.todayISO());
          root.remove();
          save(state);
          render();
          // 结算标记要推上云，否则另一台手机还会提示待结算
          Promise.all(marked.map((t) => sync.pushTx(state, t))).then((r) => {
            if (r.some((x) => !x)) {
              syncMsg = '结算标记还没上云，联网后自动补传';
              render();
            }
          });
        });
        root.querySelector('#settle-no').addEventListener('click', () => root.remove());
      });
      break;
    }

    case 'tx': {
      const t = state.transactions.find((x) => x.id === v);
      if (!t) break;
      const c = M.cat(t.category);
      const acc = M.account(state, t.accountId);
      const to = t.toAccountId ? M.account(state, t.toAccountId) : null;
      const jt = M.joint(state);
      const canAdv = t.type === 'expense' && t.accountId === jt.id;
      const refunded = t.type === 'expense' ? M.refundedOf(state, t.id) : 0;
      const remain = t.type === 'expense' ? t.amount - refunded : 0;
      const orig = t.type === 'refund' ? state.transactions.find((x) => x.id === t.refundOf) : null;
      const myRole = session && session.role ? session.role : 'm1';
      const otherRole = myRole === 'm1' ? 'm2' : 'm1';

      let advRow = '';
      let advBtn = '';
      if (canAdv) {
        if (t.settledAt) {
          advRow = `<div class="list-row"><span class="muted">垫付</span><span>${t.advance ? memberName(t.paidBy || 'm1') + '垫的 · ' : ''}${t.settledAt} 已结算</span></div>`;
        } else if (t.advance) {
          advRow = `<div class="list-row"><span class="muted">垫付</span><span>${memberName(t.paidBy || 'm1')}垫的 · 待结算</span></div>`;
          advBtn = `<button class="btn ghost" id="adv-off">取消垫付标记</button>`;
        } else {
          advBtn = `<button class="btn ghost" id="adv-on">补记：这笔是我垫的</button>`;
        }
      }

      sheet(`
        <h3>${c.icon} ${c.name}</h3>
        <div class="list-card">
          <div class="list-row"><span class="muted">金额</span><span class="num">¥${M.fmt(t.amount)}</span></div>
          <div class="list-row"><span class="muted">${t.type === 'expense' ? '从哪出' : '到哪去'}</span><span>${acc ? esc(acc.name) : '—'}</span></div>
          ${to ? `<div class="list-row"><span class="muted">转入</span><span>${esc(to.name)}</span></div>` : ''}
          <div class="list-row"><span class="muted">日期</span><span>${t.date}</span></div>
          ${t.note ? `<div class="list-row"><span class="muted">备注</span><span>${esc(t.note)}</span></div>` : ''}
          ${refunded ? `<div class="list-row"><span class="muted">已退</span><span class="num">¥${M.fmt(refunded)}</span></div>` : ''}
          ${orig ? `<div class="list-row"><span class="muted">退的是</span><span>${orig.date} 那笔 ¥${M.fmt(orig.amount)}</span></div>` : ''}
          ${advRow}
        </div>
        ${remain > 0 ? `<button class="btn ghost" id="refund-btn">退货 / 部分退款</button>` : ''}
        ${advBtn}
        <button class="btn danger" id="del-btn">删除这笔</button>
      `, (root) => {
        root.querySelector('#del-btn').addEventListener('click', () => {
          root.remove();
          sync.pushDelete(state, t.id).then((okDone) => {
            if (!okDone) {
              syncMsg = '删除还没同步上，联网后会自动补传';
            }
            render();
          });
        });

        const applyAdv = (on) => {
          const up = M.setAdvance(state, t.id, on, myRole);
          if (!up) return;
          save(state);
          render();
          sync.pushTx(state, up).then((okDone) => {
            if (!okDone) {
              syncMsg = '垫付标记还没上云，联网后自动补传';
              render();
            }
          });
        };

        const offBtn = root.querySelector('#adv-off');
        if (offBtn) offBtn.addEventListener('click', () => { root.remove(); applyAdv(false); });

        const refundBtn = root.querySelector('#refund-btn');
        if (refundBtn) refundBtn.addEventListener('click', () => {
          root.remove();
          sheet(`
            <h3>退货 / 退款</h3>
            <div class="small muted" style="margin:-8px 0 14px;line-height:1.7">
              原支出 ¥${M.fmt(t.amount)}${refunded ? `，已退 ¥${M.fmt(refunded)}` : ''}，还能退 <b>¥${M.fmt(remain)}</b>。<br>
              退款记<b>到账那天</b>：钱实际回到卡上的日期，不一定等于买东西那天。
            </div>
            <label class="login-field"><input id="rf-amt" inputmode="decimal" value="${M.centsToInput(remain)}"></label>
            <label class="login-field"><input id="rf-date" type="date" value="${M.todayISO()}"></label>
            <button class="btn" id="rf-yes">确认退款</button>
            <button class="btn ghost" id="rf-no">算了</button>
          `, (r3) => {
            r3.querySelector('#rf-no').addEventListener('click', () => r3.remove());
            r3.querySelector('#rf-yes').addEventListener('click', () => {
              const amt = Math.round(M.parseAmount(r3.querySelector('#rf-amt').value) || 0);
              const day = r3.querySelector('#rf-date').value || M.todayISO();
              if (amt <= 0) { r3.querySelector('#rf-amt').focus(); return; }
              if (amt > remain) {
                syncMsg = `退款不能超过还能退的 ¥${M.fmt(remain)}`;
                r3.remove();
                render();
                return;
              }
              const rec = M.addTx(state, {
                type: 'refund',
                amount: amt,
                date: day,
                accountId: t.accountId,
                category: t.category,
                note: t.note ? `退款：${t.note}` : '退款',
                refundOf: t.id,
              });
              r3.remove();
              save(state);
              render();
              sync.pushTx(state, rec).then((okDone) => {
                if (!okDone) {
                  syncMsg = '退款还没上云，联网后自动补传';
                  render();
                }
              });
            });
          });
        });

        const onBtn = root.querySelector('#adv-on');
        if (onBtn) onBtn.addEventListener('click', () => {
          root.remove();
          sheet(`
            <h3>补记垫付</h3>
            <div class="small muted" style="margin:-8px 0 14px;line-height:1.7">
              这笔钱是从你卡里出的吗？<br>
              补记后它会进「待结算」，结算时 ${memberName(otherRole)} 转给你。<br>
              <b>如果这笔其实是她/他付的，别点</b>——会多转一次钱。
            </div>
            <button class="btn" id="adv-yes">是我垫的，确认</button>
            <button class="btn ghost" id="adv-no">算了</button>
          `, (r2) => {
            r2.querySelector('#adv-yes').addEventListener('click', () => { r2.remove(); applyAdv(true); });
            r2.querySelector('#adv-no').addEventListener('click', () => r2.remove());
          });
        });
      });
      break;
    }

    /* ---------- 工资 ---------- */
    case 'payroll':
      openPayroll();
      break;

    /* ---------- 设置 ---------- */
    case 'edit-plan':
      editMoney({
        title: '共同池月度计划',
        hint: `${M.monthLabel(month)} 共同池打算花多少（元）`,
        cents: M.planOf(state, month),
        onDone: (v) => {
          saveSettings({ plans: { ...state.plans, [month]: v } });
        },
      });
      break;

    case 'edit-allow': {
      const m = state.members.find((x) => x.id === v);
      if (!m) break;
      editMoney({
        title: `${m.name}零花钱`,
        hint: '每月这个额度，用不完可滚存',
        cents: m.allowance,
        onDone: (val) => {
          m.allowance = val;
          saveSettings({ members: state.members });
        },
      });
      break;
    }

    case 'edit-open': {
      const acc = M.account(state, v);
      if (!acc) break;
      editMoney({
        title: `${acc.name}期初余额`,
        hint: '记账开始那天这个账户里有多少钱',
        cents: state.opening[v] || 0,
        onDone: (val) => {
          saveSettings({ opening: { ...state.opening, [v]: val } });
        },
      });
      break;
    }

    case 'export':
      doExport();
      break;

    case 'sync-now': {
      const before = sync.pendingCount();
      sync.flush().then((n) => {
        return sync.pull(state).then(() => {
          save(state);
          syncMsg = before ? `补传了 ${Math.min(n, before)} 笔` : '已经是最新的';
          render();
        });
      }).catch(() => {
        syncMsg = '连不上，稍后再试';
        render();
      });
      break;
    }

    case 'logout':
      sheet(`
        <h3>断开连接？</h3>
        <div class="small muted" style="margin-bottom:14px">这台手机上的缓存会清掉，云端数据不受影响。下次要重新填仓库和令牌。</div>
        <button class="btn danger" id="yes">断开</button>
        <button class="btn ghost" id="no">取消</button>
      `, (root) => {
        root.querySelector('#yes').addEventListener('click', () => {
          api.clearSession();
          session = null;
          wipe();
          state = load();
          root.remove();
          view = 'home';
          syncMsg = '';
          connectErr = '';
          render();
        });
        root.querySelector('#no').addEventListener('click', () => root.remove());
      });
      break;

    case 'login':
      doConnect();
      break;

    case 'cf-role':
      connectRole = v;
      render();
      break;

    case 'import':
      doImport();
      break;

    case 'reset':
      sheet(`
        <h3>清空所有数据？</h3>
        <div class="small muted" style="margin-bottom:14px">所有记录会被删除，无法恢复。建议先导出备份。</div>
        <button class="btn danger" id="yes">确认清空</button>
        <button class="btn ghost" id="no">取消</button>
      `, (root) => {
        root.querySelector('#yes').addEventListener('click', () => {
          wipe();
          state = load();
          root.remove();
          month = M.todayMonth();
          view = 'home';
          bootSync();
        });
        root.querySelector('#no').addEventListener('click', () => root.remove());
      });
      break;
  }
});

app.addEventListener('input', (e) => {
  if (e.target.id === 'note-input' && add) add.note = e.target.value;
});

app.addEventListener('change', (e) => {
  if (e.target.id === 'date-input' && add) add.date = e.target.value || M.todayISO();
  if (e.target.id === 'adv-toggle' && add) add.advance = e.target.checked;
});

/* ================= 记工资 ================= */

function openPayroll() {
  const jt = M.joint(state);
  const rows = state.members.map((m) => `
    <div class="field" style="margin-bottom:10px">
      <span class="small" style="width:64px;flex:none">${esc(m.name)}</span>
      <input id="pay-${m.id}" inputmode="decimal" placeholder="到手工资" style="text-align:right">
      <span class="small muted" style="flex:none">元</span>
    </div>`).join('');

  sheet(`
    <h3>记本月工资</h3>
    <div class="small muted" style="margin:-8px 0 14px">${M.monthLabel(month)} · 填税后到手金额</div>
    ${rows}
    <div class="small muted" style="margin:4px 0 14px">零花钱会自动扣出来，剩下的进共同池。</div>
    <button class="btn" id="pay-ok">确认记账</button>
  `, (root) => {
    root.querySelector('#pay-ok').addEventListener('click', () => {
      const entries = state.members.map((m) => ({
        memberId: m.id,
        amount: M.parseAmount(root.querySelector('#pay-' + m.id).value),
      }));
      const total = entries.reduce((s, e) => s + e.amount, 0);
      if (!total) { alert('先填金额'); return; }
      const created = M.recordPayroll(state, month, M.todayISO(), entries);
      root.remove();
      save(state);
      render();
      Promise.all(created.map((t) => sync.pushTx(state, t))).then((results) => {
        if (results.some((okDone) => !okDone)) {
          syncMsg = '工资记下了，还没上云，联网后自动补传';
          render();
        }
      });
    });
  });
}

/* ================= 备份 ================= */

function doExport() {
  const blob = new Blob([exportJSON(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  a.href = url;
  a.download = `家庭账本-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function doImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const next = importJSON(String(reader.result));
        state = next;
        save(state);
        month = M.todayMonth();
        view = 'home';
        render();
        if (session) {
          // 导进来的内容也要上云，不然只有这台手机看得到
          sync
            .pushSettings(state, {
              members: state.members,
              accounts: state.accounts,
              opening: state.opening,
              monthlyPlan: state.monthlyPlan,
              plans: state.plans,
              settings: state.settings,
            })
            .then(() => Promise.all(state.transactions.map((t) => sync.pushTx(state, t))))
            .then(() => bootSync())
            .catch(() => {});
          alert('已恢复，正在传到云端…');
        } else {
          alert('已恢复');
        }
      } catch (err) {
        alert('导入失败：' + err.message);
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

/* ================= 连接 ================= */

// 网络层失败时给人话，别一上来就怪用户网络
function netErrText() {
  return '连不上 GitHub（api.github.com），等几秒再点一次。';
}

async function doConnect() {
  const val = (id) => {
    const el = document.getElementById(id);
    return el && el.value ? el.value.trim() : '';
  };
  const errEl = document.getElementById('login-err');
  const owner = val('cf-owner');
  const repo = val('cf-repo') || 'family-ledger-data';
  const token = val('cf-token');

  if (!owner || !token) {
    if (errEl) errEl.textContent = '用户名和令牌都要填';
    return;
  }
  if (errEl) errEl.textContent = '连接中…';

  try {
    await api.verify({ owner, repo, token });
    api.setSession({ owner, repo, token, role: connectRole, branch: 'main' });
    session = api.getSession();
    connectErr = '';
    render();
    await bootSync();
  } catch (e) {
    connectErr = e.code === 0 ? netErrText() : e.message || '连接失败';
    if (errEl) errEl.textContent = connectErr;
  }
}

/* ================= 启动 ================= */

async function bootSync() {
  try {
    await sync.pull(state);
    save(state);
    syncMsg = '';
    const sent = await sync.flush();
    if (sent) {
      await sync.pull(state);
      save(state);
    }
  } catch (e) {
    if (e.code === 401 || e.code === 403) {
      api.clearSession();
      session = null;
      connectErr = e.message || '令牌失效了，重新连一次';
      render();
      return;
    }
    if (e.code === 404) {
      // 仓库还是空的：用这台手机现有的内容建账本
      try {
        await sync.initRepo(state);
        for (const t of state.transactions) await sync.pushTx(state, t);
        await sync.pull(state);
        save(state);
        syncMsg = '';
      } catch (e2) {
        syncMsg = e2.message || '建账本失败';
      }
      render();
      return;
    }
    syncMsg = '没连上 GitHub，先看手机上存的数据';
  }
  render();
}

function boot() {
  render();               // 先用缓存把界面画出来，别等网络
  if (session) bootSync();
}

boot();

// 回到前台时补传 + 拉一次，保证两台手机看到的是同一份
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && session) bootSync();
});
