// GitHub 数据层。所有读写都走 GitHub REST API，别的文件不要直接 fetch。
//
// 为什么是 GitHub：CloudBase 体验版把数据库隔离了，恢复要升级付费套餐。
// GitHub 免费额度对我们这种量级完全用不完，而且每次保存都是一个 commit，
// 天然带历史版本——记错了能翻回去。
//
// 两个仓库：
//   owner/family-ledger       代码，公开（GitHub Pages 只能从公开仓库免费发布）
//   owner/family-ledger-data  数据，私有（只有 token 能读）
//
// token 只存在这台手机的 localStorage 里，不上传任何地方。

const SESSION_KEY = 'family-ledger-session';
const API = 'https://api.github.com';

/* ---------- 连接信息 ---------- */

export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.token || !s.owner || !s.repo) return null;
    return s;
  } catch {
    return null;
  }
}

export function setSession(s) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

/* ---------- 错误 ---------- */

function httpError(status, message) {
  const err = new Error(message);
  err.code = status;
  return err;
}

/* ---------- 底层请求 ---------- */

async function gh(path, opts = {}) {
  const s = getSession();
  if (!s) throw httpError(401, '还没连接仓库');

  let res;
  try {
    res = await fetch(API + path, {
      ...opts,
      headers: {
        Authorization: 'Bearer ' + s.token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.headers || {}),
      },
    });
  } catch {
    // 断网、被拦、DNS 挂了，都归到这里
    throw httpError(0, '网络不通');
  }

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const msg =
      (json && json.message) ||
      (res.status === 401 ? 'token 不对或过期了' : 'GitHub 返回 ' + res.status);
    throw httpError(res.status, msg);
  }
  return json;
}

function ownerRepo() {
  const s = getSession();
  return `${s.owner}/${s.repo}`;
}

/* ---------- base64（JSON 里有中文，不能直接 btoa） ---------- */

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* ---------- 文件读写 ---------- */

/**
 * 读一个 JSON 文件。不存在返回 null（不是错误）。
 * 返回 { data, sha }，sha 写回时要用。
 */
export async function readJSON(path) {
  let json;
  try {
    json = await gh(`/repos/${ownerRepo()}/contents/${path}`);
  } catch (e) {
    if (e.code === 404) return null;
    throw e;
  }
  if (!json || typeof json.content !== 'string') {
    throw httpError(500, '文件读不出来（可能超过 1MB）');
  }
  let data;
  try {
    data = JSON.parse(b64decode(json.content));
  } catch {
    throw httpError(500, `${path} 不是合法的 JSON`);
  }
  return { data, sha: json.sha };
}

/**
 * 写一个 JSON 文件。sha 传 null 表示新建。
 * 内容没变（同样的 sha 与内容）GitHub 会 409，按冲突处理。
 */
export async function writeJSON(path, data, sha, message) {
  const body = {
    message: message || `update ${path}`,
    content: b64encode(JSON.stringify(data, null, 2)),
  };
  if (sha) body.sha = sha;

  const s = getSession();
  if (s && s.branch) body.branch = s.branch;

  return gh(`/repos/${ownerRepo()}/contents/${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/* ---------- 连接测试 ---------- */

/**
 * 用一条连接信息试一下：仓库在不在、token 能不能读写。
 * 成功返回 { owner, repo, login }，失败抛错（错误信息直接给人看）。
 */
export async function verify(candidate) {
  const headers = {
    Authorization: 'Bearer ' + candidate.token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  let res;
  try {
    res = await fetch(API + '/user', { headers });
  } catch {
    throw httpError(0, '连不上 GitHub，检查一下网络');
  }
  if (!res.ok) {
    throw httpError(res.status, res.status === 401 ? 'token 不对或已过期' : 'GitHub 返回 ' + res.status);
  }
  const me = await res.json();

  const repoRes = await fetch(API + `/repos/${candidate.owner}/${candidate.repo}`, { headers });
  if (repoRes.status === 404) {
    throw httpError(404, `找不到仓库 ${candidate.owner}/${candidate.repo}`);
  }
  if (!repoRes.ok) {
    throw httpError(repoRes.status, '读不到这个仓库（token 权限不够？）');
  }

  return { owner: candidate.owner, repo: candidate.repo, login: me.login };
}
