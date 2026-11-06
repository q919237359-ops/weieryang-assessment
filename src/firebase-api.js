import { firebaseConfig, namespace } from './firebase-config.js';
import { getAdminSession, getAdminToken, signInAdmin, signOutAdmin } from './firebase-auth.js';
import { APIError, validateAnswers, validateConfig, gradeAttempt, publicConfig, publicAttempt, summary, exportCSV, text, integer } from './scoring.js';

export { signInAdmin, signOutAdmin };
const TOKEN = /^[a-f0-9]{64}$/;
const VERSION = /^[A-Za-z0-9_-]{1,100}$/;
const weightedIds = ['q2', 'q4', 'q7', 'q9', 'q10', 'q15', 'q16', 'q17'];
const timestamp = () => ({ '.sv': 'timestamp' });
const clone = value => structuredClone(value);
const array = value => Array.isArray(value) ? value : Object.values(value || {});

export function normalizeConfig(raw) {
  if (!raw) throw new APIError(503, '测评配置尚未初始化，请联系招聘负责人');
  const cfg = clone(raw);
  cfg.questions = array(cfg.questions).map(q => ({ ...q, options: array(q.options), ...(q.scoring ? { scoring: { ...q.scoring, option_scores: q.scoring.option_scores || {}, review_options: q.scoring.review_options || {} } } : {}) }));
  return cfg;
}

export function makeRubric(config) {
  return {
    config,
    weights: Object.fromEntries(config.questions.filter(q => weightedIds.includes(q.id)).map(q => [q.id, q.scoring.option_scores])),
    pass_score: config.pass_score,
    created_at: timestamp(),
  };
}

export function validateLayout(next, previous) {
  if (next.questions.length !== 20 || previous.questions.length !== 20) throw new APIError(400, '当前版本固定为 20 道题');
  next.questions.forEach((q, i) => {
    const old = previous.questions[i];
    if (q.id !== old.id || q.type !== old.type || q.rank_count !== old.rank_count || q.scoring?.mode !== old.scoring?.mode || JSON.stringify(q.options.map(o => o.id)) !== JSON.stringify(old.options.map(o => o.id))) {
      throw new APIError(400, '可调整题目文字、分值和追问；修改题号、题型、计分模式或选项编号需要同步升级数据库校验规则');
    }
  });
  return next;
}

