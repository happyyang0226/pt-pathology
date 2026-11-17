/* 물리치료사를 위한 병리학 — 문제풀이 학습 웹앱
   학습 원리: 즉시 피드백 + 정교한 해설(정답 근거 · 보기 분석 · 핵심 정리 · 기억법 · 임상 연결)
            + 확신도 · 오류 유형 기록 + 개념 단위 간격 복습(다른 변형 문항으로 재출제) */
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NUM = ['①', '②', '③', '④', '⑤'];
  const DAY = 864e5;
  const CONF = { sure: '확실', unsure: '애매', guess: '찍음', exam: '시험' };
  const ERR = { unknown: '모르는 내용', confused: '헷갈림', misread: '잘못 읽음' };
  const ERR_TIP = { unknown: '핵심 정리를 먼저 읽고 문제를 다시 풀어 보세요.', confused: '비교표에서 두 개념의 차이 한 줄을 스스로 말해 보세요.', misread: '“옳지 않은 것” · “가장 적절한 것” 같은 끝말을 표시하며 읽어 보세요.' };
  const sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { storageKey: 'ptpa-prof-auth', persistSession: true, autoRefreshToken: true } });
  // 교수 통합 로그인: 학습 포털에서 넘어온 한 번 쓰는 로그인 표(#sso=…)
  const SSO = (location.hash.match(/^#sso=([A-Za-z0-9_-]+)/) || [])[1];
  const ssoReady = SSO ? (history.replaceState(null, '', location.pathname + location.search + '#/'), sb.auth.verifyOtp({ token_hash: SSO, type: 'magiclink' }).then(({ error }) => { if (error) console.warn('SSO', error.message); }).catch(() => { })) : Promise.resolve();
  const app = $('#app');

  // ── 데이터 ───────────────────────────────
  const CHS = () => PARTS.flatMap(p => p.chapters).filter(c => c.ready && PA.ch[c.no]).map(c => PA.ch[c.no]);
  const QMAP = {}, CMAP = {};
  Object.values(PA.ch).forEach(ch => { ch.questions.forEach(q => { q.ch = ch.no; QMAP[q.id] = q; }); ch.concepts.forEach(c => { c.ch = ch.no; CMAP[c.id] = c; }); });
  const chars = s => [...String(s).replace(/\s/g, '')].length;
  const hash = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const sortOpts = q => q.opts.slice().sort((a, b) => chars(a) - chars(b) || a.length - b.length || hash(a) - hash(b));
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ── 학생 · 기록 ───────────────────────────
  let STU = null; try { STU = JSON.parse(localStorage.getItem('ptpa_s') || 'null'); } catch (e) { }
  let PROF = null, ATT = [];
  const lsKey = () => 'ptpa_att_' + (STU ? STU.student_no : 'guest');
  const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
  function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : ''); clearTimeout(t._h); t._h = setTimeout(() => t.className = 'toast', 2600); }
  const errMsg = e => (e && (e.message || e.error_description)) || String(e);
  async function rpc(fn, args) { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; }
  const fromRow = r => ({ qid: r.qid, ch: r.ch, c: r.concept, chosen: r.chosen, ok: r.correct, conf: r.conf, err: r.err, mode: r.mode, ms: r.ms, t: r.created_at });
  const toRow = a => ({ qid: a.qid, ch: a.ch, concept: a.c, chosen: a.chosen, correct: a.ok, conf: a.conf, err: a.err, mode: a.mode, ms: a.ms, created_at: a.t });
  async function loadAtt() {
    if (!STU) { ATT = lsGet(lsKey(), []); return; }
    try {
      const pend = lsGet('ptpa_pend_' + STU.student_no, []);
      if (pend.length) { await rpc('pa_record', { p_token: STU.token, p_rows: pend.map(toRow) }); lsSet('ptpa_pend_' + STU.student_no, []); }
      const rows = await rpc('pa_my', { p_token: STU.token }); ATT = (rows || []).map(fromRow);
    } catch (e) { if (/만료/.test(errMsg(e))) { logoutStu(); toast('로그인이 만료되었습니다', true); } ATT = lsGet(lsKey(), []); }
  }
  async function record(list) {
    ATT.push(...list); lsSet(lsKey(), ATT.slice(-3000));
    if (!STU) return;
    try { await rpc('pa_record', { p_token: STU.token, p_rows: list.map(toRow) }); }
    catch (e) { const k = 'ptpa_pend_' + STU.student_no; lsSet(k, lsGet(k, []).concat(list)); }
  }
  function logoutStu() { STU = null; localStorage.removeItem('ptpa_s'); ATT = lsGet(lsKey(), []); renderNav(); }

  // ── 간격 복습: 개념 상태 ───────────────────
  /* level 0~3 · 오답 → 0, 1일 뒤 / 확실한 정답 → +1 (3일 → 7일 → 완료) / 애매 · 찍은 정답 → 그대로, 1일 뒤 */
  const INT = [1, 3, 7];
  function conceptStates() {
    const st = {};
    ATT.slice().sort((a, b) => new Date(a.t) - new Date(b.t)).forEach(a => {
      const s = st[a.c] || (st[a.c] = { level: 0, due: 0, n: 0, ok: 0, last: 0, lastQ: null });
      const t = new Date(a.t).getTime(); s.n++; if (a.ok) s.ok++; s.last = t; s.lastQ = a.qid;
      if (!a.ok) { s.level = 0; s.due = t + DAY; }
      else if (a.conf === 'sure' || a.conf === 'exam') { s.level = Math.min(3, s.level + 1); s.due = s.level >= 3 ? Infinity : t + INT[s.level] * DAY; }
      else { s.due = t + DAY; }
    });
    return st;
  }
  const statusOf = s => !s ? { k: 'new', t: '미학습' } : s.level >= 3 ? { k: 'done', t: '완료' } : s.due <= Date.now() ? { k: 'due', t: '복습할 때' } : { k: 'ing', t: `학습 중 · ${Math.max(1, Math.ceil((s.due - Date.now()) / DAY))}일 뒤` };
  const dueConcepts = (chNo) => { const st = conceptStates(); return Object.values(CMAP).filter(c => (!chNo || c.ch === chNo) && st[c.id] && st[c.id].level < 3 && st[c.id].due <= Date.now()); };
  const latest = () => { const m = {}; ATT.forEach(a => { if (!m[a.qid] || new Date(a.t) >= new Date(m[a.qid].t)) m[a.qid] = a; }); return m; };
  function pickVariant(cid, avoid) {
    const qs = Object.values(QMAP).filter(q => q.c === cid), seen = {};
    ATT.forEach(a => { if (a.c === cid) seen[a.qid] = Math.max(seen[a.qid] || 0, new Date(a.t).getTime()); });
    const fresh = qs.filter(q => !seen[q.id]); if (fresh.length) return shuffle(fresh)[0];
    const pool = qs.filter(q => q.id !== avoid); return (pool.length ? pool : qs).sort((a, b) => seen[a.id] - seen[b.id])[0];
  }

  // ── 상단 바 · 로그인 ───────────────────────
  function renderNav() {
    const due = dueConcepts().length;
    $('#nav').innerHTML = `<a href="#/" class="brand"><span class="logo">병</span><span>PT 병리학</span></a>
      <nav class="links"><a href="#/">홈</a><a href="#/review">복습${due ? ` <span class="badge">${due}</span>` : ''}</a><a href="#/wrong">오답 노트</a><a href="#/me">내 학습</a><a href="#/prof">교수</a></nav>
      <div class="acct">${PROF ? '<span class="who prof">교수</span>' : STU ? `<span class="who">${esc(STU.name)}</span>` : '<span class="who muted small">게스트</span>'}
      ${STU || PROF ? '<button class="btn ghost sm" id="logout">로그아웃</button>' : '<button class="btn sm" id="loginBtn">학생 로그인</button>'}</div>`;
    $('#logout') && ($('#logout').onclick = async () => { if (PROF) { await sb.auth.signOut(); PROF = null; } logoutStu(); route(); });
    $('#loginBtn') && ($('#loginBtn').onclick = () => openLogin());
    const cur = location.hash.split('/')[1] || '';
    $$('#nav .links a').forEach(a => a.classList.toggle('on', (a.getAttribute('href').split('/')[1] || '') === cur));
  }
  function modal(html, wide) { const m = $('#modal'); m.innerHTML = `<div class="mbox ${wide ? 'wide' : ''}"><button class="mx" aria-label="닫기">×</button>${html}</div>`; m.classList.add('show'); m.onclick = e => { if (e.target === m || e.target.classList.contains('mx')) closeModal(); }; return m; }
  function closeModal() { $('#modal').classList.remove('show'); $('#modal').innerHTML = ''; }
  function openLogin(after) {
    const guestN = lsGet('ptpa_att_guest', []).length;
    const m = modal(`<h3>학생 로그인</h3><p class="muted small">처음이면 입력한 PIN으로 등록됩니다. 로그인하면 기록이 서버에 저장되어 어느 기기에서나 이어서 풀 수 있고, 교수님이 학습 현황을 볼 수 있습니다.${guestN ? ` <b>게스트로 푼 ${guestN}개 기록</b>도 내 계정으로 옮겨집니다.` : ''}</p>
      <form id="lf" class="form"><label>학번<input name="no" inputmode="numeric" required></label><label>이름<input name="name" required></label>
      <label>PIN (숫자 4~8자리)<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" required></label><button class="btn block">로그인</button></form>`);
    $('#lf', m).onsubmit = async e => {
      e.preventDefault(); const f = new FormData(e.target);
      try {
        const r = await rpc('pa_login', { p_no: f.get('no'), p_name: f.get('name'), p_pin: f.get('pin') });
        STU = r; localStorage.setItem('ptpa_s', JSON.stringify(r));
        const g = lsGet('ptpa_att_guest', []); if (g.length) { try { await rpc('pa_record', { p_token: r.token, p_rows: g.map(toRow) }); lsSet('ptpa_att_guest', []); } catch (er) { } }
        await loadAtt(); closeModal(); renderNav(); toast(r.name + '님 환영합니다'); after ? after() : route();
      } catch (err) { toast(errMsg(err), true); }
    };
  }

  // ── 홈 ───────────────────────────────────
  function chStats(ch) {
    const st = conceptStates(), lt = latest(), qs = ch.questions, done = qs.filter(q => lt[q.id]);
    return { total: qs.length, solved: done.length, ok: done.filter(q => lt[q.id].ok).length, cTotal: ch.concepts.length, cDone: ch.concepts.filter(c => st[c.id] && st[c.id].level >= 3).length, due: dueConcepts(ch.no).length };
  }
  function home() {
    const due = dueConcepts();
    app.innerHTML = `<section class="hero"><h1>물리치료사를 위한 병리학</h1><p>문제를 풀고, 해설로 배우고, 잊을 때쯤 다시 만나는 병리학</p>
      <ol class="how"><li><b>풀기</b> 답을 고르고 확신도를 표시</li><li><b>배우기</b> 정답 근거 · 보기 분석 · 핵심 정리 · 임상 연결</li><li><b>다시 만나기</b> 틀리거나 애매한 개념은 1 · 3 · 7일 뒤 다른 문제로</li></ol></section>
      ${due.length ? `<section class="card duecard"><div><h3>오늘 복습할 개념 ${due.length}개</h3><p class="muted small">${due.slice(0, 4).map(c => esc(c.t)).join(' · ')}${due.length > 4 ? ' …' : ''}</p></div><a class="btn" href="#/review">복습 시작 →</a></section>` : ''}
      ${!STU ? '<p class="muted small">게스트로도 풀 수 있지만 기록이 이 기기에만 남습니다. 수업 학생은 로그인하세요.</p>' : ''}
      ${PARTS.map(p => `<h2 class="ph">${esc(p.t)}</h2><div class="chlist">${p.chapters.map(c => {
        const ch = c.ready && PA.ch[c.no]; if (!ch) return `<div class="chc off"><span class="n">Chapter ${String(c.no).padStart(2, '0')}</span><b>${esc(c.t)}</b><span class="muted small">준비 중</span></div>`;
        const s = chStats(ch), pct = Math.round(100 * s.cDone / s.cTotal);
        return `<a class="chc" href="#/ch/${c.no}"><span class="n">Chapter ${String(c.no).padStart(2, '0')}</span><b>${esc(ch.title)}</b>
          <div class="bar"><i style="width:${pct}%"></i></div><span class="small muted">개념 완료 ${s.cDone}/${s.cTotal} · 푼 문항 ${s.solved}/${s.total}${s.solved ? ` · 정답률 ${Math.round(100 * s.ok / s.solved)}%` : ''}${s.due ? ` · <b class="warn">복습 ${s.due}</b>` : ''}</span></a>`;
      }).join('')}</div>`).join('')}`;
  }

  // ── 장 화면 ───────────────────────────────
  function chapter(no) {
    const ch = PA.ch[no]; if (!ch) return notFound();
    const st = conceptStates(), s = chStats(ch), lt = latest();
    const weak = ch.questions.filter(q => lt[q.id] && !(lt[q.id].ok && lt[q.id].conf !== 'unsure' && lt[q.id].conf !== 'guess')).length;
    const unseen = ch.questions.filter(q => !lt[q.id]).length;
    app.innerHTML = `<header class="whead"><div><span class="pill">Chapter ${String(no).padStart(2, '0')}</span><h1>${esc(ch.title)}</h1>
      <p class="muted small">문항 ${s.total}개 · 개념 ${s.cTotal}개 · 개념 완료 ${s.cDone} · 정답률 ${s.solved ? Math.round(100 * s.ok / s.solved) + '%' : '—'}</p></div></header>
      <section class="card actions"><a class="btn" href="#/study/${no}/all">처음부터 풀기 (${s.total})</a>
        ${unseen && unseen < s.total ? `<a class="btn ghost" href="#/study/${no}/new">안 푼 문제 (${unseen})</a>` : ''}
        ${weak ? `<a class="btn ghost" href="#/study/${no}/weak">틀린 · 애매한 문제 (${weak})</a>` : ''}
        ${s.due ? `<a class="btn warnbtn" href="#/review/${no}">복습할 개념 (${s.due})</a>` : ''}
        <a class="btn ghost" href="#/exam/${no}">모의고사 ${Math.min(20, s.total)}문항</a><a class="btn ghost" href="#/notes/${no}">핵심 정리 노트</a></section>
      <section class="card"><h3>학습 목표</h3><ol class="objs">${ch.objectives.map((o, i) => {
        const cs = ch.concepts.filter(c => c.obj === i + 1), lv = cs.reduce((t, c) => t + (st[c.id] ? st[c.id].level : 0), 0), pct = cs.length ? Math.round(100 * lv / (cs.length * 3)) : 0, nq = ch.questions.filter(q => q.obj === i + 1).length;
        return `<li><div class="ot"><span class="ob">목표 ${i + 1}</span> ${esc(o)}</div><div class="orow"><div class="bar"><i style="width:${pct}%"></i></div><a class="btn ghost sm" href="#/study/${no}/obj${i + 1}">${nq}문항 풀기</a></div>
          <div class="chips">${cs.map(c => { const S = statusOf(st[c.id]); return `<a class="chip ${S.k}" href="#/study/${no}/c-${c.id}" title="${esc(S.t)}">${esc(c.t)} <small>${S.t}</small></a>`; }).join('')}</div></li>`;
      }).join('')}</ol></section>
      <p class="muted small">목차: ${ch.sections.map(esc).join(' · ')}</p>`;
  }

  // ── 해설 (학습의 핵심) ─────────────────────
  function fbHTML(q, chosen, conf, noKey) {
    const c = CMAP[q.c] || {}, so = sortOpts(q), ok = chosen === q.a;
    const vd = ok ? (conf === 'sure' || conf === 'exam' ? '<b>✔ 정답</b>' : `<b>✔ 정답</b> — 하지만 “${CONF[conf]}”였어요. 보기 분석을 꼭 읽어 보세요. 내일 비슷한 문제가 다시 나옵니다.`)
      : `<b>✖ 오답</b> — 정답은 ${NUM[so.indexOf(q.a)]} ${esc(q.a)}${conf === 'sure' ? ' · <span class="warn">확실하다고 생각했던 문제 — 가장 중요한 복습 대상입니다</span>' : ''}`;
    return `<div class="verdict ${ok ? 'ok' : 'bad'}">${vd}</div>
      <div class="fbsec why"><h4>정답 근거</h4><p><b>${esc(q.a)}</b> — ${esc(q.ox[q.a])}</p><p>${esc(q.why)}</p></div>
      <div class="fbsec"><h4>보기 분석 <span class="muted small">— 오답 보기도 하나의 개념입니다</span></h4><ul class="oxl">${so.map((o, j) => `<li class="${o === q.a ? 'ans' : ''} ${o === chosen && !ok ? 'mine' : ''}"><span class="on">${NUM[j]}</span><div><b>${esc(o)}</b>${o === q.a ? ' <span class="tg ok">정답</span>' : ''}${o === chosen && !ok ? ' <span class="tg bad">내 답</span>' : ''}<p>${esc(q.ox[o])}</p></div></li>`).join('')}</ul></div>
      ${noKey ? '' : `<details class="fbsec key" open><summary>핵심 정리 · ${esc(c.t || '')}</summary><div class="ksum">${c.sum || ''}</div></details>`}
      <div class="fbgrid"><div class="fbsec mem"><h4>기억법</h4><p>${esc(c.mem || '')}</p></div><div class="fbsec clin"><h4>임상 연결</h4><p>${esc(q.clinic || c.clinic || '')}</p></div></div>`;
  }

  // ── 학습 모드 (한 문제씩 즉시 해설) ─────────
  let S = null;
  function buildSet(no, sel) {
    const ch = PA.ch[no], lt = latest(); let qs = ch.questions;
    if (sel === 'new') qs = qs.filter(q => !lt[q.id]);
    else if (sel === 'weak') qs = qs.filter(q => lt[q.id] && !(lt[q.id].ok && lt[q.id].conf !== 'unsure' && lt[q.id].conf !== 'guess'));
    else if (sel && sel.startsWith('obj')) qs = qs.filter(q => q.obj === +sel.slice(3));
    else if (sel && sel.startsWith('c-')) qs = qs.filter(q => q.c === sel.slice(2));
    const byObj = {}; qs.forEach(q => (byObj[q.obj] = byObj[q.obj] || []).push(q));
    return Object.keys(byObj).sort((a, b) => a - b).flatMap(k => shuffle(byObj[k]));
  }
  const SEL_T = sel => !sel || sel === 'all' ? '처음부터 풀기' : sel === 'new' ? '안 푼 문제' : sel === 'weak' ? '틀린 · 애매한 문제' : sel.startsWith('obj') ? `학습 목표 ${sel.slice(3)}` : sel.startsWith('c-') ? `개념: ${(CMAP[sel.slice(2)] || {}).t || ''}` : '';
  function startStudy(qs, title, back) {
    if (!qs.length) { app.innerHTML = `<div class="card center"><p>풀 문제가 없습니다.</p><a class="btn" href="${back || '#/'}">돌아가기</a></div>`; return; }
    S = { qs, i: 0, res: [], title, back }; showQ();
  }
  function showQ() {
    const q = S.qs[S.i], c = CMAP[q.c], so = sortOpts(q), ch = PA.ch[q.ch];
    app.innerHTML = `<div class="shead"><a href="${S.back}" class="muted small">← 나가기</a><b>${esc(S.title)}</b><span class="muted small">${S.i + 1} / ${S.qs.length}</span></div>
      <div class="pbar"><i style="width:${100 * S.i / S.qs.length}%"></i></div>
      <section class="card qcard"><div class="qtop"><span class="ob">Ch${q.ch} · 목표 ${q.obj}</span><span class="qt">${esc(q.type)}</span><span class="ctag">${esc(c.t)}</span></div>
        <p class="qq">${esc(q.q)}</p><div class="opts">${so.map((o, j) => `<button class="opt" data-v="${esc(o)}"><span class="on">${NUM[j]}</span><span>${esc(o)}</span></button>`).join('')}</div>
        <div class="conf" hidden><p>얼마나 확신하나요? <span class="muted small">누르면 채점됩니다</span></p><div class="cbtns"><button data-c="sure">확실해요</button><button data-c="unsure">애매해요</button><button data-c="guess">찍었어요</button></div></div>
        <div id="fb"></div></section>`;
    const t0 = Date.now(); let pick = null;
    $$('.opt').forEach(b => b.onclick = () => { if (b.disabled) return; pick = b.dataset.v; $$('.opt').forEach(x => x.classList.toggle('sel', x === b)); $('.conf').hidden = false; });
    $$('.conf button').forEach(b => b.onclick = () => grade(q, pick, b.dataset.c, Date.now() - t0));
    window.scrollTo(0, 0);
  }
  function grade(q, chosen, conf, ms) {
    const ok = chosen === q.a;
    $$('.opt').forEach(b => { b.disabled = true; b.classList.toggle('ans', b.dataset.v === q.a); b.classList.toggle('mine', b.dataset.v === chosen && !ok); });
    $('.conf').hidden = true;
    const last = S.i === S.qs.length - 1, att = { qid: q.id, ch: q.ch, c: q.c, chosen, ok, conf, err: null, mode: 'study', ms, t: new Date().toISOString() };
    $('#fb').innerHTML = fbHTML(q, chosen, conf) + `<div class="next">${ok ? '' : `<div class="errq"><p><b>왜 틀렸나요?</b> <span class="muted small">골라야 다음으로 넘어갑니다</span></p><div class="cbtns">${Object.entries(ERR).map(([k, t]) => `<button data-e="${k}">${t}</button>`).join('')}</div><p class="small muted" id="etip"></p></div>`}
      <button class="btn lg" id="nx" ${ok ? '' : 'disabled'}>${last ? '결과 보기' : '다음 문제 →'}</button></div>`;
    $$('.errq button').forEach(b => b.onclick = () => { att.err = b.dataset.e; $$('.errq button').forEach(x => x.classList.toggle('sel', x === b)); $('#etip').textContent = ERR_TIP[att.err]; $('#nx').disabled = false; });
    $('#nx').onclick = async () => { S.res.push(att); await record([att]); renderNav(); if (last) summary(); else { S.i++; showQ(); } };
    $('#fb').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function summary(res = S.res, title = S.title, back = S.back) {
    const n = res.length, ok = res.filter(r => r.ok).length, sureWrong = res.filter(r => !r.ok && r.conf === 'sure'), lucky = res.filter(r => r.ok && (r.conf === 'unsure' || r.conf === 'guess'));
    const errs = Object.keys(ERR).map(k => [k, res.filter(r => r.err === k).length]).filter(x => x[1]);
    const weakC = [...new Set(res.filter(r => !r.ok || r.conf === 'unsure' || r.conf === 'guess').map(r => r.c))];
    app.innerHTML = `<div class="shead"><a href="${back}" class="muted small">← 돌아가기</a><b>${esc(title)} — 결과</b><span></span></div>
      <section class="card center"><div class="score">${ok} / ${n}</div><p class="muted">정답률 ${n ? Math.round(100 * ok / n) : 0}%</p>
        <div class="stats3"><div><b>${sureWrong.length}</b><small>확실했는데 틀림</small></div><div><b>${lucky.length}</b><small>맞혔지만 확신 없음</small></div><div><b>${weakC.length}</b><small>복습 예약 개념</small></div></div>
        ${errs.length ? `<p class="small">틀린 이유: ${errs.map(([k, v]) => `${ERR[k]} ${v}`).join(' · ')}</p><p class="small muted">${esc(ERR_TIP[errs.sort((a, b) => b[1] - a[1])[0][0]])}</p>` : ''}
        <div class="row wrap" style="justify-content:center;gap:8px">${weakC.length ? '<button class="btn" id="again">약한 개념 — 다른 문제로 다시</button>' : ''}<a class="btn ghost" href="${back}">돌아가기</a></div>
        <p class="muted small">틀리거나 애매한 개념은 1일 뒤 <a href="#/review">복습</a>에 다른 문항으로 다시 나옵니다.</p></section>
      ${deepCTA(res)}
      <h3 class="oh">문항별 해설 다시 보기</h3>
      ${res.map((r, i) => { const q = QMAP[r.qid]; return `<details class="card rv ${r.ok ? 'ok' : 'bad'}"><summary><span class="qn">${i + 1}</span> ${r.ok ? '✔' : '✖'} ${esc(q.q)} <span class="muted small">${CONF[r.conf] || ''}${r.err ? ' · ' + ERR[r.err] : ''}</span></summary>${fbHTML(q, r.chosen, r.conf)}</details>`; }).join('')}`;
    const ag = $('#again'); if (ag) ag.onclick = () => startStudy(weakC.map(cid => pickVariant(cid, (res.find(r => r.c === cid) || {}).qid)), '약한 개념 다시 풀기', back);
    bindDeepCTA(res, back);
    window.scrollTo(0, 0);
  }


  // ── 심화학습 (문제를 다 푼 뒤) ─────────────
  /* 개념마다 ① 다시 정리하기 → ② 내가 놓친 부분(내 답 vs 정답) → ③ 스스로 설명하기(모범 설명과 비교)
     → ④ 확인 문제(같은 개념의 다른 문항) → 다음 개념. 마지막에 심화학습 결과. */
  const explKey = () => 'ptpa_expl_' + (STU ? STU.student_no : 'guest');
  function myExpl(cid) {
    const l = (lsGet(explKey(), {})[cid] || []).slice(-2);
    return l.length ? `<div class="fbsec myx"><h4>내가 쓴 설명</h4>${l.map(x => `<p>“${esc(x.text)}” <span class="muted small">${new Date(x.t).toLocaleDateString('ko-KR')}</span></p>`).join('')}</div>` : '';
  }
  function weakOf(res) { return [...new Set(res.filter(r => !r.ok || r.conf === 'unsure' || r.conf === 'guess').map(r => r.c))]; }
  function deepCTA(res) {
    const weak = weakOf(res), all = [...new Set(res.map(r => r.c))];
    if (!all.length) return '';
    return weak.length
      ? `<section class="card deepcta"><div><h3>심화학습 — 약한 개념 ${weak.length}개</h3><p class="small">개념마다 <b>① 다시 정리 → ② 내가 놓친 부분 → ③ 스스로 설명하기 → ④ 다른 문제로 확인</b> 순서로 진행합니다. 한 개념에 3~5분이면 됩니다.</p>
          <div class="chips">${weak.map(cid => `<span class="chip due">${esc(CMAP[cid].t)}</span>`).join('')}</div></div><button class="btn lg" id="deepGo">심화학습 시작 →</button></section>`
      : `<section class="card deepcta ok"><div><h3>모두 확실하게 맞혔습니다 👏</h3><p class="small">이번에 푼 개념 ${all.length}개를 <b>스스로 설명하기와 다른 문제</b>로 한 번 더 다져 보세요.</p></div><button class="btn ghost lg" id="deepGo">도전 심화학습 →</button></section>`;
  }
  function bindDeepCTA(res, back) {
    const b = $('#deepGo'); if (!b) return;
    const weak = weakOf(res); b.onclick = () => deepStudy(weak.length ? weak : [...new Set(res.map(r => r.c))], res, back, weak.length ? '심화학습' : '도전 심화학습');
  }
  let D = null;
  function deepStudy(cids, res, back, title) {
    D = { cids, res, back, title, i: 0, out: [], used: new Set(res.map(r => r.qid)) }; showDeep();
  }
  function variantFor(cid) {
    const qs = Object.values(QMAP).filter(q => q.c === cid), fresh = qs.filter(q => !D.used.has(q.id));
    const q = fresh.length ? shuffle(fresh)[0] : pickVariant(cid, (D.res.find(r => r.c === cid) || {}).qid);
    D.used.add(q.id); return q;
  }
  function showDeep() {
    const cid = D.cids[D.i], c = CMAP[cid], mine = D.res.filter(r => r.c === cid);
    const neg = q => /않은|아닌|거리가 먼/.test(q.q), cq = Object.values(QMAP).filter(q => q.c === cid), mq = mine.map(r => QMAP[r.qid]);
    const base = mq.find(q => !neg(q) && mine.some(r => r.qid === q.id && !r.ok)) || mq.find(q => !neg(q)) || cq.find(q => !neg(q)) || mq[0] || cq[0];
    const steps = ['다시 정리', '놓친 부분', '스스로 설명', '확인 문제'];
    app.innerHTML = `<div class="shead"><a href="${D.back}" class="muted small">← 나가기</a><b>${esc(D.title)} · ${D.i + 1} / ${D.cids.length}</b><span class="muted small">${esc(c.t)}</span></div>
      <div class="pbar"><i style="width:${100 * D.i / D.cids.length}%"></i></div>
      <ol class="dsteps">${steps.map((t, k) => `<li data-k="${k}" class="${k === 0 ? 'on' : ''}"><span>${k + 1}</span>${t}</li>`).join('')}</ol>
      <section class="card dstep" id="d1"><h3><span class="sn">1</span> 다시 정리하기 — ${esc(c.t)}</h3><div class="ksum">${c.sum}</div>
        <div class="fbgrid"><div class="fbsec mem"><h4>기억법</h4><p>${esc(c.mem)}</p></div><div class="fbsec clin"><h4>임상에서는</h4><p>${esc(c.clinic)}</p></div></div>
        ${myExpl(cid)}<div class="row end"><button class="btn" data-go="2">다 읽었어요 →</button></div></section>
      <section class="card dstep" id="d2" hidden><h3><span class="sn">2</span> 내가 놓친 부분</h3>
        ${mine.length ? mine.map(r => { const q = QMAP[r.qid]; return `<div class="miss"><p class="qq">${esc(q.q)}</p>
          ${r.ok ? `<p class="small"><span class="tg ok">정답</span> 맞혔지만 <b>${CONF[r.conf] || ''}</b>였습니다. 왜 맞는지 확인하세요.</p>`
                 : `<div class="vs"><div class="mineb"><small>내가 고른 답</small><b>${esc(r.chosen || '무응답')}</b><p>${esc(r.chosen ? q.ox[r.chosen] : '답을 고르지 않았습니다.')}</p></div><div class="ansb"><small>정답</small><b>${esc(q.a)}</b><p>${esc(q.ox[q.a])}</p></div></div>`}
          <p class="small"><b>핵심:</b> ${esc(q.why)}</p></div>`; }).join('') : '<p class="muted">이번 풀이 기록이 없는 개념입니다. 1단계 정리를 바탕으로 다음 단계로 가세요.</p>'}
        <div class="fbsec"><h4>헷갈리기 쉬운 보기 한눈에</h4><ul class="oxl">${base.opts.filter(o => o !== base.a).map(o => `<li><div><b>${esc(o)}</b><p>${esc(base.ox[o])}</p></div></li>`).join('')}</ul></div>
        <div class="row end"><button class="btn" data-go="3">이해했어요 →</button></div></section>
      <section class="card dstep" id="d3" hidden><h3><span class="sn">3</span> 스스로 설명하기</h3>
        <p>보지 않고 <b>친구에게 설명하듯</b> 한두 문장으로 써 보세요. 쓰는 과정에서 기억이 단단해집니다.</p>
        <p class="qq">“${esc(base.q)}”의 답이 <b>${esc(base.a)}</b>인 이유는?</p>
        <textarea id="ex" rows="3" placeholder="예) ○○ 때문에 □□이 생기므로 …"></textarea>
        <div class="row end"><span class="small muted" id="exn">10자 이상 써야 비교할 수 있어요</span><button class="btn" id="exBtn" disabled>모범 설명과 비교하기</button></div>
        <div id="exCmp" hidden><div class="vs"><div class="mineb"><small>내 설명</small><p id="exMine"></p></div><div class="ansb"><small>모범 설명</small><p>${esc(base.ox[base.a])} ${esc(base.why)}</p></div></div>
          <p class="small">내 설명에 <b>핵심 단어</b>가 들어 있나요?</p><div class="cbtns" id="exSelf"><button data-v="2">거의 같게 썼다</button><button data-v="1">일부 빠졌다</button><button data-v="0">다르게 썼다</button></div><p class="small muted" id="exTip"></p></div></section>
      <section class="card dstep" id="d4" hidden><h3><span class="sn">4</span> 확인 문제 <span class="muted small">— 같은 개념, 다른 문제</span></h3><div id="vq"></div></section>`;
    const show = k => { $(`#d${k}`).hidden = false; $$('.dsteps li').forEach(li => li.classList.toggle('on', +li.dataset.k < k)); $(`#d${k}`).scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    $$('[data-go]').forEach(b => b.onclick = () => { b.closest('.row').remove(); show(+b.dataset.go); });
    const ex = $('#ex'); ex.oninput = () => { const n = ex.value.trim().length; $('#exBtn').disabled = n < 10; $('#exn').textContent = n < 10 ? `10자 이상 써야 비교할 수 있어요 (${n})` : '좋아요'; };
    $('#exBtn').onclick = () => {
      const text = ex.value.trim(), all = lsGet(explKey(), {}); (all[cid] = all[cid] || []).push({ text, qid: base.id, t: new Date().toISOString() }); lsSet(explKey(), all);
      $('#exMine').textContent = text; ex.disabled = true; $('#exBtn').closest('.row').remove(); $('#exCmp').hidden = false;
    };
    $$('#exSelf button').forEach(b => b.onclick = () => {
      $$('#exSelf button').forEach(x => x.classList.toggle('sel', x === b)); const v = +b.dataset.v;
      $('#exTip').textContent = v === 2 ? '훌륭합니다. 이제 다른 문제로 확인해 봅시다.' : v === 1 ? '빠진 단어를 모범 설명에서 찾아 한 번 소리 내어 말해 보세요.' : '1단계 표를 다시 보고, 모범 설명을 그대로 한 번 따라 써 보세요.';
      if ($('#d4').hidden) { show(4); deepQuiz(cid); }
    });
    window.scrollTo(0, 0);
  }
  function deepQuiz(cid) {
    const q = variantFor(cid), so = sortOpts(q), box = $('#vq'), last = D.i === D.cids.length - 1;
    box.innerHTML = `<div class="qtop"><span class="qt">${esc(q.type)}</span></div><p class="qq">${esc(q.q)}</p><div class="opts">${so.map((o, j) => `<button class="opt" data-v="${esc(o)}"><span class="on">${NUM[j]}</span><span>${esc(o)}</span></button>`).join('')}</div>
      <div class="conf" hidden><p>얼마나 확신하나요? <span class="muted small">누르면 채점됩니다</span></p><div class="cbtns"><button data-c="sure">확실해요</button><button data-c="unsure">애매해요</button><button data-c="guess">찍었어요</button></div></div><div class="dfb"></div>`;
    let pick = null; const t0 = Date.now();
    $$('.opt', box).forEach(b => b.onclick = () => { if (b.disabled) return; pick = b.dataset.v; $$('.opt', box).forEach(x => x.classList.toggle('sel', x === b)); $('.conf', box).hidden = false; });
    $$('.conf button', box).forEach(b => b.onclick = () => {
      const conf = b.dataset.c, ok = pick === q.a, att = { qid: q.id, ch: q.ch, c: q.c, chosen: pick, ok, conf, err: null, mode: 'study', ms: Date.now() - t0, t: new Date().toISOString() };
      $$('.opt', box).forEach(x => { x.disabled = true; x.classList.toggle('ans', x.dataset.v === q.a); x.classList.toggle('mine', x.dataset.v === pick && !ok); });
      $('.conf', box).hidden = true;
      $('.dfb', box).innerHTML = fbHTML(q, pick, conf, true) + `<div class="next">${ok ? '' : `<div class="errq"><p><b>왜 틀렸나요?</b></p><div class="cbtns">${Object.entries(ERR).map(([k, t]) => `<button data-e="${k}">${t}</button>`).join('')}</div></div>`}<button class="btn lg" id="dnx" ${ok ? '' : 'disabled'}>${last ? '심화학습 결과 보기' : '다음 개념 →'}</button></div>`;
      $$('.errq button', box).forEach(e => e.onclick = () => { att.err = e.dataset.e; $$('.errq button', box).forEach(x => x.classList.toggle('sel', x === e)); $('#dnx').disabled = false; });
      $('#dnx').onclick = async () => { D.out.push(att); await record([att]); renderNav(); if (last) deepDone(); else { D.i++; showDeep(); } };
      $('.dfb', box).scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  function deepDone() {
    const okN = D.out.filter(a => a.ok && a.conf === 'sure').length, still = D.out.filter(a => !(a.ok && a.conf === 'sure'));
    app.innerHTML = `<div class="shead"><a href="${D.back}" class="muted small">← 돌아가기</a><b>${esc(D.title)} — 결과</b><span></span></div>
      <section class="card center"><div class="score">${okN} / ${D.out.length}</div><p class="muted">확인 문제를 확실하게 맞힌 개념</p>
        <table class="tbl" style="max-width:560px;margin:10px auto;text-align:left"><tr><th>개념</th><th>확인 문제</th><th>다음 복습</th></tr>
        ${D.out.map(a => { const s = conceptStates()[a.c]; return `<tr><td>${esc(CMAP[a.c].t)}</td><td>${a.ok ? '✔' : '✖'} ${CONF[a.conf]}</td><td class="small">${statusOf(s).t}</td></tr>`; }).join('')}</table>
        ${still.length ? `<p class="small">아직 흔들리는 개념 ${still.length}개는 내일 <a href="#/review">복습</a>에 다시 나옵니다.</p>` : '<p class="small">모두 확실히 맞혔습니다. 3일 뒤 복습에서 한 번 더 확인합니다.</p>'}
        <div class="row wrap" style="justify-content:center;gap:8px">${still.length ? '<button class="btn" id="dAgain">흔들리는 개념만 한 번 더</button>' : ''}<a class="btn ghost" href="${D.back}">돌아가기</a></div></section>`;
    const a = $('#dAgain'); if (a) a.onclick = () => deepStudy([...new Set(still.map(x => x.c))], still, D.back, '심화학습 (2회차)');
    window.scrollTo(0, 0);
  }

  // ── 간격 복습 ────────────────────────────
  function review(chNo) {
    const due = dueConcepts(chNo ? +chNo : null), st = conceptStates();
    const upcoming = Object.values(CMAP).filter(c => st[c.id] && st[c.id].level < 3 && st[c.id].due > Date.now()).sort((a, b) => st[a.id].due - st[b.id].due);
    if (!due.length) {
      app.innerHTML = `<h1 class="ptitle2">복습</h1><section class="card center"><p class="big">지금 복습할 개념이 없습니다 👏</p><p class="muted">틀리거나 확신 없이 맞힌 개념은 1일 뒤, 확실히 맞히면 3일 → 7일 뒤 다른 문제로 다시 나옵니다. 세 번 연속 확실히 맞히면 완료됩니다.</p><a class="btn" href="#/">문제 풀러 가기</a></section>
        ${upcoming.length ? `<section class="card"><h3>다가오는 복습</h3><ul class="small">${upcoming.slice(0, 12).map(c => `<li>${esc(c.t)} — ${statusOf(st[c.id]).t}</li>`).join('')}</ul></section>` : ''}`;
      return;
    }
    startStudy(shuffle(due).map(c => pickVariant(c.id, st[c.id].lastQ)), `오늘의 복습 · ${due.length}개념`, '#/');
  }

  // ── 모의고사 (끝에 채점) ───────────────────
  function exam(no) {
    const ch = PA.ch[no]; if (!ch) return notFound();
    const byC = {}; shuffle(ch.questions).forEach(q => (byC[q.c] = byC[q.c] || []).push(q));
    const pick = []; while (pick.length < Math.min(20, ch.questions.length)) { let added = false; Object.keys(byC).forEach(k => { if (byC[k].length && pick.length < 20) { pick.push(byC[k].shift()); added = true; } }); if (!added) break; }
    const qs = shuffle(pick), t0 = Date.now();
    app.innerHTML = `<div class="shead"><a href="#/ch/${no}" class="muted small">← 나가기</a><b>Ch${no} 모의고사</b><span class="muted small" id="cnt">0 / ${qs.length}</span></div>
      <section class="card"><p class="small muted">실제 시험처럼 모두 푼 뒤 한꺼번에 채점합니다. 채점 후 문항마다 같은 해설을 볼 수 있습니다.</p></section>
      <form id="ef">${qs.map((q, i) => `<section class="card qcard" data-id="${q.id}"><div class="qtop"><span class="qn">${i + 1}</span><span class="qt">${esc(q.type)}</span></div><p class="qq">${esc(q.q)}</p>
        <div class="opts">${sortOpts(q).map((o, j) => `<label class="opt"><input type="radio" name="${q.id}" value="${esc(o)}"><span class="on">${NUM[j]}</span><span>${esc(o)}</span></label>`).join('')}</div></section>`).join('')}
      <div class="row end"><button class="btn lg">제출하고 채점</button></div></form>`;
    const f = $('#ef'); f.onchange = () => $('#cnt').textContent = `${qs.filter(q => f.querySelector(`input[name="${q.id}"]:checked`)).length} / ${qs.length}`;
    f.onsubmit = async e => {
      e.preventDefault(); const miss = qs.filter(q => !f.querySelector(`input[name="${q.id}"]:checked`)).length;
      if (miss && !confirm(`${miss}문항에 답하지 않았습니다. 채점할까요?`)) return;
      const now = new Date().toISOString(), ms = Math.round((Date.now() - t0) / qs.length);
      const res = qs.map(q => { const v = f.querySelector(`input[name="${q.id}"]:checked`); const chosen = v ? v.value : null; return { qid: q.id, ch: q.ch, c: q.c, chosen, ok: chosen === q.a, conf: 'exam', err: null, mode: 'exam', ms, t: now }; });
      await record(res); renderNav(); summary(res, `Ch${no} 모의고사`, `#/ch/${no}`);
    };
  }

  // ── 핵심 정리 노트 ─────────────────────────
  function notes(no) {
    const ch = PA.ch[no]; if (!ch) return notFound();
    app.innerHTML = `<div class="shead"><a href="#/ch/${no}" class="muted small">← Chapter ${no}</a><b>핵심 정리 노트</b><span></span></div>
      <p class="muted">문제의 해설에 나오는 “핵심 정리”를 개념별로 모았습니다. 읽은 뒤 바로 그 개념 문제를 풀어 보세요.</p>
      ${ch.objectives.map((o, i) => `<h3 class="oh"><span class="ob">목표 ${i + 1}</span> ${esc(o)}</h3>${ch.concepts.filter(c => c.obj === i + 1).map(c => `<section class="card note"><h3>${esc(c.t)}</h3><div class="ksum">${c.sum}</div>
        <div class="fbgrid"><div class="fbsec mem"><h4>기억법</h4><p>${esc(c.mem)}</p></div><div class="fbsec clin"><h4>임상 연결</h4><p>${esc(c.clinic)}</p></div></div>
        ${myExpl(c.id)}
        <a class="btn ghost sm" href="#/study/${no}/c-${c.id}">이 개념 문제 풀기 (${ch.questions.filter(q => q.c === c.id).length})</a></section>`).join('')}`).join('')}`;
  }

  // ── 오답 노트 ─────────────────────────────
  function wrong() {
    const lt = latest(), list = Object.values(lt).filter(a => QMAP[a.qid] && (!a.ok || a.conf === 'unsure' || a.conf === 'guess')).sort((a, b) => QMAP[a.qid].id.localeCompare(QMAP[b.qid].id, 'en', { numeric: true }));
    app.innerHTML = `<h1 class="ptitle2">오답 노트</h1><p class="muted">가장 최근에 <b>틀렸거나 확신 없이 맞힌</b> 문제입니다. 해설을 펼쳐 읽고, 다른 문제로 다시 확인하세요.</p>
      ${list.length ? `<div class="row wrap" style="gap:8px;margin-bottom:12px"><button class="btn" id="deepW">심화학습 (${new Set(list.map(a => a.c)).size}개념)</button><button class="btn ghost" id="redo">같은 개념 다른 문제로 다시 (${new Set(list.map(a => a.c)).size}개념)</button><button class="btn ghost" id="redoSame">이 문제 그대로 다시 (${list.length})</button></div>` : '<section class="card center"><p class="muted">아직 오답이 없습니다.</p></section>'}
      ${list.map(a => { const q = QMAP[a.qid]; return `<details class="card rv ${a.ok ? 'ok' : 'bad'}"><summary>${a.ok ? '△' : '✖'} <span class="muted small">Ch${q.ch} · ${esc(CMAP[q.c].t)}</span><br>${esc(q.q)} <span class="muted small">— 내 답: ${esc(a.chosen || '무응답')} · ${CONF[a.conf] || ''}${a.err ? ' · ' + ERR[a.err] : ''}</span></summary>${fbHTML(q, a.chosen, a.conf)}</details>`; }).join('')}`;
    const r = $('#redo'); if (r) r.onclick = () => startStudy([...new Set(list.map(a => a.c))].map(cid => pickVariant(cid, (list.find(a => a.c === cid) || {}).qid)), '오답 노트 — 다른 문제로', '#/wrong');
    const dw = $('#deepW'); if (dw) dw.onclick = () => deepStudy([...new Set(list.map(a => a.c))], list, '#/wrong', '오답 노트 심화학습');
    const r2 = $('#redoSame'); if (r2) r2.onclick = () => startStudy(list.map(a => QMAP[a.qid]), '오답 노트 — 같은 문제', '#/wrong');
  }

  // ── 내 학습 ───────────────────────────────
  function me() {
    const n = ATT.length, ok = ATT.filter(a => a.ok).length, st = conceptStates();
    const byConf = ['sure', 'unsure', 'guess'].map(k => { const l = ATT.filter(a => a.conf === k); return [k, l.length, l.filter(a => a.ok).length]; });
    const errs = Object.keys(ERR).map(k => [k, ATT.filter(a => a.err === k).length]);
    const days = new Set(ATT.map(a => a.t.slice(0, 10))).size;
    app.innerHTML = `<h1 class="ptitle2">내 학습 ${STU ? `<span class="muted small">${esc(STU.name)} (${esc(STU.student_no)})</span>` : '<span class="muted small">게스트 — 이 기기에만 저장</span>'}</h1>
      <div class="stats"><div><small>푼 횟수</small><b>${n}</b></div><div><small>정답률</small><b>${n ? Math.round(100 * ok / n) : 0}%</b></div><div><small>학습한 날</small><b>${days}일</b></div><div class="hl"><small>완료한 개념</small><b>${Object.values(st).filter(s => s.level >= 3).length} / ${Object.keys(CMAP).length}</b></div></div>
      <section class="card"><h3>확신도와 실제 정답률</h3><p class="muted small">“확실”한 답의 정답률이 높고 “찍음”은 낮아야 자기 실력을 정확히 아는 것입니다. 확실한데 자주 틀리면 착각하고 있는 개념이 있다는 뜻입니다.</p>
        <table class="tbl"><tr><th>확신도</th><th>답한 수</th><th>정답률</th></tr>${byConf.map(([k, a, b]) => `<tr><td>${CONF[k]}</td><td>${a}</td><td>${a ? Math.round(100 * b / a) + '%' : '—'}</td></tr>`).join('')}</table></section>
      <section class="card"><h3>틀린 이유</h3><table class="tbl"><tr><th>이유</th><th>횟수</th><th>공부 방법</th></tr>${errs.map(([k, v]) => `<tr><td>${ERR[k]}</td><td>${v}</td><td class="small">${ERR_TIP[k]}</td></tr>`).join('')}</table></section>
      ${CHS().map(ch => `<section class="card"><h3>Ch${ch.no}. ${esc(ch.title)}</h3><div class="chips">${ch.concepts.map(c => { const s = st[c.id], S2 = statusOf(s); return `<a class="chip ${S2.k}" href="#/study/${ch.no}/c-${c.id}">${esc(c.t)} <small>${S2.t}${s ? ` · ${s.ok}/${s.n}` : ''}</small></a>`; }).join('')}</div></section>`).join('')}`;
  }

  // ── 교수 ─────────────────────────────────
  async function prof() {
    const { data: { session } } = await sb.auth.getSession(); PROF = session; renderNav();
    if (!PROF) {
      app.innerHTML = `<section class="card narrowbox"><h3>교수 로그인</h3><p class="muted small">기능해부학 · 운동치료 · 설문도구 웹앱과 같은 교수 계정입니다.</p><form id="pf" class="form"><label>이메일<input name="em" type="email" value="${esc(CFG.profEmail)}"></label><label>비밀번호<input name="pw" type="password"></label><button class="btn block">로그인</button></form></section>`;
      $('#pf').onsubmit = async e => { e.preventDefault(); const f = e.target; const { error } = await sb.auth.signInWithPassword({ email: f.em.value.trim(), password: f.pw.value }); if (error) return toast('이메일 또는 비밀번호가 맞지 않습니다', true); const okp = await sb.rpc('pa_is_prof'); if (!okp.data) { await sb.auth.signOut(); return toast('교수로 등록된 계정이 아닙니다', true); } prof(); };
      return;
    }
    app.innerHTML = '<p class="muted">불러오는 중…</p>';
    const [a, b] = await Promise.all([sb.from('pa_students').select('*').order('student_no'), sb.from('pa_attempts').select('*').order('created_at').limit(50000)]);
    if (a.error || b.error) { app.innerHTML = `<div class="card"><p class="bad">${esc(errMsg(a.error || b.error))}</p></div>`; return; }
    const STs = a.data, AT = b.data.map(r => Object.assign(fromRow(r), { sno: r.student_no }));
    const qStat = Object.values(QMAP).map(q => { const l = AT.filter(x => x.qid === q.id), w = l.filter(x => !x.ok), wc = {}; w.forEach(x => wc[x.chosen] = (wc[x.chosen] || 0) + 1); const top = Object.entries(wc).sort((p, r) => r[1] - p[1])[0];
      return { q, n: l.length, acc: l.length ? Math.round(100 * l.filter(x => x.ok).length / l.length) : null, top, sureW: w.filter(x => x.conf === 'sure').length, err: Object.keys(ERR).map(k => w.filter(x => x.err === k).length) }; });
    const sStat = STs.map(s => { const l = AT.filter(x => x.sno === s.student_no); return { s, n: l.length, acc: l.length ? Math.round(100 * l.filter(x => x.ok).length / l.length) : null, last: l.length ? l[l.length - 1].t : null, days: new Set(l.map(x => x.t.slice(0, 10))).size }; });
    app.innerHTML = `<header class="whead"><div><h1>학습 분석</h1><p class="muted">학생 ${STs.length}명 · 풀이 ${AT.length}회</p></div><div class="row wrap"><button class="btn ghost" id="rf">새로고침</button><button class="btn" id="xl">엑셀 내려받기</button></div></header>
      <section class="card"><h3>문항 분석 <span class="muted small">정답률 낮은 순 — “확실-오답”이 많은 문항은 학생들이 잘못 알고 있는 개념입니다</span></h3><div class="tw"><table class="tbl"><tr><th>문항</th><th>개념</th><th>풀이</th><th>정답률</th><th>가장 많이 고른 오답</th><th>확실-오답</th><th>모름 · 헷갈림 · 잘못 읽음</th></tr>
        ${qStat.filter(x => x.n).sort((p, r) => p.acc - r.acc).map(x => `<tr><td class="small"><b>${x.q.id}</b> ${esc(x.q.q.slice(0, 40))}…</td><td class="small">${esc(CMAP[x.q.c].t)}</td><td>${x.n}</td><td><b class="${x.acc < 60 ? 'bad' : ''}">${x.acc}%</b></td><td class="small">${x.top ? `${esc(x.top[0] || '무응답')} (${x.top[1]})` : '—'}</td><td>${x.sureW}</td><td>${x.err.join(' · ')}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">아직 풀이 기록이 없습니다.</td></tr>'}</table></div></section>
      <section class="card"><h3>학생</h3><div class="tw"><table class="tbl"><tr><th>학번</th><th>이름</th><th>풀이</th><th>정답률</th><th>학습한 날</th><th>마지막</th><th></th></tr>
        ${sStat.map(x => `<tr><td>${esc(x.s.student_no)}</td><td>${esc(x.s.name)}</td><td>${x.n}</td><td>${x.acc ?? '—'}${x.acc != null ? '%' : ''}</td><td>${x.days}</td><td class="small">${x.last ? new Date(x.last).toLocaleString('ko-KR') : '—'}</td><td><button class="btn ghost sm" data-pin="${esc(x.s.student_no)}">PIN</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">등록한 학생이 없습니다.</td></tr>'}</table></div></section>`;
    $('#rf').onclick = prof;
    $$('[data-pin]').forEach(bt => bt.onclick = async () => { const p = prompt(`${bt.dataset.pin} 학생의 새 PIN (숫자 4~8자리)`); if (!p) return; if (!/^\d{4,8}$/.test(p)) return toast('숫자 4~8자리', true); const { error } = await sb.rpc('pa_reset_pin', { p_no: bt.dataset.pin, p_pin: p }); error ? toast(errMsg(error), true) : toast('PIN을 초기화했습니다'); });
    $('#xl').onclick = async () => {
      if (!window.XLSX) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
      const wb = XLSX.utils.book_new(), nm = n => (STs.find(s => s.student_no === n) || {}).name || '';
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sStat.map(x => ({ 학번: x.s.student_no, 이름: x.s.name, 풀이: x.n, 정답률: x.acc, 학습한날: x.days, 마지막: x.last }))), '학생');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(qStat.map(x => ({ 문항: x.q.id, 장: x.q.ch, 목표: x.q.obj, 개념: CMAP[x.q.c].t, 문제: x.q.q, 풀이: x.n, 정답률: x.acc, 최다오답: x.top ? x.top[0] : '', 최다오답수: x.top ? x.top[1] : '', 확실오답: x.sureW, 모름: x.err[0], 헷갈림: x.err[1], 잘못읽음: x.err[2] }))), '문항분석');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(AT.map(x => ({ 학번: x.sno, 이름: nm(x.sno), 문항: x.qid, 개념: (CMAP[x.c] || {}).t, 고른답: x.chosen, 정답: x.ok ? 'O' : 'X', 확신도: CONF[x.conf] || x.conf, 틀린이유: ERR[x.err] || '', 모드: x.mode, 시각: x.t }))), '풀이기록');
      XLSX.writeFile(wb, `병리학_학습분석_${new Date().toISOString().slice(0, 10)}.xlsx`);
    };
  }

  function notFound() { app.innerHTML = `<div class="card center"><p>준비 중인 화면입니다.</p><a class="btn" href="#/">처음으로</a></div>`; }

  // ── 라우터 ───────────────────────────────
  async function route() {
    const [, p, a, b] = (location.hash || '#/').split('/');
    renderNav(); window.scrollTo(0, 0);
    try {
      if (!p) home(); else if (p === 'ch') chapter(+a);
      else if (p === 'study') startStudy(buildSet(+a, b || 'all'), `Ch${a} · ${SEL_T(b)}`, `#/ch/${a}`);
      else if (p === 'review') review(a); else if (p === 'exam') exam(+a); else if (p === 'notes') notes(+a);
      else if (p === 'wrong') wrong(); else if (p === 'me') me(); else if (p === 'prof') await prof(); else notFound();
    } catch (e) { console.error(e); app.innerHTML = `<div class="card"><p class="bad">${esc(errMsg(e))}</p></div>`; }
  }
  window.addEventListener('hashchange', route);
  ssoReady.then(() => Promise.all([sb.auth.getSession(), loadAtt()]).then(([{ data }]) => { PROF = data.session; route(); }));
})();
