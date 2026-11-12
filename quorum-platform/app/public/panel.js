// Detail panel: docks to the right at >= 1280px (no scrim), overlays with a scrim and focus trap below that.
// Shows a run (tabs: Draft, Checks, Trace) or a worker. Never changes workflow behaviour: every action goes through the existing API.
const Panel = (() => {
  const DOCK = matchMedia('(min-width: 1280px)');
  const store = { get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  let cur = store.get('quorum.panel'), tab = (cur && cur.tab) || 'draft', justOpened = false, H = {};
  const dirty = store.get('quorum.dirty') || {}; // unsaved draft text per run, survives re-renders and page refresh
  const saveDirty = () => store.set('quorum.dirty', Object.keys(dirty).length ? dirty : null);
  const saveCur = () => store.set('quorum.panel', cur ? { ...cur, tab } : null);
  const el = () => document.getElementById('drawer');
  const docked = () => DOCK.matches;
  const panelWidth = () => (innerWidth >= 1440 ? 420 : 380);
  const hms = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const chk = (ok, label, msg) => `<li class="chk ${ok === true ? 'ok' : ok === false ? 'no' : 'na'}">${icon(ok === true ? 'check' : ok === false ? 'x' : 'trace', 16)}<span><b>${label}</b>${msg ? `<span class="chk-msg">${msg}</span>` : ''}</span></li>`;

  function init(h) { H = h; DOCK.addEventListener('change', () => H.render()); document.addEventListener('keydown', onKey, true); }
  const runId = () => (cur && cur.kind === 'run' ? cur.id : null);
  const workerKey = () => (cur && cur.kind === 'worker' ? cur.id : null);
  function openRun(id, focusTab) { if (!cur || cur.kind !== 'run' || cur.id !== id) tab = focusTab || 'draft'; cur = { kind: 'run', id }; justOpened = true; saveCur(); H.render(); focusOpen(); }
  function openWorker(k) { cur = { kind: 'worker', id: k }; justOpened = true; saveCur(); H.render(); focusOpen(); }
  function close() {
    const back = cur; cur = null; saveCur(); H.render();
    if (back) { const t = document.querySelector(back.kind === 'run' ? `.tok[data-run="${back.id}"], [data-run="${back.id}"] [data-do="open"], tr[data-run="${back.id}"]` : `.nd-name[data-worker="${back.id}"]`); if (t) t.focus({ preventScroll: true }); }
  }
  function focusOpen() { const c = document.getElementById('pnClose'); if (c) c.focus({ preventScroll: true }); }
  function consumeOpened() { const j = justOpened; justOpened = false; return j; }
  function clearDirty() { for (const k of Object.keys(dirty)) delete dirty[k]; saveDirty(); }

  // Why Approve is unavailable, one sentence per blocking condition (empty list = allowed).
  function approveBlockers(run, typed) {
    const r = [], fails = run.draft ? run.draft.validation.checks.filter((c) => !c.ok).length : 0;
    if (run.state !== 'awaiting_approval' && !(run.state === 'needs_attention' && run.exception?.code === 'validation_failed')) r.push(`Only a draft awaiting approval can be approved; this run is ${STATE_HUMAN[run.state]}.`);
    if (ST.paused) r.push('Global pause is on. Resume all work to approve.');
    if (run.paused) r.push('This run is paused. Resume the run to approve.');
    if (run.draft && typed !== run.draft.text) r.push('You have an unsaved edit. Save it first; saving re-runs the checks and clears any earlier approval.');
    else if (run.draft && !run.draft.validation.ok) r.push(`The saved draft fails ${fails} check${fails === 1 ? '' : 's'}. Edit the text and save to re-check.`);
    return r;
  }

  // ---------- run view ----------
  function runHead(run, q) {
    const loc = locOf(run), w = WORKERS[loc];
    return `<header class="pn-hd"><div class="pn-hd-row"><div class="pn-title-wrap"><h2 class="pn-title" id="pnTitle">${esc(q.client.first)} ${esc(q.client.last)}</h2><div class="pn-sub"><span class="mono">${q.id}</span> · ${esc(q.service)}</div></div><button class="ibtn" id="pnClose" type="button" data-k="pnclose" aria-label="Close detail panel (Esc)">${icon('x', 18)}</button></div>
      <div class="pn-meta">${pill(run)}<span class="chip accent" style="--a:${w.accent}" title="Where this run is on the canvas">${badge(loc, 'xs')}${w.name}</span>${run.arm ? `<span class="chip">${run.arm === 'holdout' ? 'Holdout arm' : 'Treatment arm'}</span>` : '<span class="chip">No arm</span>'}<span class="pn-amt num">${money(q.total)}</span></div></header>`;
  }
  function tabsHtml() {
    const T = [['draft', 'Draft'], ['checks', 'Checks'], ['trace', 'Trace']];
    return `<div class="pn-tabs" role="tablist" aria-label="Run detail">${T.map(([k, l]) => `<button type="button" role="tab" id="tab-${k}" data-tab="${k}" data-k="tab:${k}" aria-selected="${tab === k}" aria-controls="pnBody" tabindex="${tab === k ? 0 : -1}">${l}</button>`).join('')}</div>`;
  }
  function draftTab(run, q) {
    const editable = ['awaiting_approval', 'needs_attention'].includes(run.state) && run.draft;
    const typed = editable && dirty[run.id] !== undefined ? dirty[run.id] : run.draft?.text ?? '';
    let h = '';
    if (run.exception) h += `<div class="note ex"><b>${esc(CODE_HUMAN[run.exception.code] || run.exception.code)}</b> <code class="mono">${esc(run.exception.code)}</code><br>${esc(run.exception.message)}</div>`;
    if (run.stopReason) h += `<div class="note">Stopped: ${esc(run.stopReason)}.</div>`;
    if (run.arm === 'holdout') h += '<div class="note">Holdout: observed only. No draft is written, so outcomes can be compared fairly later.</div>';
    if (!run.draft) return h + (run.exception || run.stopReason || run.arm === 'holdout' ? '' : '<p class="t2">No draft for this run.</p>');
    const blockers = editable ? approveBlockers(run, typed) : [];
    h += `<section class="pn-sect"><div class="pn-sect-hd"><h3 class="pn-h">Draft v${run.draft.version}${run.draft.editedBy ? ` · edited by ${esc(run.draft.editedBy)}` : ''}</h3><span class="pn-note">Fixed template · no AI model yet</span></div>
      ${editable ? `<label class="sr-only" for="dText">Draft text</label><textarea id="dText" data-k="dtext" aria-describedby="dCount">${esc(typed)}</textarea>
        <div class="pn-count"><span id="dCount" class="num ${typed.length > 320 ? 'over' : ''}">${typed.length} / 320 characters</span>${dirty[run.id] !== undefined && dirty[run.id] !== run.draft.text ? '<span class="unsaved" id="dUnsaved">Unsaved edit</span>' : '<span class="unsaved" id="dUnsaved" hidden>Unsaved edit</span>'}</div>` : `<div class="msg">${esc(run.draft.text)}</div>`}
      <ul class="checks" aria-label="Validation of the saved draft">${run.draft.validation.checks.map((c) => chk(c.ok, esc(c.name), c.ok ? '' : esc(c.msg))).join('')}</ul></section>`;
    if (run.approval) h += `<div class="note ok">Approved by ${esc(run.approval.by)} · text hash <span class="mono">${run.approval.hash.slice(0, 16)}…</span><br><b>Simulated hand-off: nothing was sent.</b></div>`;
    if (editable) h += `<div class="pn-actions"><button class="btn primary" type="button" id="dApprove" data-k="dapprove" ${blockers.length ? 'disabled' : ''} aria-describedby="dWhy">Approve</button><button class="btn" type="button" id="dSave" data-k="dsave" ${typed === run.draft.text ? 'disabled' : ''}>Save edit</button><button class="btn danger" type="button" id="dReject" data-k="dreject">Reject…</button><button class="btn warn" type="button" id="dPause" data-k="dpause">${icon(run.paused ? 'play' : 'pause', 16)}${run.paused ? 'Resume run' : 'Pause run'}</button></div>
      <ul class="pn-why" id="dWhy" aria-live="polite">${blockers.map((b) => `<li>${b}</li>`).join('')}</ul>
      <div id="rejectBox" class="field" hidden><label for="rejReason">Reason for rejecting (required, kept in the audit log)</label><input type="text" id="rejReason" data-k="rejreason"><div id="rejErr" class="field-err" role="alert" hidden>A reason is required to reject.</div><div><button class="btn danger" type="button" id="rejGo" data-k="rejgo">Confirm reject</button></div></div>`;
    if (run.state === 'handed_off') h += `<section class="pn-sect"><div class="pn-sect-hd"><h3 class="pn-h">Simulate a client reply</h3><span class="chip sim">SIMULATED</span></div><p class="pn-note">There is no inbox. Type what a client might reply to see how triage and suppression behave.</p><div class="field"><label for="replyText">Simulated reply</label><input type="text" id="replyText" data-k="replytext" placeholder='e.g. "Sounds good, can you start Monday?" or "STOP"'></div><div class="pn-actions"><button class="btn" type="button" id="replyGo" data-k="replygo">Send simulated reply</button></div></section>`;
    if (run.reply) h += `<div class="note">Simulated reply: “${esc(run.reply.text)}” → <b style="color:var(--w-triage)">${esc(run.reply.label)}</b> (keyword rules, no AI model yet)</div>`;
    if (run.state === 'needs_owner') h += `<div class="pn-actions"><button class="btn primary" type="button" id="resolveGo" data-k="resolvego">Mark handled</button></div>`;
    return h;
  }
  function checksTab(run, q) {
    const evs = ST.audit.filter((e) => e.entity === 'run:' + run.id);
    const el = evs.find((e) => e.action === 'eligibility.passed' || e.action === 'eligibility.failed'), arm = evs.find((e) => e.action === 'arm.assigned');
    return `<section class="pn-sect"><h3 class="pn-h">Eligibility and consent</h3><ul class="checks">
      ${chk(el ? el.action === 'eligibility.passed' : null, 'Eligibility', el ? (el.action === 'eligibility.passed' ? '3 to 60 days old, quote status "sent", not opted out, under the cap' : esc(el.detail.reason)) : 'Not checked yet')}
      ${chk(q.consentSms, 'SMS consent', q.consentSms ? 'On file (sample flag)' : 'No SMS consent on file. Quorum will not text this client.')}
      ${chk(!q.optedOut, 'Opt-out', q.optedOut ? 'Client opted out; suppressed' : 'Not opted out')}
      ${chk(q.handoffs < 2, 'Follow-up cap', `${q.handoffs} of 2 used`)}
      ${chk(null, 'Holdout', arm ? `${arm.detail.arm === 'holdout' ? 'Holdout: observed only' : 'Treatment'} · bucket ${arm.detail.bucket} of 100 (holdout below ${arm.detail.holdoutPercent})` : 'Not assigned')}
      </ul></section>
      <section class="pn-sect"><h3 class="pn-h">Draft validation</h3>${run.draft ? `<ul class="checks">${run.draft.validation.checks.map((c) => chk(c.ok, esc(c.name), c.ok ? '' : esc(c.msg))).join('')}</ul>` : '<p class="pn-note">No draft to validate.</p>'}</section>`;
  }
  function traceTab(run, q) {
    const evs = ST.audit.filter((e) => e.entity === 'run:' + run.id || e.entity === 'quote:' + q.id).slice().reverse();
    return `<section class="pn-sect"><div class="pn-sect-hd"><h3 class="pn-h">Real-time traceability</h3><span class="pn-note num">${evs.length} events · oldest first</span></div>
      <ol class="trace">${evs.map((e) => { const w = workerOfActor(e.actor); return `<li class="tr-row" style="--a:${w.accent}"><div class="tr-meta"><span class="tr-seq mono">#${e.seq}</span><time class="tr-time mono" datetime="${e.ts}">${hms(e.ts)}</time><span class="tr-actor">${badge(ACTOR_WORKER[e.actor] || 'system', 'xs')}${w.name}</span></div><div class="tr-sum">${esc(summarize(e, ST.tenant.owner))}</div></li>`; }).join('')}</ol>
      <p class="pn-note">Filtered from the hash-chained audit log. Verify the whole chain in Activity.</p></section>`;
  }
  // ---------- worker view ----------
  function workerView(k) {
    const w = WORKERS[k], [job, real, sim, no] = WORKER_DOC[k] || ['', '', '', ''], here = ST.runs.filter((r) => locOf(r) === k);
    return `<header class="pn-hd"><div class="pn-hd-row"><div class="pn-ident">${badge(k, 'lg')}<div class="pn-title-wrap"><h2 class="pn-title" id="pnTitle">${w.name}</h2><div class="pn-sub">${w.type}</div></div></div><button class="ibtn" id="pnClose" type="button" data-k="pnclose" aria-label="Close detail panel (Esc)">${icon('x', 18)}</button></div></header>
      <div class="pn-body" id="pnBody"><section class="pn-sect"><h3 class="pn-h">Responsibilities</h3><p class="t2">${job}</p>
      <dl class="pn-dl"><dt>Real</dt><dd class="real">${real}</dd><dt>Simulated</dt><dd class="sim">${sim}</dd><dt>Cannot</dt><dd>${no}</dd></dl></section>
      <section class="pn-sect"><h3 class="pn-h">Right now</h3><div class="pn-facts">${workerFacts(k, ST).map(([l, v]) => `<div class="kv-row"><span>${l}</span><b class="num">${v}</b></div>`).join('')}</div></section>
      <section class="pn-sect"><div class="pn-sect-hd"><h3 class="pn-h">Runs at this step</h3><span class="pn-note num">${here.length}</span></div>${here.length ? `<div class="pn-toks">${here.map((r) => { const q = quoteOf(r); return `<button type="button" class="tok" data-prun="${r.id}" data-k="ptok:${r.id}" style="--c:${TONE_VAR[STATE_TONE[r.state]]}" aria-label="${esc(q.client.first + ' ' + q.client.last)}, ${q.id}, ${STATE_HUMAN[r.state]}"><span class="tok-i">${q.client.first[0]}${q.client.last[0]}</span><span class="tok-id">${q.id.slice(2)}</span></button>`; }).join('')}</div>` : '<p class="pn-note">None.</p>'}</section>
      <div class="pn-actions"><button type="button" class="btn ghost sm" data-allworkers data-k="allworkers">All workers ${icon('arrow', 14)}</button></div></div>`;
  }

  // ---------- render ----------
  function render() {
    const dr = el(), shell = document.getElementById('shell'), scrim = document.getElementById('scrim');
    if (cur && cur.kind === 'run' && !ST.runs.some((r) => r.id === cur.id)) { cur = null; saveCur(); }
    if (cur && cur.kind === 'worker' && !WORKER_DOC[cur.id]) { cur = null; saveCur(); }
    const isDock = docked();
    shell.classList.toggle('has-panel', !!cur && isDock);
    shell.style.setProperty('--pw', panelWidth() + 'px');
    scrim.hidden = !cur || isDock;
    document.querySelectorAll('.rail, .main').forEach((n) => (cur && !isDock ? n.setAttribute('inert', '') : n.removeAttribute('inert')));
    if (!cur) { dr.hidden = true; dr.innerHTML = ''; return; }
    dr.hidden = false;
    dr.className = 'drawer ' + (isDock ? 'is-docked' : 'is-overlay');
    dr.setAttribute('role', isDock ? 'complementary' : 'dialog');
    if (isDock) dr.removeAttribute('aria-modal'); else dr.setAttribute('aria-modal', 'true');
    dr.setAttribute('aria-labelledby', 'pnTitle');
    // preserve focus, caret and scroll across background re-renders
    const body0 = dr.querySelector('.pn-body'), keepScroll = body0 ? body0.scrollTop : 0, ae = document.activeElement, focusK = dr.contains(ae) ? ae.dataset.k : null;
    const sel = ae && ae.id === 'dText' ? [ae.selectionStart, ae.selectionEnd] : null, rejOpen = !!dr.querySelector('#rejectBox:not([hidden])'), rejVal = dr.querySelector('#rejReason')?.value, replyVal = dr.querySelector('#replyText')?.value;
    if (cur.kind === 'worker') dr.innerHTML = workerView(cur.id);
    else {
      const run = ST.runs.find((r) => r.id === cur.id), q = quoteOf(run);
      const body = tab === 'checks' ? checksTab(run, q) : tab === 'trace' ? traceTab(run, q) : draftTab(run, q);
      dr.innerHTML = runHead(run, q) + tabsHtml() + `<div class="pn-body" id="pnBody" role="tabpanel" aria-labelledby="tab-${tab}">${body}</div>`;
      if (rejOpen && dr.querySelector('#rejectBox')) { dr.querySelector('#rejectBox').hidden = false; dr.querySelector('#rejReason').value = rejVal || ''; }
      if (replyVal && dr.querySelector('#replyText')) dr.querySelector('#replyText').value = replyVal;
      bindRun(run);
    }
    const b = dr.querySelector('.pn-body'); if (b) b.scrollTop = keepScroll;
    if (focusK) { const f = dr.querySelector(`[data-k="${CSS.escape(focusK)}"]`); if (f) { f.focus({ preventScroll: true }); if (sel && f.setSelectionRange) f.setSelectionRange(sel[0], sel[1]); } }
    dr.onclick = onClick;
  }
  function bindRun(run) {
    const dr = el(), $d = (s) => dr.querySelector(s), id = run.id;
    const ta = $d('#dText');
    if (ta) ta.oninput = () => {
      dirty[id] = ta.value; if (ta.value === run.draft.text) delete dirty[id]; saveDirty();
      const blockers = approveBlockers(run, ta.value), ap = $d('#dApprove');
      if (ap) ap.disabled = blockers.length > 0;
      $d('#dWhy').innerHTML = blockers.map((x) => `<li>${x}</li>`).join('');
      $d('#dSave').disabled = ta.value === run.draft.text;
      const c = $d('#dCount'); c.textContent = `${ta.value.length} / 320 characters`; c.classList.toggle('over', ta.value.length > 320);
      $d('#dUnsaved').hidden = ta.value === run.draft.text;
    };
  }
  function onClick(e) {
    const t = e.target.closest('button'); if (!t) return;
    const run = runId() && ST.runs.find((r) => r.id === runId()), id = run && run.id, dr = el();
    if (t.id === 'pnClose') return close();
    if (t.dataset.tab) { tab = t.dataset.tab; saveCur(); H.render(); dr.querySelector(`#tab-${tab}`)?.focus(); return; }
    if (t.dataset.prun) return openRun(t.dataset.prun);
    if ('allworkers' in t.dataset) return H.go('workers');
    if (!run) return;
    if (t.id === 'dSave') { const txt = dirty[id]; H.act(`runs/${id}/edit`, { text: txt }, 'Edit saved. Any earlier approval is cleared.').then((ok) => { if (ok !== false) { delete dirty[id]; saveDirty(); H.render(); } }); return; }
    if (t.id === 'dApprove') return H.act(`runs/${id}/approve`, {}, 'Approved. Hand-off is simulated; nothing was sent.');
    if (t.id === 'dPause') return H.act(`runs/${id}/${run.paused ? 'resume' : 'pause'}`, {}, run.paused ? 'Run resumed' : 'Run paused');
    if (t.id === 'dReject') { dr.querySelector('#rejectBox').hidden = false; dr.querySelector('#rejReason').focus(); return; }
    if (t.id === 'rejGo') { const r = dr.querySelector('#rejReason'); if (!r.value.trim()) { r.setAttribute('aria-invalid', 'true'); dr.querySelector('#rejErr').hidden = false; r.focus(); return; } return H.act(`runs/${id}/reject`, { reason: r.value }, 'Rejected'); }
    if (t.id === 'replyGo') { const v = dr.querySelector('#replyText').value; dr.querySelector('#replyText').value = ''; return H.act(`runs/${id}/reply`, { text: v }, 'Simulated reply triaged'); }
    if (t.id === 'resolveGo') return H.act(`runs/${id}/resolve`, {}, 'Marked handled');
  }
  function onKey(e) {
    if (!cur) return;
    const dr = el();
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    const tabBtn = e.target.closest && e.target.closest('[role="tab"]');
    if (tabBtn && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      const T = ['draft', 'checks', 'trace'], i = T.indexOf(tab);
      tab = e.key === 'Home' ? T[0] : e.key === 'End' ? T[2] : T[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3];
      e.preventDefault(); saveCur(); H.render(); dr.querySelector(`#tab-${tab}`).focus(); return;
    }
    if (e.key === 'Tab' && !docked()) { // focus trap in overlay mode
      const f = [...dr.querySelectorAll('button:not([disabled]), textarea, input, [tabindex="0"]')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!dr.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }
  }
  return { init, render, openRun, openWorker, close, runId, workerKey, docked, panelWidth, consumeOpened, clearDirty, approveBlockers, get open() { return !!cur; } };
})();
