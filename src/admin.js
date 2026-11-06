import { api, escapeHTML as esc, formatTime, formatDate, toast } from './common.js';
import { createInvitation, downloadExport } from './firebase-api.js';
import { signInAdmin, signOutAdmin } from './firebase-auth.js';
import { ownerEmail } from './firebase-config.js';

const app = document.querySelector('#admin-app');
const dialog = document.querySelector('#detail-dialog');
const state = { attempts: [], config: null, tab: 'results', query: '', filter: 'all', dirty: false, detail: null, invitations: [], latestInvitation: null };
let lastFocus = null;
let loginPending = false;
const iconPaths = {
  list: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 12h8M8 17h5"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  shield: '<path d="M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="M8 12l3 3 5-6"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="M15 15l5 5"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || ''}</svg>`;
const brand = '<span class="admin-mark" aria-hidden="true">W</span><span><strong>WEIERYANG</strong><small>RECRUITMENT STUDIO</small></span>';
const fmtDate = value => value ? esc(formatDate(value)) : '—';
const fmtTime = value => esc(formatTime(Number(value) || 0));
const statusBadge = a => a.status === 'submitted'
  ? `<span class="badge ${a.passed ? 'badge-pass' : 'badge-fail'}">${a.passed ? '达到参考分' : '建议深入沟通'}</span>`
  : '<span class="badge badge-neutral">作答中</span>';
const answerLabel = (q, value) => {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return '未作答';
  const ids = Array.isArray(value) ? value : [value];
  return ids.map(id => `${id}. ${q.options.find(o => o.id === id)?.text || id}`).join(Array.isArray(value) ? ' → ' : '');
};
const sameAnswer = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function boot() {
  try {
    const session = await api('/api/admin/session');
    if (!session.authenticated) return renderAuth();
    const [results, config, invitations] = await Promise.all([api('/api/admin/attempts'), api('/api/admin/settings'), api('/api/admin/invitations')]);
    state.invitations = invitations.invitations || [];
    state.attempts = results.attempts || [];
    state.config = config;
    renderShell();
  } catch (error) {
    if (error.status === 401 || error.status === 403) return renderAuth();
    app.innerHTML = `<main class="auth-wrap"><a class="admin-brand" href="./index.html">${brand}</a><section class="auth-card"><h1>暂时无法打开工作台</h1><p>${esc(error.message)}</p><button class="btn btn-primary" data-action="retry">重新连接</button></section></main>`;
  }
}

function renderAuth() {
  app.innerHTML = `<main class="auth-wrap">
    <a class="admin-brand" href="./index.html" aria-label="威尔阳候选人测评首页">${brand}</a>
    <section class="auth-card" aria-labelledby="auth-title">
      <p class="eyebrow">HR WORKSPACE</p><h1 id="auth-title">登录 HR 工作台</h1>
      <p>查看候选人答卷，管理测评题目与评分规则。</p>
      <form id="admin-login-form" class="admin-login-form" method="post" aria-describedby="auth-note">
        <label class="field"><span class="field-label">管理员邮箱</span><input class="input" type="email" name="email" autocomplete="username" spellcheck="false" autocapitalize="none" value="${esc(ownerEmail)}" required></label>
        <label class="field"><span class="field-label">登录密码</span><input class="input" type="password" name="password" autocomplete="current-password" placeholder="请输入管理员密码" required></label>
        <p class="error-message" id="auth-error" role="alert"></p>
        <button class="btn btn-primary" type="submit">登录工作台</button>
      </form>
    </section>
    <p class="auth-note" id="auth-note">仅指定的管理员账号可以管理测评。候选人使用专属链接答题，无需登录。</p>
    <a class="auth-home" href="./index.html">返回候选人测评入口</a>
  </main>`;
}

async function submitLogin(form) {
  if(loginPending || !form.reportValidity()) return;
  loginPending = true;
  const emailInput = form.elements.namedItem('email');
  const passwordInput = form.elements.namedItem('password');
  const button = form.querySelector('button[type="submit"]');
  const errorMessage = form.querySelector('#auth-error');
  const email = emailInput.value.trim();
  errorMessage.textContent = '';
  form.setAttribute('aria-busy', 'true');
  button.disabled = true;button.textContent = '正在登录…';
  emailInput.disabled = true;passwordInput.disabled = true;
  try {
    const request = signInAdmin(email, passwordInput.value);
    passwordInput.value = '';
    await request;
    await boot();
  } catch(error) {
    if(errorMessage.isConnected) errorMessage.textContent = error.message;
  } finally {
    passwordInput.value = '';
    loginPending = false;
    if(form.isConnected) {
      form.removeAttribute('aria-busy');
      emailInput.disabled = false;passwordInput.disabled = false;
      button.disabled = false;button.textContent = '登录工作台';
      if(errorMessage.textContent) passwordInput.focus();
    }
  }
}

function renderShell() {
  app.innerHTML = `<div class="admin-layout">
    <aside class="admin-sidebar">
      <a class="admin-brand" href="./index.html" target="_blank" rel="noopener">${brand}</a>
      <p class="sidebar-label">RECRUITMENT / 招聘管理</p>
      <nav class="admin-nav" aria-label="工作台导航">
        <button type="button" data-tab="results" ${state.tab === 'results' ? 'aria-current="page"' : ''}><span class="nav-icon">${icon('list')}</span>考生答卷</button>
        <button type="button" data-tab="invitations" ${state.tab === 'invitations' ? 'aria-current="page"' : ''}><span class="nav-icon">${icon('arrow')}</span>邀请链接</button>
        <button type="button" data-tab="settings" ${state.tab === 'settings' ? 'aria-current="page"' : ''}><span class="nav-icon">${icon('settings')}</span>测评设置</button>
      </nav>
      <div class="sidebar-bottom"><a href="./index.html" target="_blank" rel="noopener"><span class="nav-icon">${icon('arrow')}</span>打开候选人入口</a><p>${esc(state.config.company)}<br>面试测评 · HR 工作台</p></div>
    </aside>
    <main class="admin-main">
      <div class="admin-topline"><span class="eyebrow">PEOPLE MAKE THE DIFFERENCE</span><div class="admin-account"><span><span class="admin-dot"></span>管理员</span><button class="btn btn-quiet" type="button" data-action="logout">退出登录</button></div></div>
      <div id="admin-content">${state.tab === 'results' ? resultsView() : state.tab === 'invitations' ? invitationsView() : settingsView()}</div>
    </main>
  </div>`;
}

function resultsView() {
  const submitted = state.attempts.filter(a => a.status === 'submitted');
  const mixedVersions = new Set(submitted.map(a => a.rubric_version || 'legacy')).size > 1;
  const average = submitted.length && !mixedVersions ? Math.round(submitted.reduce((sum, a) => sum + (Number(a.score) || 0), 0) / submitted.length) : '—';
  const reached = submitted.filter(a => a.passed).length;
  return `<header class="page-heading"><div><h1>考生答卷</h1><p>了解作答过程，找到值得深入沟通的人。</p></div><div class="admin-actions"><button class="btn btn-secondary" type="button" data-action="export-csv">导出 CSV</button><button class="btn btn-primary" data-action="open-invitations">生成候选人链接</button></div></header>
    <section class="stat-grid" aria-label="测评概况">
      <article class="stat-card"><div class="stat-label">累计参与</div><div class="stat-value">${state.attempts.length}<small>人</small></div><div class="stat-meta">已成功提交的答卷</div></article>
      <article class="stat-card"><div class="stat-label">已完成测评</div><div class="stat-value">${submitted.length}<small>人</small></div><div class="stat-meta">打开后台时自动计算并保存参考分</div></article>
      <article class="stat-card"><div class="stat-label">平均参考分</div><div class="stat-value">${average}<small>分</small></div><div class="stat-meta">${mixedVersions ? '规则版本不同，不合并计算' : '仅统计已提交答卷'}</div></article>
      <article class="stat-card"><div class="stat-label">达到参考分</div><div class="stat-value">${reached}<small>人</small></div><div class="stat-meta">按每份邀请绑定的标准</div></article>
    </section>
    <section class="results-panel" aria-label="候选人答卷列表">
      <div class="results-toolbar"><label class="search-field"><span class="sr-only">搜索姓名或应聘岗位</span>${icon('search')}<input class="input" type="search" id="candidate-search" placeholder="搜索姓名 / 应聘岗位" value="${esc(state.query)}"></label><div class="filter-group"><label class="sr-only" for="status-filter">筛选答卷</label><select id="status-filter" class="input"><option value="all" ${state.filter === 'all' ? 'selected' : ''}>全部答卷</option><option value="submitted" ${state.filter === 'submitted' ? 'selected' : ''}>已提交</option><option value="reached" ${state.filter === 'reached' ? 'selected' : ''}>达到参考分</option><option value="review" ${state.filter === 'review' ? 'selected' : ''}>建议深入沟通</option></select><button class="btn btn-quiet" data-action="refresh">刷新</button></div></div>
      <div id="results-rows">${resultRows()}</div>
    </section>
    <p class="admin-footnote">${icon('shield')}<span>参考分用于辅助面试，不代表自动录用或淘汰。切屏次数仅供了解作答环境，请结合候选人的解释人工复核。</span></p>`;
}

function resultRows() {
  const query = state.query.trim().toLowerCase();
  const rows = state.attempts.filter(a => (!query || `${a.name} ${a.position}`.toLowerCase().includes(query)) && (state.filter === 'all' || state.filter === a.status || (state.filter === 'reached' && a.status === 'submitted' && a.passed) || (state.filter === 'review' && a.status === 'submitted' && !a.passed)));
  if (!rows.length) return `<div class="admin-empty"><div class="empty-number">—</div><h3>${state.attempts.length ? '没有匹配的答卷' : '等待第一位候选人'}</h3><p>${state.attempts.length ? '试试其他姓名、岗位或筛选条件。' : '为候选人生成专属链接，提交成功后的答卷会出现在这里。'}</p>${state.attempts.length ? '<button class="btn btn-secondary" data-action="clear-filter">清除筛选</button>' : '<button class="btn btn-secondary" data-action="open-invitations">生成候选人链接</button>'}</div>`;
  return `<div class="table-wrap"><table class="results-table"><thead><tr><th scope="col">候选人</th><th scope="col">参考分</th><th scope="col">作答状态</th><th scope="col">用时 / 切屏</th><th scope="col" class="date-col">提交时间</th><th scope="col"><span class="sr-only">操作</span></th></tr></thead><tbody>${rows.map(a => `<tr><td><div class="candidate-name">${esc(a.name)}</div><div class="candidate-position">${esc(a.position)}</div></td><td><span class="score-value ${a.status === 'submitted' && !a.passed ? 'low' : ''}">${a.status === 'submitted' ? esc(String(a.score ?? '—')) : '—'}</span></td><td>${statusBadge(a)}${a.review_count ? `<div class="review-count">${Number(a.review_count)} 项需复核</div>` : ''}</td><td><span class="num">${fmtTime(a.elapsed_seconds)}</span><div class="candidate-position">切屏 ${Number(a.warning_count) || 0} 次</div></td><td class="date-col">${fmtDate(a.submitted_at)}</td><td><button class="table-action" data-action="detail" data-id="${esc(a.id)}" aria-label="查看${esc(a.name)}的答卷">查看答卷</button></td></tr>`).join('')}</tbody></table></div><div class="table-footer"><span>显示 ${rows.length} / ${state.attempts.length} 份答卷</span><span>答卷按邀请绑定的题目与参考标准保存</span></div>`;
}

function settingsView() {
  const c = state.config;
  const weighted = c.questions.filter(q => q.scoring?.mode === 'weighted');
  const profiles = c.questions.filter(q => q.scoring?.mode === 'profile');
  const modern = c.questions.some(q => q.scoring);
  return `<header class="page-heading"><div><h1>测评设置</h1><p>用具体工作行为作为评价依据，保留沟通空间。</p></div><div class="admin-actions"><a class="btn btn-secondary" href="./index.html" target="_blank" rel="noopener">预览候选人页面</a></div></header>
    <form id="settings-form" novalidate><div class="settings-grid"><div>
      <section class="settings-section"><h2>招聘信息</h2><p class="settings-subtitle">这些内容会展示在候选人的测评入口。</p><div class="settings-fields">
        ${textField('company', '公司 / 品牌名称', c.company, 80)}
        ${textField('title', '测评标题', c.title, 120)}
        ${textField('position', '默认应聘岗位', c.position, 80)}
        ${textField('estimated_minutes', '预计用时（分钟）', c.estimated_minutes, 30)}
        <label class="field full-width"><span class="field-label">测评介绍</span><textarea name="intro" class="input" maxlength="1200" required>${esc(c.intro || '')}</textarea></label>
      </div></section>
      <section class="settings-section"><h2>参考标准</h2><p class="settings-subtitle">${modern ? `${weighted.length} 题按选项分值计分，总上限 ${weighted.reduce((sum, q) => sum + Number(q.scoring.max), 0)} 分；${profiles.length} 题用于面试沟通，不计对错。排序题的 3 / 2 / 1 仅表示偏好顺序。` : '旧版题库：所有题目等权计分。答案与参考完全一致才计分，排序题也要求顺序一致。'}</p><div class="settings-fields">
        ${modern ? `<label class="field full-width"><span class="field-label">推定规则版本</span><input class="input" name="rubric_version" value="${esc(c.rubric_version || '')}" maxlength="100" required></label>` : ''}
        <label class="field"><span class="field-label">参考分数线（0–100）</span><input class="input" type="number" min="0" max="100" step="1" name="pass_score" value="${Number(c.pass_score)}" required></label>
        <label class="field"><span class="field-label">切屏提醒阈值（次）</span><input class="input" type="number" min="1" max="100" step="1" name="warning_limit" value="${Number(c.warning_limit)}" required></label>
      </div><p class="editor-help">${modern ? '这是威尔阳自行制定的参考规则，不是原站后端分值，也不是经验证的心理量表。调整分值后请更新版本名称，便于区分。' : ''}复核提示与切屏记录均不触发自动淘汰。</p></section>
      <section class="settings-section"><h2>题库与评分规则 <span class="settings-status">${c.questions.length} 题</span></h2><p class="settings-subtitle">点击题目展开。选项分值、复核说明和面试追问仅管理员可见。</p>
        ${c.questions.map((q, i) => questionEditor(q, i)).join('')}
      </section>
      <div class="settings-savebar"><p id="settings-save-status" role="status">${state.dirty ? '有尚未保存的修改' : '修改后请保存设置'}</p><button class="btn btn-primary" type="submit">保存全部设置</button></div>
    </div><aside class="settings-aside"><h3>你的独立测评系统</h3><p>新设置对之后生成的邀请链接生效。已有邀请与答卷保留各自绑定的题目、分值与版本。</p><p>${modern ? '工作行为题提供参考分；薪资、休息、职业偏好等回答保留为沟通材料。请用具体经历验证回答，不直接据此录用或淘汰。' : '当前为旧版业务场景参考题。新旧规则的分数不宜直接比较。'}</p><p>答卷提交后保存在 Firebase；打开或刷新后台时自动计算并保存评分。定期导出备份，保留需要的招聘记录。</p><button class="btn btn-secondary" type="button" data-action="export-json">下载完整备份</button></aside></div></form>`;
}

function textField(name, label, value, max) {
  return `<label class="field"><span class="field-label">${label}</span><input class="input" name="${name}" value="${esc(value || '')}" maxlength="${max}" required></label>`;
}

function questionEditor(q, i) {
  const scoring = q.scoring;
  const scoringLabel = scoring ? (scoring.mode === 'weighted' ? `计分 · 满分 ${scoring.max}` : '沟通项 · 不计分') : '旧版参考答案';
  return `<details class="question-editor"><summary><span class="editor-number">${String(i + 1).padStart(2, '0')}</span><span class="editor-summary-text"><small>${esc(q.category)} · ${q.type === 'rank' ? `排序选 ${q.rank_count} 项` : '单选'} · ${esc(scoringLabel)}</small>${esc(q.text)}</span></summary><div class="editor-body">
    <label class="field"><span class="field-label">题目分类</span><input class="input" name="q_${i}_category" value="${esc(q.category)}" maxlength="60" required></label>
    <label class="field"><span class="field-label">题目内容</span><textarea class="input" name="q_${i}_text" maxlength="2000" required>${esc(q.text)}</textarea></label>
    <div class="field"><span class="field-label">选项内容</span>${q.options.map((o, j) => `<div class="editor-option"><label for="q_${i}_option_${j}">${esc(o.id)}</label><input id="q_${i}_option_${j}" class="input" name="q_${i}_option_${j}" value="${esc(o.text)}" maxlength="1200" required></div>`).join('')}</div>
    ${scoring ? scoring.mode === 'weighted' ? `<label class="field"><span class="field-label">本题满分</span><input class="input" type="number" name="q_${i}_max" min="1" max="100" step="1" value="${Number(scoring.max)}" required></label><div class="score-editor"><p class="editor-help">每项为 0 至本题满分的整数，至少一个选项为满分；全部计分题满分合计须为 100。复核说明留空表示不单独提示。</p>${q.options.map((o, j) => `<div class="score-option"><label class="field"><span class="field-label">${esc(o.id)} 选项分值</span><input class="input" type="number" name="q_${i}_score_${j}" min="0" max="100" step="1" value="${Number(scoring.option_scores[o.id])}" required></label><label class="field"><span class="field-label">${esc(o.id)} 选项复核说明</span><input class="input" name="q_${i}_review_${j}" maxlength="1000" value="${esc(scoring.review_options?.[o.id] || '')}" placeholder="需要在面试中核实的问题"></label></div>`).join('')}</div>` : `<p class="profile-note">此题不计分，也不判定标准答案。${q.type === 'rank' ? '依次选择的项目以 3 / 2 / 1 标示偏好顺序，不加入总分。' : '保留选择，用于双方进一步沟通。'}</p>` : `<div class="editor-correct"><label class="field"><span class="field-label">${q.type === 'rank' ? '参考顺序' : '参考答案'}</span>${q.type === 'rank' ? `<input class="input" name="q_${i}_correct" value="${esc((q.correct || []).join(','))}" placeholder="例如 A,C,B" required>` : `<select class="input" name="q_${i}_correct">${q.options.map(o => `<option value="${esc(o.id)}" ${o.id === q.correct ? 'selected' : ''}>${esc(o.id)}</option>`).join('')}</select>`}</label><p class="editor-help">旧版等权规则，须与参考答案完全一致。</p></div>`}
    <label class="field"><span class="field-label">评分 / 沟通说明（仅 HR 可见）</span><textarea class="input" name="q_${i}_explanation" maxlength="2000">${esc(q.explanation || '')}</textarea></label>
    ${scoring ? `<label class="field"><span class="field-label">建议面试追问（仅 HR 可见）</span><textarea class="input" name="q_${i}_follow_up" maxlength="2000">${esc(q.follow_up || '')}</textarea></label>` : ''}
  </div></details>`;
}

function detailQuestion(attempt, q, i) {
  const chosen = attempt.answers?.[q.id];
  const answered = chosen != null && chosen !== '' && (!Array.isArray(chosen) || chosen.length > 0);
  const settled = attempt.status === 'submitted';
  const result = (attempt.question_scores || []).find(item => item.id === q.id);
  const preference = (attempt.preferences || []).find(item => item.id === q.id);
  let badge = '未作答', badgeClass = 'badge-neutral', reference = '';
  if (q.scoring) {
    if (q.scoring.mode === 'profile') {
      badge = answered ? '沟通项 · 不计分' : '未作答';
      reference = `<div class="answer-line ref"><span>评价方式</span><span>不计分，不判对错${q.type === 'rank' ? '；顺序仅表示择业偏好' : ''}。</span></div>`;
      if (q.type === 'rank' && preference?.choices?.length) reference += `<div class="preference-list">${preference.choices.map((choice, index) => `<div><span>第 ${index + 1} 位 · 偏好权重 ${Number(choice.weight)}</span><strong>${esc(choice.id)}. ${esc(choice.text)}</strong></div>`).join('')}</div>`;
    } else {
      badge = !answered ? '未作答' : !settled || !result || result.score == null ? '待评分' : `${result.score} / ${result.max} 分`;
      badgeClass = result && result.score != null && result.score === result.max ? 'badge-pass' : 'badge-neutral';
      reference = `<div class="answer-line ref"><span>选项分值</span><span>${q.options.map(o => `${esc(o.id)}：${Number(q.scoring.option_scores?.[o.id] ?? 0)} 分`).join(' · ')}</span></div>`;
    }
  } else {
    const matched = answered && sameAnswer(chosen, q.correct);
    badge = !answered ? '未作答' : !settled ? '待评分' : matched ? '符合参考' : '沟通了解';
    badgeClass = settled && matched ? 'badge-pass' : 'badge-neutral';
    reference = `<div class="answer-line ref"><span>参考答案</span><span>${esc(answerLabel(q, q.correct))}</span></div>`;
  }
  return `<article class="detail-question"><div class="detail-question-top"><h4>${String(i + 1).padStart(2, '0')}. ${esc(q.text)}</h4><span class="badge ${badgeClass}">${esc(badge)}</span></div><div class="answer-line"><span>候选人</span><span>${esc(answerLabel(q, chosen))}</span></div>${reference}${result?.review_reason ? `<p class="review-message">${esc(result.review_reason)}</p>` : ''}${q.explanation ? `<p class="answer-explanation">${esc(q.explanation)}</p>` : ''}${q.follow_up ? `<p class="follow-up"><strong>面试追问：</strong>${esc(q.follow_up)}</p>` : ''}</article>`;
}

async function showDetail(id) {
  lastFocus = document.activeElement;
  const { attempt } = await api(`/api/admin/attempts/${encodeURIComponent(id)}`);
  state.detail = attempt;
  const modern = attempt.questions.some(q => q.scoring);
  const settled = attempt.status === 'submitted';
  const flags = attempt.review_flags || [];
  dialog.innerHTML = `<header class="detail-head"><div><h2 id="detail-title">${esc(attempt.name)}的答卷</h2><p>${esc(attempt.position)} · ${settled ? '已提交' : '作答中'} · 开始于 ${fmtDate(attempt.created_at)}</p></div><button type="button" class="detail-close" data-action="close-detail" aria-label="关闭答卷">×</button></header>
    <div class="detail-body"><div class="detail-overview"><div class="detail-stat"><p>工作行为参考分</p><strong>${settled ? esc(String(attempt.score ?? '—')) : '—'}</strong><small>/ 100</small></div><div class="detail-stat"><p>作答用时</p><strong>${fmtTime(attempt.elapsed_seconds)}</strong></div><div class="detail-stat"><p>切屏记录</p><strong>${Number(attempt.warning_count) || 0}</strong><small>次</small></div></div>
    ${statusBadge(attempt)}<p class="detail-summary-note">规则：${esc(attempt.rubric_version || '旧版等权规则')}。本卷参考分数线 ${Number(attempt.pass_score ?? 80)} 分，保留生成邀请时的标准。${modern ? '各项按预设分值相加，沟通项与偏好排序不加入总分。这是自行制定的推定规则，不是原站分值或心理量表。' : '旧版单选、排序均须与参考答案完全一致才计分。'}分数和复核提示只辅助人工面试，不触发自动录用或淘汰。</p>
    ${modern && settled ? `<section class="dimension-section"><h3>工作行为分项</h3><div class="dimension-grid">${(attempt.dimension_scores || []).map(d => `<article><span>${esc(d.category)}</span><strong>${Number(d.score)} <small>/ ${Number(d.max)}</small></strong></article>`).join('')}</div></section><section class="review-section"><h3>重点复核 ${flags.length ? `· ${flags.length} 项` : ''}</h3>${flags.length ? `<ul>${flags.map(flag => { const index = attempt.questions.findIndex(q => q.id === flag.id); return `<li><strong>${index >= 0 ? `第 ${index + 1} 题` : esc(flag.id)}</strong>：${esc(flag.message)}</li>`; }).join('')}</ul><p>即使总分达到参考线，也应完成这些追问；提示本身不代表已发生相关行为。</p>` : '<p>本次选择未触发预设复核项，仍需结合经历与岗位任务验证。</p>'}</section>` : ''}
    <section class="detail-questions"><h3>逐题查看</h3>${attempt.questions.map((q, i) => detailQuestion(attempt, q, i)).join('')}</section>
    <form id="notes-form" class="notes-box"><h3>面试记录</h3><label class="sr-only" for="review-notes">面试补充记录</label><textarea class="input" id="review-notes" name="notes" maxlength="10000" placeholder="记录追问内容、候选人说明与人工评估意见…">${esc(attempt.notes || '')}</textarea><div class="notes-actions"><p id="notes-status" role="status">记录仅管理员可见。</p><button class="btn btn-primary" type="submit">保存面试记录</button></div></form>
    </div>`;
  dialog.showModal();
  dialog.scrollTop = 0;
  dialog.querySelector('.detail-close').focus();
}

function invitationURL(item) {
  if(item.url) return item.url;
  const url=new URL('./index.html',location.href);url.hash=`invite=${item.token}`;return url.href;
}
function invitationStatus(item) {
  if(item.submitted_at||item.status==='submitted'||item.used) return {label:'已提交',usable:false};
  if(item.enabled===false) return {label:'已停用',usable:false};
  if(new Date(item.expires_at).getTime()<=Date.now()) return {label:'已过期',usable:false};
  return {label:'待作答',usable:true};
}
function invitationsView() {
  const latest=state.latestInvitation;
  return `<header class="page-heading"><div><h1>候选人邀请</h1><p>每位候选人使用一份专属链接，提交一次后失效。</p></div><button class="btn btn-secondary" data-action="refresh-invitations">刷新邀请</button></header>
  <section class="settings-section invite-create"><h2>生成新的邀请链接</h2><p class="settings-subtitle">无需候选人注册账号。题目和评分标准绑定到当前版本，之后修改设置不会影响这份邀请。</p>
    <form id="invitation-form"><div class="settings-fields"><label class="field"><span class="field-label">应聘岗位</span><input class="input" name="position" maxlength="80" value="${esc(state.config.position)}" required></label><label class="field"><span class="field-label">有效期</span><select class="input" name="expires_days"><option value="1">1 天</option><option value="3">3 天</option><option value="7" selected>7 天</option><option value="14">14 天</option><option value="30">30 天</option></select></label></div><div class="invite-submit"><p class="editor-help">请将链接单独发给对应候选人，不要在公开群里重复分发。</p><button class="btn btn-primary" type="submit">生成一份邀请</button></div></form>
    ${latest?`<div class="invite-ready" role="status"><strong>邀请已生成</strong><p>复制下面的链接，发给一位候选人即可。</p><input class="input" aria-label="新生成的邀请链接" readonly value="${esc(latest.url)}"><button class="btn btn-primary" data-action="copy-invitation" data-token="${esc(latest.token)}">复制这个链接</button></div>`:''}
  </section><section class="results-panel"><div class="results-toolbar"><h2 class="invite-list-title">已生成的邀请</h2><span class="editor-help">${state.invitations.length} 份 · 复制不会生成新链接</span></div>${state.invitations.length?`<div class="invitation-list">${state.invitations.map(item=>{const status=invitationStatus(item);return `<article class="invitation-row"><div><strong>${esc(item.position||state.config.position)}</strong><p>创建于 ${fmtDate(item.created_at)} · 截止 ${fmtDate(item.expires_at)}</p><small>编号 ${esc(item.token.slice(0,8))} · 版本 ${esc(item.rubric_version||item.version||'')}</small></div><div class="invitation-actions"><span class="badge ${status.usable?'badge-pass':'badge-neutral'}">${status.label}</span>${status.usable?`<button class="btn btn-secondary" data-action="copy-invitation" data-token="${esc(item.token)}">复制链接</button><button class="btn btn-quiet" data-action="disable-invitation" data-token="${esc(item.token)}">停用</button>`:''}</div></article>`;}).join('')}</div>`:'<div class="admin-empty"><h3>还没有邀请链接</h3><p>在上方填写岗位，为第一位候选人生成邀请。</p></div>'}</section>`;
}
async function refreshInvitations(){
  const data=await api('/api/admin/invitations');state.invitations=data.invitations||[];
  if(state.latestInvitation){
    const refreshed=state.invitations.find(item=>item.token===state.latestInvitation.token);
    state.latestInvitation=refreshed&&invitationStatus(refreshed).usable?refreshed:null;
  }
}
async function copyInvitation(token) {
  await refreshInvitations();
  const item=state.invitations.find(item=>item.token===token)||(state.latestInvitation?.token===token?state.latestInvitation:null);
  if(!item)throw new Error('找不到这份邀请，请刷新后重试。');
  const status=invitationStatus(item);
  if(!status.usable){renderShell();throw new Error(`这份邀请${status.label}，请生成新的邀请链接。`);}
  const url=invitationURL(item);
  try{await navigator.clipboard.writeText(url);toast('专属邀请链接已复制，请只发给一位候选人。');}
  catch{window.prompt('复制下面的专属邀请链接：',url);}
}

async function refreshResults(button) {
  if (button) button.disabled = true;
  try {
    const data = await api('/api/admin/attempts');
    state.attempts = data.attempts || [];
    if (state.tab === 'results') document.querySelector('#admin-content').innerHTML = resultsView();
  } finally { if (button?.isConnected) button.disabled = false; }
}

async function saveSettings(form) {
  const invalid = form.querySelector(':invalid');
  if (invalid) {
    const details = invalid.closest('details');
    if (details) details.open = true;
    invalid.reportValidity();
    return;
  }
  const data = new FormData(form);
  const next = structuredClone(state.config);
  for (const key of ['company', 'title', 'position', 'intro', 'estimated_minutes']) next[key] = String(data.get(key) || '').trim();
  next.pass_score = Number(data.get('pass_score'));
  next.warning_limit = Number(data.get('warning_limit'));
  if (next.questions.some(q => q.scoring)) next.rubric_version = String(data.get('rubric_version') || '').trim();
  next.questions = next.questions.map((q, i) => {
    q.category = String(data.get(`q_${i}_category`) || '').trim();
    q.text = String(data.get(`q_${i}_text`) || '').trim();
    q.explanation = String(data.get(`q_${i}_explanation`) || '').trim();
    q.options = q.options.map((o, j) => ({ ...o, text: String(data.get(`q_${i}_option_${j}`) || '').trim() }));
    if (q.scoring) {
      delete q.correct;
      q.follow_up = String(data.get(`q_${i}_follow_up`) || '').trim();
      if (q.scoring.mode === 'weighted') {
        q.scoring.max = Number(data.get(`q_${i}_max`));
        q.scoring.option_scores = Object.fromEntries(q.options.map((o, j) => [o.id, Number(data.get(`q_${i}_score_${j}`))]));
        q.scoring.review_options = Object.fromEntries(q.options.map((o, j) => [o.id, String(data.get(`q_${i}_review_${j}`) || '').trim()]).filter(([, value]) => value));
        if (Object.values(q.scoring.option_scores).some(value => value > q.scoring.max)) throw new Error(`第 ${i + 1} 题：选项分值不能超过本题满分。`);
        if (!Object.values(q.scoring.option_scores).includes(q.scoring.max)) throw new Error(`第 ${i + 1} 题：至少一个选项应为满分。`);
      }
    } else {
      const value = String(data.get(`q_${i}_correct`) || '').trim();
      q.correct = q.type === 'rank' ? value.split(/[,，\s]+/).filter(Boolean).map(id => q.options.find(o => o.id === id)?.id ?? q.options.find(o => o.id.toLowerCase() === id.toLowerCase())?.id ?? id) : value;
      if (q.type === 'rank' && (q.correct.length !== q.rank_count || new Set(q.correct).size !== q.rank_count || q.correct.some(id => !q.options.some(o => o.id === id)))) throw new Error(`第 ${i + 1} 题：请填写 ${q.rank_count} 个不同且有效的选项字母，按参考顺序排列。`);
    }
    return q;
  });
  if (next.questions.some(q => q.scoring) && next.questions.reduce((sum, q) => sum + Number(q.scoring?.max || 0), 0) !== 100) throw new Error('全部计分题的满分合计必须为 100 分。');
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true; button.textContent = '正在保存…';
  try {
    state.config = await api('/api/admin/settings', { method: 'PUT', body: next });
    state.dirty = false;
    renderShell();
    toast('设置已保存，对之后生成的新邀请生效');
  } finally { if (button.isConnected) { button.disabled = false; button.textContent = '保存全部设置'; } }
}

app.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  try {
    if (button.dataset.tab) {
      if (state.tab === button.dataset.tab) return;
      if (state.dirty && !window.confirm('有尚未保存的测评设置。确定放弃修改并离开吗？')) return;
      state.dirty = false;
      if(button.dataset.tab==='invitations')await refreshInvitations();
      state.tab = button.dataset.tab;
      renderShell();
      return;
    }
    switch (button.dataset.action) {
      case 'retry': return boot();
      case 'open-invitations': await refreshInvitations();state.tab='invitations';renderShell();return;
      case 'copy-invitation': return await copyInvitation(button.dataset.token);
      case 'refresh-invitations': button.disabled=true;await refreshInvitations();renderShell();return;
      case 'disable-invitation': {
        if(!window.confirm('停用这份邀请后，候选人将无法提交。确定停用吗？'))return;
        button.disabled=true;await api(`/api/admin/invitations/${encodeURIComponent(button.dataset.token)}`,{method:'DELETE'});await refreshInvitations();if(state.latestInvitation?.token===button.dataset.token)state.latestInvitation=null;renderShell();toast('邀请已停用');return;
      }
      case 'export-csv': button.disabled=true;try{await downloadExport('csv');}finally{if(button.isConnected)button.disabled=false;}return;
      case 'export-json': button.disabled=true;try{await downloadExport('json');}finally{if(button.isConnected)button.disabled=false;}return;
      case 'refresh': return await refreshResults(button);
      case 'detail': button.disabled = true; try { await showDetail(button.dataset.id); } finally { button.disabled = false; } break;
      case 'clear-filter': state.query = ''; state.filter = 'all'; document.querySelector('#admin-content').innerHTML = resultsView(); break;
      case 'logout': {
        if (state.dirty && !window.confirm('设置尚未保存，确定退出吗？')) return;
        button.disabled = true;
        try {
          await signOutAdmin();
          state.dirty = false; state.attempts = []; state.config = null; state.detail = null;
          if (dialog.open) dialog.close();
          dialog.innerHTML='';
          renderAuth();
          state.invitations=[];state.latestInvitation=null;
        } finally { if (button.isConnected) button.disabled = false; }
        break;
      }
    }
  } catch (error) { if(button.isConnected)button.disabled=false;toast(error.message, true); }
});

app.addEventListener('input', event => {
  if (event.target.id === 'candidate-search') {
    state.query = event.target.value;
    document.querySelector('#results-rows').innerHTML = resultRows();
  }
  if (event.target.closest('#settings-form')) {
    state.dirty = true;
    document.querySelector('#settings-save-status').textContent = '有尚未保存的修改';
  }
});

app.addEventListener('change', event => {
  if (event.target.id === 'status-filter') {
    state.filter = event.target.value;
    document.querySelector('#results-rows').innerHTML = resultRows();
  }
  if (event.target.closest('#settings-form')) {
    state.dirty = true;
    document.querySelector('#settings-save-status').textContent = '有尚未保存的修改';
  }
});

app.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  if(form.id==='admin-login-form'){await submitLogin(form);return;}
  if(form.id==='invitation-form'){
    if(!form.reportValidity())return;
    const button=form.querySelector('button[type="submit"]');button.disabled=true;button.textContent='正在生成…';
    try{
      const data=new FormData(form);
      const created=await createInvitation({position:String(data.get('position')||'').trim(),expires_days:Number(data.get('expires_days'))});
      state.latestInvitation={...created.invitation,token:created.token,url:created.url};
      state.invitations=[state.latestInvitation,...state.invitations.filter(item=>item.token!==created.token)];
      renderShell();
      document.querySelector('.invite-ready')?.scrollIntoView({block:'nearest'});
      toast('邀请已生成，点击复制后发给候选人。');
    }catch(error){toast(error.message,true);}finally{if(button.isConnected){button.disabled=false;button.textContent='生成一份邀请';}}return;
  }
  if (form.id === 'settings-form') {
    try { await saveSettings(form); } catch (error) { toast(error.message, true); }
    return;
  }

});

dialog.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.action === 'close-detail') return dialog.close();

});

dialog.addEventListener('submit', async event => {
  if (event.target.id !== 'notes-form') return;
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const notes = String(new FormData(form).get('notes') || '').trim();
    const data = await api(`/api/admin/attempts/${encodeURIComponent(state.detail.id)}`, { method: 'PATCH', body: { notes } });
    state.detail = data.attempt;
    dialog.querySelector('#notes-status').textContent = '面试记录已保存。';
    toast('面试记录已保存');
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});

dialog.addEventListener('close', () => { if (lastFocus?.isConnected) lastFocus.focus(); });
window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
boot();
