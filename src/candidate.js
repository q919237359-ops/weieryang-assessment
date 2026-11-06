import {api, escapeHTML as esc, formatTime, toast} from './common.js';

const root=document.querySelector('#app');
const inviteToken=new URLSearchParams(location.hash.slice(1)).get('invite')||'';
const storageKey=`weieryang-interview-ui-v2:${inviteToken}`;
const icon=(name,size=18)=>{
  const paths={arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',paper:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',check:'<path d="m5 12 4 4L19 6"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',back:'<path d="M20 12H4m6-6-6 6 6 6"/>'};
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.paper}</svg>`;
};
let config, attempt, token, current=0, mode='welcome', saveTimer, startedClock, initialElapsed=0, pendingWarning=false, sending=false, savedVersion=0, version=0, saveChain=Promise.resolve();
const complete=q=>q.type==='rank'?Array.isArray(attempt?.answers[q.id])&&attempt.answers[q.id].length===q.rank_count:typeof attempt?.answers[q.id]==='string'&&q.options.some(o=>o.id===attempt.answers[q.id]);
const answered=()=>attempt.questions.filter(complete).length;
function elapsed(){return mode==='done'?attempt.elapsed_seconds:Math.max(initialElapsed,Math.floor((Date.now()-startedClock)/1000)+initialElapsed);}
function stash(){try{sessionStorage.setItem(storageKey,JSON.stringify({attempt,token,current,version,updated:Date.now()}));}catch{}}
function readStash(){try{return JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{return null;}}
function clearStash(){try{sessionStorage.removeItem(storageKey);}catch{}}
function footer(){return `<footer class="site-footer"><span>${esc(config.company)} · RECRUITMENT</span><a href="./admin.html">HR 管理入口 ${icon('arrow',12)}</a></footer>`;}
function header(){return `<header class="site-header"><a class="wordmark" href="./index.html" aria-label="测评首页"><span class="brand-seal" aria-hidden="true">W</span><span>${esc(config.company)}<small>PEOPLE & POSSIBILITIES</small></span></a><span class="header-meta">面试测评 / ASSESSMENT</span></header>`;}
function welcome(){
  mode='welcome'; document.title=`${config.company} · 面试测评`;
  const single=config.questions.filter(q=>q.type!=='rank').length,rank=config.questions.length-single;
  root.innerHTML=header()+`<main class="welcome-layout"><p class="eyebrow welcome-kicker">一起，创造更多可能</p><h1 class="welcome-title">欢迎参加面试<em>${esc(config.company)}</em></h1><p class="welcome-description">${esc(config.title)}<br>${esc(config.intro||'让我们从真实的工作情境出发，了解彼此的工作方式。')}</p><div class="test-meta"><span>${icon('paper',15)} ${config.questions.length} 道测评题</span><span>${icon('clock',15)} 约 ${esc(config.estimated_minutes)} 分钟</span></div>${attempt?.status==='in_progress'?`<section class="resume-box"><p>您有一份未完成的测评：${esc(attempt.name)} · 已答 ${answered()} / ${attempt.question_count} 题</p><div class="resume-actions"><button class="btn btn-primary" id="resume">继续上次测评 ${icon('arrow',14)}</button><button class="btn btn-quiet" id="restart">重新填写本次答卷</button></div></section>`:''}<form class="welcome-form" id="welcome-form"><p class="form-caption">请先填写基本信息，方便 HR 与您对应</p><div class="field"><label class="field-label" for="candidate-name">您的姓名<span class="req">*</span></label><input class="input" id="candidate-name" name="name" autocomplete="name" maxlength="60" placeholder="请输入您的真实姓名" required></div><div class="field"><label class="field-label" for="candidate-position">应聘岗位</label><input class="input" id="candidate-position" name="position" maxlength="80" value="${esc(config.position)}" readonly aria-readonly="true" required></div><label class="candidate-consent"><input type="checkbox" name="consent" required><span>我已知晓：本次将收集姓名、岗位、作答、用时和离开页面次数，提交后由威尔阳 HR 用于本次招聘评估。我可以在提交前退出。</span></label><p class="error-message" id="start-error" role="alert"></p><button class="btn btn-primary start-button" type="submit"><span>开始测评</span>${icon('arrow',19)}</button></form><section class="note-card welcome-note"><h2>${icon('info',17)} 开始之前</h2><ul><li>本测评包含 ${single} 道单选题${rank?`和 ${rank} 道排序题`:''}，请按照真实想法作答。</li><li>作答草稿保存在当前浏览器标签页，可返回修改；点击提交并成功后，HR 才会收到答卷。</li><li>系统记录用时与离开页面次数，供 HR 面谈时参考。</li><li>测评仅作为面试参考，不直接决定录用结果。</li></ul></section><p class="privacy-line">${icon('lock',12)} 提交后的答卷保存在 Firebase，由威尔阳 HR 管理。</p></main>`+footer();
  document.querySelector('#welcome-form').addEventListener('submit',start);
  document.querySelector('#resume')?.addEventListener('click',()=>{beginClock();showQuestion(current);});
  document.querySelector('#restart')?.addEventListener('click',()=>{attempt=null;token=null;clearStash();welcome();document.querySelector('#candidate-name').focus();});
}
async function start(event){
  event.preventDefault();const form=event.currentTarget;
  if(!form.reportValidity())return;
  const name=form.elements.name.value.trim(),position=form.elements.position.value.trim();
  if(!name||!position){document.querySelector('#start-error').textContent='请填写姓名和应聘岗位';return;}
  const button=form.querySelector('button[type=submit]');button.disabled=true;button.textContent='正在准备题目…';document.querySelector('#start-error').textContent='';
  try{const data=await api('/api/attempts',{method:'POST',body:{name,position,consent:true}});attempt=data.attempt;token=data.token;current=0;version=0;savedVersion=0;beginClock();stash();showQuestion(0);}
  catch(error){document.querySelector('#start-error').textContent=error.message;button.disabled=false;button.innerHTML=`<span>重新开始测评</span>${icon('arrow',19)}`;}
}
function beginClock(){initialElapsed=attempt.elapsed_seconds||0;startedClock=Date.now();}
function progressHeader(){return `<header class="progress-header"><div class="progress-identity"><strong>${esc(config.company)}</strong><span>${esc(attempt.name)} · ${esc(attempt.position)}</span></div><div class="progress-center"><div class="progress-text"><span>${mode==='review'?'提交前检查':'面试测评'}</span><span>已答 <strong>${answered()}</strong> / ${attempt.questions.length}</span></div><div class="progress-track"><div class="progress-fill"></div></div></div><div class="timer">${icon('clock',16)}<span class="num" id="timer">${formatTime(elapsed())}</span></div></header>`;}
function nav(){return `<aside class="question-sidebar" id="question-nav"><h2>答题进度</h2><nav class="question-grid" aria-label="跳转题目">${attempt.questions.map((q,i)=>`<button class="q-nav ${complete(q)?'answered':''} ${i===current?'current':''}" data-go="${i}" aria-label="第 ${i+1} 题，${complete(q)?'已答':'未答'}" ${i===current?'aria-current="step"':''}>${String(i+1).padStart(2,'0')}</button>`).join('')}</nav><p class="nav-legend"><i></i> 已作答 · 点击题号可回看</p><p class="sidebar-note">不用追求标准答案。<br>真实的判断，有助于我们<br>更好地了解您的工作方式。</p></aside>`;}
function showQuestion(index,focus=true){
  if(sending)return;
  mode='test';current=Math.min(Math.max(0,index),attempt.questions.length-1);const q=attempt.questions[current];stash();
  const answer=attempt.answers[q.id], rank=q.type==='rank';
  root.innerHTML=progressHeader()+`<main class="test-layout"><section aria-labelledby="question-title"><div class="question-kicker"><span><span class="badge badge-neutral">${rank?'排序题':'单选题'}</span> &nbsp; ${esc(q.category)} · ${String(current+1).padStart(2,'0')}</span><button class="btn btn-quiet mobile-nav-toggle" id="show-nav">题目导航</button></div><h1 class="question-title" id="question-title" tabindex="-1">${esc(q.text)}</h1><p class="question-hint">${rank?`按您的优先顺序选择 ${q.rank_count} 项，再次点击可取消选择。`:'请选择最符合您真实想法的一项。'}</p>${rank?`<div class="rank-selection"><span>已选顺序：<strong>${(Array.isArray(answer)?answer:[]).join(' → ')||'等待选择'}</strong>（${Array.isArray(answer)?answer.length:0}/${q.rank_count}）</span><button class="btn btn-quiet" id="clear-rank">清空重选</button></div>`:''}<div class="option-list" role="group" aria-label="本题选项">${q.options.map(o=>{const selected=rank?Array.isArray(answer)&&answer.includes(o.id):answer===o.id;return `<button class="option-button ${selected?'selected':''}" data-option="${esc(o.id)}" aria-pressed="${selected}"><span class="option-letter">${rank&&selected?answer.indexOf(o.id)+1:esc(o.id)}</span><span class="option-text">${esc(o.text)}</span>${selected?icon('check',17):''}</button>`;}).join('')}</div><div class="question-actions"><button class="btn btn-quiet" id="previous" ${current===0?'disabled':''}>${icon('back',16)} 上一题</button><button class="btn btn-primary" id="next" ${!complete(q)?'disabled':''}>${current===attempt.questions.length-1?'检查并提交':'下一题'} ${icon('arrow',16)}</button></div><p class="save-status" id="save-status" role="status">${icon('lock',11)} ${savedVersion===version?'草稿已保存在当前标签页':'正在保存本地草稿…'}</p></section>${nav()}</main>`;
  document.querySelector('.progress-fill').style.width=`${answered()/attempt.questions.length*100}%`;
  document.querySelectorAll('[data-option]').forEach(button=>button.addEventListener('click',()=>choose(q,button.dataset.option)));
  document.querySelector('#previous').addEventListener('click',()=>showQuestion(current-1));
  document.querySelector('#next').addEventListener('click',()=>current===attempt.questions.length-1?review():showQuestion(current+1));
  document.querySelectorAll('[data-go]').forEach(button=>button.addEventListener('click',()=>showQuestion(Number(button.dataset.go))));
  document.querySelector('#show-nav').addEventListener('click',()=>{document.querySelector('#question-nav').classList.toggle('expanded');document.querySelector('#question-nav').scrollIntoView({block:'nearest'});});
  document.querySelector('#clear-rank')?.addEventListener('click',()=>{attempt.answers[q.id]=[];changed();showQuestion(current,false);});
  if(focus){document.querySelector('#question-title').focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});}
}
function choose(q,id){
  if(sending)return;
  if(q.type==='rank'){
    const values=Array.isArray(attempt.answers[q.id])?[...attempt.answers[q.id]]:[];
    if(values.includes(id))values.splice(values.indexOf(id),1);else if(values.length<q.rank_count)values.push(id);else{toast(`最多选择 ${q.rank_count} 项；点击已选项可取消`);return;}
    attempt.answers[q.id]=values;
  }else attempt.answers[q.id]=id;
  changed();showQuestion(current,false);
  document.querySelector(`[data-option="${id}"]`)?.focus({preventScroll:true});
}
function changed(){version++;attempt.elapsed_seconds=elapsed();stash();clearTimeout(saveTimer);saveTimer=setTimeout(()=>save(),350);}
function saveStatus(message,error=false){const el=document.querySelector('#save-status');if(el){el.textContent=message;el.classList.toggle('error',error);}}
function snapshot(){return {answers:structuredClone(attempt.answers),warning_count:attempt.warning_count||0,elapsed_seconds:elapsed()};}
async function save(){
  if(!attempt||attempt.status!=='in_progress'||sending)return;
  const saveVersion=version,payload=snapshot(),id=attempt.id,auth=token;
  saveStatus('正在保存本地草稿…');
  saveChain=saveChain.catch(()=>{}).then(async()=>{
    try{await api(`/api/attempts/${encodeURIComponent(id)}`,{method:'PATCH',headers:{Authorization:`Bearer ${auth}`},body:payload});savedVersion=Math.max(savedVersion,saveVersion);if(id===attempt?.id)saveStatus(savedVersion===version?'草稿已保存在当前标签页':'正在保存本地草稿…');}
    catch(error){if(id===attempt?.id)saveStatus(`${error.message}，作答仍保留在当前标签页`,true);}
  });return saveChain;
}
function answerLabel(q){const a=attempt.answers[q.id];if(!a||(Array.isArray(a)&&!a.length))return '';return (Array.isArray(a)?a:[a]).map(id=>{const o=q.options.find(x=>x.id===id);return `${id}. ${o?.text||''}`;}).join(' → ');}
function review(){
  if(sending)return;
  mode='review';const count=answered();
  root.innerHTML=progressHeader()+`<main class="review-layout"><header class="review-header"><p class="eyebrow">ONE LAST LOOK</p><h1>确认您的作答</h1><p>${count===attempt.questions.length?'所有题目已完成。提交后将交由 HR 阅卷。':`还有 ${attempt.questions.length-count} 道题未完成，请点击对应题目补充。`}</p></header>${attempt.questions.map((q,i)=>`<article class="review-item"><span class="review-index">${String(i+1).padStart(2,'0')}</span><div class="review-body"><h2>${esc(q.text)}</h2><p class="review-answer ${complete(q)?'':'missing'}">${complete(q)?esc(answerLabel(q)):'尚未完成作答'}</p></div><button class="btn btn-quiet review-edit" data-review="${i}">${complete(q)?'修改':'去作答'}</button></article>`).join('')}<p class="error-message" role="alert" id="submit-error"></p><div class="review-bottom"><small>已完成 ${count} / ${attempt.questions.length} 题 · 提交后不可修改</small><button class="btn btn-primary" id="submit" ${count!==attempt.questions.length?'disabled':''}>确认提交 ${icon('arrow',16)}</button></div></main>`;
  document.querySelector('.progress-fill').style.width=`${answered()/attempt.questions.length*100}%`;
  document.querySelectorAll('[data-review]').forEach(b=>b.addEventListener('click',()=>showQuestion(Number(b.dataset.review))));
  document.querySelector('#submit').addEventListener('click',submit);window.scrollTo({top:0,behavior:'instant'});
}
async function submit(){
  if(sending)return;sending=true;clearTimeout(saveTimer);const button=document.querySelector('#submit');button.disabled=true;button.textContent='正在提交，请稍候…';
  document.querySelectorAll('[data-review]').forEach(el=>el.disabled=true);
  document.querySelector('#submit-error').textContent='';
  try{await saveChain;const data=await api(`/api/attempts/${encodeURIComponent(attempt.id)}/submit`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:snapshot()});attempt=data.attempt;clearStash();done();}
  catch(error){document.querySelector('#submit-error').textContent=`提交尚未成功：${error.message}。请点击下方按钮重试。`;button.disabled=false;button.innerHTML=`重新提交 ${icon('arrow',16)}`;}
  finally{sending=false;document.querySelectorAll('[data-review]').forEach(el=>el.disabled=false);}
}
function done(){
  mode='done';clearTimeout(saveTimer);clearStash();
  root.innerHTML=header()+`<main class="done-layout"><div class="done-symbol">${icon('check',29)}</div><p class="eyebrow">ASSESSMENT RECEIVED</p><h1>感谢您的认真作答</h1><p>${esc(attempt.name)}，您的测评已成功提交。<br>HR 将结合测评与面谈情况综合评估，<br>期待进一步了解您。</p><div class="done-detail"><span>完成题目 <strong>${attempt.question_count} 题</strong></span><span>作答用时 <strong class="num">${formatTime(attempt.elapsed_seconds)}</strong></span><span>答卷编号 <strong>${esc(attempt.id.slice(0,8))}</strong></span></div><p class="done-caption">您现在可以安全关闭本页面。</p><a class="btn btn-quiet" href="./index.html">返回测评首页</a></main>`+footer();
  window.scrollTo({top:0,behavior:'instant'});
}
function warning(){
  if(document.querySelector('.modal-overlay')||!['test','review'].includes(mode))return;
  const oldFocus=document.activeElement;const el=document.createElement('div');el.className='modal-overlay';el.innerHTML=`<section class="modal" role="dialog" aria-modal="true" aria-labelledby="warning-title"><div class="warning-icon">${icon('info',22)}</div><h2 id="warning-title">请尽量留在作答页面</h2><p>系统已记录 ${attempt.warning_count} 次离开页面。您的作答仍已保留，此记录供 HR 复核，不会自动提交或淘汰。</p><button class="btn btn-primary btn-block" id="dismiss-warning">继续作答</button></section>`;document.body.appendChild(el);
  const close=()=>{el.remove();oldFocus?.focus();};const button=el.querySelector('button');button.addEventListener('click',close);el.addEventListener('keydown',event=>{if(event.key==='Escape')close();if(event.key==='Tab'){event.preventDefault();button.focus();}});button.focus();
}
document.addEventListener('visibilitychange',()=>{
  if(!attempt||attempt.status!=='in_progress'||!['test','review'].includes(mode))return;
  if(document.hidden){attempt.warning_count=(attempt.warning_count||0)+1;pendingWarning=true;changed();save();}
  else if(pendingWarning){pendingWarning=false;if(attempt.warning_count>=config.warning_limit)warning();else toast(`已记录 ${attempt.warning_count} 次离开页面，作答已保留`);}
});
setInterval(()=>{if(attempt&&['test','review'].includes(mode)){const timer=document.querySelector('#timer');if(timer)timer.textContent=formatTime(elapsed());}},1000);
setInterval(()=>{if(attempt&&attempt.status==='in_progress'&&['test','review'].includes(mode)&&!document.hidden){attempt.elapsed_seconds=elapsed();stash();save();}},15000);
window.addEventListener('online',()=>{if(attempt?.status==='in_progress')save();});
window.addEventListener('hashchange',()=>{if((new URLSearchParams(location.hash.slice(1)).get('invite')||'')!==inviteToken)location.reload();});
function invitationLanding(message='请使用 HR 发给您的专属答题链接。每份链接仅供一位候选人提交一次，请勿转发。', received=false){
  config={company:'威尔阳 WEIERYANG'};mode=received?'done':'welcome';
  root.innerHTML=header()+`<main class="done-layout"><div class="done-symbol">${icon(received?'check':'lock',29)}</div><p class="eyebrow">${received?'ASSESSMENT RECEIVED':'YOUR INVITATION'}</p><h1>${received?'答卷已成功提交':'欢迎参加威尔阳面试'}</h1><p>${esc(message)}</p>${received?'<p class="done-caption">本链接已使用，您可以安全关闭页面。</p>':'<p class="done-caption">候选人无需注册或登录账号。</p>'}</main>`+footer();
}
async function boot(){
  if(!inviteToken){invitationLanding();return;}
  try{
    config=await api('/api/config');
    if(config.invitation_status==='submitted'){clearStash();invitationLanding('HR 已收到这份答卷，将结合测评与面谈情况综合评估。为保护个人信息，本链接不再展示姓名或答案。',true);return;}
    const cached=readStash();
    if(cached?.attempt?.id&&cached.token){
      try{const data=await api(`/api/attempts/${encodeURIComponent(cached.attempt.id)}`,{headers:{Authorization:`Bearer ${cached.token}`}});attempt=data.attempt;token=cached.token;current=cached.current||0;
        if(attempt.status==='in_progress'){if(cached.attempt.answers)attempt.answers={...attempt.answers,...cached.attempt.answers};attempt.warning_count=Math.max(attempt.warning_count||0,cached.attempt.warning_count||0);attempt.elapsed_seconds=Math.max(attempt.elapsed_seconds||0,cached.attempt.elapsed_seconds||0);version=1;savedVersion=0;beginClock();showQuestion(current);save();return;}
        if(attempt.status==='submitted'){done();return;}
      }catch(error){if([401,403,404].includes(error.status)){clearStash();}else{throw error;}}
    }
    welcome();
  }catch(error){root.innerHTML=`<main class="loading-state"><h1>暂时无法加载测评</h1><p>${esc(error.message)}</p><p>请检查网络，或联系 HR 确认邀请链接。</p><button class="btn btn-primary" id="retry-boot">重新连接</button><a class="btn btn-quiet" href="./index.html">返回首页</a></main>`;document.querySelector('#retry-boot').addEventListener('click',boot);}
}
boot();