/** Injectable boundary used by tests. Production candidate methods never request an Auth token. */
export function createFirebaseApi(dependencies = {}) {
  const config = dependencies.config || firebaseConfig;
  const ns = dependencies.namespace || namespace;
  const fetcher = dependencies.fetch || ((...args) => globalThis.fetch(...args));
  const getLocation = dependencies.location || (() => globalThis.location);
  const getStorage = dependencies.storage || (() => globalThis.sessionStorage);
  const getToken = dependencies.getAdminToken || getAdminToken;
  const session = dependencies.getAdminSession || getAdminSession;
  const logout = dependencies.signOutAdmin || signOutAdmin;
  const now = dependencies.now || Date.now;
  const random = dependencies.random || (() => [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, '0')).join(''));
  const memoryDrafts = new Map();
  let context;
  const draftKey = token => `weieryang-firebase-draft-v1:${token}`;

  function databaseUrl(path) {
    const base = new URL(config.databaseURL);
    if (base.protocol !== 'https:' || !/(?:\.firebasedatabase\.app|\.firebaseio\.com)$/.test(base.hostname) || base.username || base.password) throw new APIError(503, '数据库地址配置无效');
    return new URL(`${encodeURIComponent(ns)}/${path.split('/').filter(Boolean).map(encodeURIComponent).join('/')}.json`, base.href.endsWith('/') ? base.href : `${base.href}/`);
  }

  async function request(path, { method = 'GET', body, admin = false, timeout = 20000 } = {}) {
    const url = databaseUrl(path);
    if (admin) url.searchParams.set('auth', await getToken());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetcher(url.href, {
        method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error',
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        if ([401, 403].includes(response.status)) throw new APIError(response.status, admin ? '没有访问权限，或数据未通过数据库校验；请重新登录后重试' : '邀请可能已使用、过期或停用，请联系招聘负责人');
        throw new APIError(response.status, '云端保存未完成，请稍后重试');
      }
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw new APIError(504, '连接超时，作答仍保留在当前浏览器，请重试');
      if (error instanceof TypeError) throw new APIError(503, '暂时无法连接数据库，作答仍保留在当前浏览器，请检查网络后重试');
      throw error;
    } finally { clearTimeout(timer); }
  }

  function currentToken() {
    const token = new URLSearchParams((getLocation()?.hash || '').replace(/^#/, '')).get('invite');
    if (!TOKEN.test(token || '')) throw new APIError(400, '请使用 HR 发给您的专属测评邀请链接');
    return token;
  }

  function saveDraft(token, draft) {
    memoryDrafts.set(token, clone(draft));
    try { getStorage().setItem(draftKey(token), JSON.stringify(draft)); }
    catch { throw new APIError(507, '浏览器未能保存作答，请保持本页打开；请检查浏览器存储空间后重试'); }
  }
  function readDraft(token) {
    if (memoryDrafts.has(token)) return clone(memoryDrafts.get(token));
    try { const raw = getStorage().getItem(draftKey(token)); return raw ? JSON.parse(raw) : null; } catch { return null; }
  }
  function clearDraft(token) {
    memoryDrafts.delete(token);
    try { getStorage().removeItem(draftKey(token)); } catch { /* Receipt already confirms cloud persistence. */ }
  }
  const receipt = token => request(`submissions/${token}/submitted_at`);
  function checkAuthorization(id, headers = {}) {
    const token = new Headers(headers).get('Authorization')?.replace(/^Bearer /, '');
    if (!TOKEN.test(id) || token !== id || currentToken() !== id) throw new APIError(403, '答卷与当前邀请不匹配，请使用原邀请链接');
  }

  async function getInvitationContext() {
    const token = currentToken();
    const [invitation, submitted] = await Promise.all([request(`invitations/${token}`), receipt(token)]);
    if (!invitation || !VERSION.test(invitation.version || '')) throw new APIError(404, '邀请不存在，请向 HR 获取新的邀请链接');
    if (typeof submitted === 'number') {
      clearDraft(token);
      context = { token, invitation, submitted_at: submitted, status: 'submitted' };
      return clone(context);
    }
    if (!invitation.enabled) throw new APIError(410, '这份邀请已停用，请向 HR 获取新的邀请链接');
    if (invitation.expires_at <= now()) throw new APIError(410, '这份邀请已过期，请向 HR 获取新的邀请链接');
    context = { token, invitation, submitted_at: null, status: 'ready' };
    return clone(context);
  }

  async function candidateConfig() {
    const ctx = await getInvitationContext();
    const form = normalizeConfig(await request(`forms/${ctx.invitation.version}`));
    return { ...form, position: ctx.invitation.position || form.position, invitation_status: ctx.status, submitted_at: ctx.submitted_at, version: ctx.invitation.version };
  }

  function submittedAttempt(draft, token, submittedAt) {
    return { attempt: draft ? { ...publicAttempt(draft), status: 'submitted', submitted_at: new Date(submittedAt).toISOString() } : { id: token, status: 'submitted', submitted_at: new Date(submittedAt).toISOString(), name: '', position: '', questions: [], answers: {}, question_count: 20, elapsed_seconds: 0, warning_count: 0 }, receipt: { submitted_at: submittedAt } };
  }

  async function candidateApi(path, method, body, headers) {
    if (path === '/api/config' && method === 'GET') return candidateConfig();
    if (path === '/api/attempts' && method === 'POST') {
      if (body.consent !== true) throw new APIError(400, '请先阅读并同意测评数据说明');
      const cfg = await candidateConfig();
      if (cfg.invitation_status === 'submitted') throw new APIError(409, '这份测评已提交，请勿重复作答');
      const token = currentToken();
      const attempt = { id: token, version: context.invitation.version, name: text(body.name, '姓名', 60), position: text(cfg.position, '岗位', 80), status: 'in_progress', created_at: new Date(now()).toISOString(), submitted_at: null, answers: {}, warning_count: 0, elapsed_seconds: 0, question_count: cfg.questions.length, questions: cfg.questions, consent: true };
      saveDraft(token, attempt);
      return { attempt: publicAttempt(attempt), token };
    }
    const match = /^\/api\/attempts\/([a-f0-9]{64})(\/submit)?$/.exec(path);
    if (!match) throw new APIError(404, '接口不存在');
    const [, token, submit] = match;
    checkAuthorization(token, headers);
    const draft = readDraft(token);
    if (method === 'GET' && !submit) {
      const submitted = await receipt(token);
      if (typeof submitted === 'number') { clearDraft(token); return submittedAttempt(draft, token, submitted); }
      if (!draft) throw new APIError(404, '本浏览器没有未完成的作答，请从邀请链接重新开始');
      return { attempt: publicAttempt(draft) };
    }
    if (!draft) {
      if (submit && method === 'POST') {
        const submitted = await receipt(token);
        if (typeof submitted === 'number') return submittedAttempt(null, token, submitted);
      }
      throw new APIError(404, '本浏览器没有未完成的作答，请重新打开邀请链接');
    }
    if ((method === 'PATCH' && !submit) || (method === 'POST' && submit)) {
      draft.answers = validateAnswers(body.answers ?? draft.answers, draft.questions, Boolean(submit));
      draft.warning_count = Math.max(draft.warning_count, integer(body.warning_count ?? draft.warning_count, '切屏次数', 0, 10000));
      draft.elapsed_seconds = Math.max(draft.elapsed_seconds, integer(body.elapsed_seconds ?? draft.elapsed_seconds, '作答用时', 0, 604800));
      saveDraft(token, draft);
      if (!submit) return { attempt: publicAttempt(draft), saved_locally: true };
      const previous = await receipt(token);
      if (typeof previous === 'number') { clearDraft(token); return submittedAttempt(draft, token, previous); }
      const payload = { version: draft.version, name: draft.name, position: draft.position, created_at: Date.parse(draft.created_at), submitted_at: timestamp(), status: 'submitted', question_count: 20, warning_count: draft.warning_count, elapsed_seconds: draft.elapsed_seconds, answers: draft.answers, consent: true };
      try {
        const saved = await request(`submissions/${token}`, { method: 'PUT', body: payload });
        if (!saved || typeof saved.submitted_at !== 'number') throw new APIError(502, '尚未收到云端提交回执，请重试确认');
        clearDraft(token);
        return submittedAttempt(draft, token, saved.submitted_at);
      } catch (error) {
        // The server can commit even if the response is lost. Never create a second record.
        const acknowledged = await receipt(token).catch(() => null);
        if (typeof acknowledged === 'number') { clearDraft(token); return submittedAttempt(draft, token, acknowledged); }
        throw error;
      }
    }
    throw new APIError(405, '此操作不支持');
  }

  async function readCurrent() {
    const version = await request('current', { admin: true });
    if (!VERSION.test(version || '')) throw new APIError(503, '管理员尚未初始化题库');
    const rubric = await request(`rubrics/${version}`, { admin: true });
    return { version, rubric, config: validateConfig(normalizeConfig(rubric?.config)) };
  }
  async function saveSettings(body) {
    const previous = await readCurrent();
    const cfg = validateLayout(validateConfig(body), previous.config);
    const version = `v${now()}_${random().slice(0, 12)}`;
    await request(`rubrics/${version}`, { admin: true, method: 'PUT', body: makeRubric(cfg) });
    await request(`forms/${version}`, { admin: true, method: 'PUT', body: publicConfig(cfg) });
    await request('current', { admin: true, method: 'PUT', body: version });
    return cfg;
  }
  async function detailedAttempt(token, record, rubric, persistedGrade, note = '') {
    const cfg = validateConfig(normalizeConfig(rubric?.config));
    const answers = validateAnswers(record.answers, cfg.questions, true);
    const grade = gradeAttempt(cfg.questions, answers);
    const passed = grade.score >= cfg.pass_score;
    if (persistedGrade && (persistedGrade.score !== grade.score || persistedGrade.passed !== passed || persistedGrade.version !== record.version || persistedGrade.pass_score !== cfg.pass_score)) throw new APIError(409, '已保存分数与冻结规则不一致，请联系管理员核验');
    if (!persistedGrade) {
      const value = { score: grade.score, passed, version: record.version, pass_score: cfg.pass_score, graded_at: timestamp() };
      try { await request(`grades/${token}`, { admin: true, method: 'PUT', body: value }); }
      catch (error) {
        const saved = await request(`grades/${token}`, { admin: true }).catch(() => null);
        if (!saved || saved.score !== grade.score || saved.passed !== passed || saved.version !== record.version || saved.pass_score !== cfg.pass_score) throw error;
      }
    }
    return { ...record, ...grade, id: token, created_at: new Date(record.created_at).toISOString(), submitted_at: new Date(record.submitted_at).toISOString(), questions: cfg.questions, pass_score: cfg.pass_score, rubric_version: cfg.rubric_version, passed, notes: note || '' };
  }
  async function allAttempts() {
    const [submissions, rubrics, grades, notes] = await Promise.all(['submissions', 'rubrics', 'grades', 'notes'].map(path => request(path, { admin: true })));
    const result = [];
    const entries = Object.entries(submissions || {});
    for (let offset = 0; offset < entries.length; offset += 8) {
      result.push(...await Promise.all(entries.slice(offset, offset + 8).map(([token, record]) => detailedAttempt(token, record, rubrics?.[record.version], grades?.[token], notes?.[token]))));
    }
    return result.sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  }
  async function detail(token) {
    const [record, grade, note] = await Promise.all([request(`submissions/${token}`, { admin: true }), request(`grades/${token}`, { admin: true }), request(`notes/${token}`, { admin: true })]);
    if (!record) throw new APIError(404, '答卷不存在');
    const rubric = await request(`rubrics/${record.version}`, { admin: true });
    return detailedAttempt(token, record, rubric, grade, note);
  }
  function invitationUrl(token) {
    const base = new URL('./index.html', getLocation().href);
    base.search = ''; base.hash = `invite=${token}`;
    return base.href;
  }
  async function createInvitation({ position, expires_days = 7 } = {}) {
    const { config: cfg, version } = await readCurrent();
    const days = integer(Number(expires_days), '邀请有效天数', 1, 30);
    const token = random();
    if (!TOKEN.test(token)) throw new APIError(500, '随机邀请凭证生成失败');
    const invitation = { version, position: text(position || cfg.position, '岗位', 80), created_at: timestamp(), expires_at: now() + days * 86400000, enabled: true };
    const saved = await request(`invitations/${token}`, { admin: true, method: 'PUT', body: invitation });
    return { token, url: invitationUrl(token), invitation: saved, ...saved };
  }
  async function listInvitations() {
    const [invitations, submissions] = await Promise.all([request('invitations', { admin: true }), request('submissions', { admin: true })]);
    return { invitations: Object.entries(invitations || {}).map(([token, invitation]) => ({ token, url: invitationUrl(token), ...invitation, submitted_at: submissions?.[token]?.submitted_at || null, status: submissions?.[token] ? 'submitted' : invitation.enabled && invitation.expires_at > now() ? 'ready' : 'inactive' })).sort((a, b) => b.created_at - a.created_at) };
  }

  async function api(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body || {};
    if (!path.startsWith('/api/admin/')) return candidateApi(path, method, body, options.headers);
    if (path === '/api/admin/session' && method === 'GET') return session();
    if (path === '/api/admin/logout' && method === 'POST') return logout();
    await getToken();
    if (path === '/api/admin/settings') {
      if (method === 'GET') return (await readCurrent()).config;
      if (method === 'PUT') return saveSettings(body);
    }
    if (path === '/api/admin/attempts' && method === 'GET') return { attempts: (await allAttempts()).map(summary) };
    const attempt = /^\/api\/admin\/attempts\/([a-f0-9]{64})$/.exec(path);
    if (attempt) {
      if (method === 'PATCH') await request(`notes/${attempt[1]}`, { admin: true, method: 'PUT', body: text(body.notes ?? '', '复核备注', 10000, 0) });
      if (['GET', 'PATCH'].includes(method)) return { attempt: await detail(attempt[1]) };
      throw new APIError(405, '答卷为不可修改的原始记录；可在备注中标记，删除需由数据库管理员处理');
    }
    if (path === '/api/admin/invitations') {
      if (method === 'GET') return listInvitations();
      if (method === 'POST') return createInvitation(body);
    }
    const invite = /^\/api\/admin\/invitations\/([a-f0-9]{64})$/.exec(path);
    if (invite && method === 'DELETE') {
      await request(`invitations/${invite[1]}`, { admin: true, method: 'PATCH', body: { enabled: false } });
      return { ok: true };
    }
    if (path === '/api/admin/export.csv' && method === 'GET') return exportCSV(await allAttempts());
    if (path === '/api/admin/backup' && method === 'GET') return { format: 'weieryang-interview-firebase-backup.v1', exported_at: new Date(now()).toISOString(), namespace: ns, data: await request('', { admin: true }) };
    throw new APIError(404, '接口不存在');
  }
  return { api, createInvitation, getInvitationContext, clearDraft, request };
}

let defaultApi;
const instance = () => defaultApi || (defaultApi = createFirebaseApi());
export const api = (...args) => instance().api(...args);
export const createInvitation = (...args) => instance().createInvitation(...args);
export const getInvitationContext = (...args) => instance().getInvitationContext(...args);
export async function downloadExport(format = 'csv') {
  const isCsv = format === 'csv';
  const data = await api(isCsv ? '/api/admin/export.csv' : '/api/admin/backup');
  const blob = new Blob([isCsv ? data : JSON.stringify(data, null, 2)], { type: isCsv ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = isCsv ? '威尔阳-测评结果.csv' : '威尔阳-测评备份.json';
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
