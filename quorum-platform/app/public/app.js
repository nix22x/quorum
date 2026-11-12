const $ = (s, el = document) => el.querySelector(s);
let ST = null, view = 'command', mountedView = null;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => (n == null ? 'unknown' : '$' + n.toLocaleString('en-US'));
const ago = (ts) => { const d = Math.floor((ST.serverTime - ts) / 86400000); return d <= 0 ? 'today' : d + 'd ago'; };
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

async function api(path, body) {
  const r = await fetch('/api/' + path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) { toast(j.error || 'Failed', true); throw new Error(j.error); }
  return j;
}
function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200); }
async function refresh() { ST = await api('state'); render(); }
async function act(path, body, okMsg) { try { await api(path, body); if (okMsg) toast(okMsg); await refresh(); return true; } catch { return false; } }

const STATE = {
  awaiting_approval: ['Awaiting you', 'p-wait'], needs_attention: ['Needs attention', 'p-bad'], holdout: ['Holdout · observed only', 'p-hold'],
  stopped: ['Stopped', 'p-mut'], handed_off: ['Handed off (simulated)', 'p-sim'], rejected: ['Rejected', 'p-mut'],
  needs_owner: ['Reply needs you', 'p-wait'], closed_declined: ['Closed · client declined', 'p-mut'], closed_handled: ['Closed · handled', 'p-ok'], detected: ['Detected', 'p-live'],
};
const pill = (run) => { const [t, c] = STATE[run.state] || [run.state, 'p-mut']; return `<span class="pill ${c}">${t}${run.paused ? ' · paused' : ''}</span>`; };
const quoteOf = (run) => ST.quotes.find((q) => q.id === run.quoteId);
const runs = (f) => ST.runs.filter(f || (() => true));
const awaiting = () => runs((r) => r.state === 'awaiting_approval');
const exceptions = () => runs((r) => ['needs_attention', 'needs_owner'].includes(r.state));

const NAV = [
  ['Work', [['command', 'Command', 'command'], ['approvals', 'Approvals', 'approvals', 'wait'], ['exceptions', 'Exceptions', 'exceptions', 'bad']]],
  ['Records', [['quotes', 'Quotes & runs', 'quotes'], ['activity', 'Activity', 'activity']]],
  ['System', [['workers', 'Workers', 'workers']]],
];
const VIEW_NAME = Object.fromEntries(NAV.flatMap(([, it]) => it.map(([k, l]) => [k, l])));

// ---------- chrome ----------
function renderChrome() {
  OWNER_NAME = ST.tenant.owner;
  const a = awaiting().length, x = exceptions().length, badgeN = { approvals: a, exceptions: x };
  $('#brandMark').innerHTML = BRAND_MARK;
  $('#tenant').innerHTML = `<div class="tenant-name">${esc(ST.tenant.name)}</div><div class="tenant-row"><span class="chip sample">Sample business</span></div><div class="tenant-row">${badge('owner', 'sm')}<span class="tenant-sub">${esc(ST.tenant.owner)} · owner, sole approver</span></div>`;
  $('#nav').innerHTML = NAV.map(([g, items], gi) => `${gi ? '<span class="nav-group-rule" aria-hidden="true"></span>' : ''}<div class="nav-group">${g}</div>` + items.map(([k, l, ic, tone]) => {
    const n = badgeN[k];
    return `<button type="button" class="nav-item" data-v="${k}" data-k="nav:${k}" ${view === k ? 'aria-current="page"' : ''} title="${l}" aria-label="${l}${n ? `, ${n} waiting` : ''}">${icon(ic, 20)}<span class="nav-label">${l}</span>${n ? `<span class="badge ${tone}">${n}</span>` : ''}</button>`;
  }).join('')).join('');
  $('#integrations').innerHTML = `<div class="integ" role="img" aria-label="Jobber: Not connected" title="Jobber: Not connected">${icon('plug', 16)}<div aria-hidden="true"><b>Jobber</b>Not connected</div></div><div class="integ" role="img" aria-label="SMS and email: Disabled, nothing is sent" title="SMS / email: Disabled · nothing is sent">${icon('msgoff', 16)}<div aria-hidden="true"><b>SMS / email</b>Disabled · nothing is sent</div></div>`;
  $('#crumbTenant').textContent = ST.tenant.name.split(' ')[0];
  $('#crumb').textContent = VIEW_NAME[view];
  const pb = $('#btnPause');
  pb.innerHTML = ST.paused ? `${icon('play', 16)}Resume all work` : `${icon('pause', 16)}Pause all work`;
  pb.className = 'btn warn' + (ST.paused ? ' on' : ''); pb.setAttribute('aria-pressed', ST.paused);
  $('#btnReset').innerHTML = `${icon('reset', 16)}Reset demo`;
  $('#pausedPill').hidden = !ST.paused;
  document.body.classList.toggle('is-paused', ST.paused);
  $('#notice').innerHTML = `${icon('exceptions', 16)}<span><b>Sample data · simulated Jobber · no messages are sent.</b> Workflow logic, approvals and the audit log are real. Clients and quotes are made up.</span>`;
}

function render() {
  const ae = document.activeElement, fk = ae && ae.dataset ? ae.dataset.k : null;
  renderChrome();
  Panel.render();
  const V = { command: vCommand, approvals: vApprovals, quotes: vQuotes, exceptions: vExceptions, activity: vActivity, workers: vWorkers };
  V[view]();
  mountedView = view;
  if (fk && document.activeElement !== ae) { const el = document.querySelector(`[data-k="${CSS.escape(fk)}"]`); if (el) el.focus({ preventScroll: true }); }
}

// ---------- Command ----------
function statusLine() {
  const r = ST.runs;
  if (!r.length) return `<span class="sl-part">No runs yet · <b class="num">${ST.quotes.length}</b> sample quotes ready to scan</span>`;
  const a = awaiting().length + runs((x) => x.state === 'needs_owner').length, x = exceptions().length, h = runs((q) => q.state === 'holdout').length, ho = runs((q) => q.approval).length;
  const part = (n, l, v, cls) => `<button type="button" class="sl-part ${n ? cls : ''}" data-go="${v}" data-k="sl:${v}:${l}"><b class="num">${n}</b> ${l}</button>`;
  return [part(awaiting().length, 'waiting on you', 'approvals', 'wait'), part(x, x === 1 ? 'exception' : 'exceptions', 'exceptions', 'bad'), part(h, 'holdout', 'quotes'), part(ho, 'handed off (simulated)', 'quotes')].join('<span class="sl-sep" aria-hidden="true">·</span>');
}
function vCommand() {
  const unscanned = ST.quotes.filter((q) => !q.swept).length;
  if (mountedView !== 'command' || !Canvas.isMounted()) {
    $('#view').innerHTML = `<div class="phead"><div><h1>Estimate follow-up</h1><div class="statusline" id="statusLine"></div></div><div id="scanSlot"></div></div>
      <div id="cvBanner"></div><div id="cvHost"></div>
      <div class="sect"><h2>Needs you</h2><small id="needsCount"></small></div><div id="needsYou"></div>`;
    Canvas.mount($('#cvHost'), {
      openRun: (id) => openRunPanel(id), approve: (id) => act(`runs/${id}/approve`, {}, 'Approved. Hand-off is simulated; nothing was sent.'),
      worker: (k) => Panel.openWorker(k),
      go: (v) => { view = v; render(); }, clearTrace: () => Panel.close(),
    });
  }
  $('#statusLine').innerHTML = statusLine();
  $('#scanSlot').innerHTML = ST.paused ? `<button class="btn" type="button" disabled data-k="scan">Scanning blocked while paused</button>`
    : unscanned ? `<button class="btn primary" type="button" id="btnSweep" data-k="scan">${icon('watcher', 16)}Scan sample quotes (${unscanned})</button>`
    : `<button class="btn" type="button" disabled data-k="scan">${icon('check', 16)}Nothing new to scan</button>`;
  $('#cvBanner').innerHTML = ST.paused ? `<div class="cv-banner" role="status">${icon('pause', 18)}<span><b>All work is paused.</b> Scans and approvals are blocked until you resume. Nothing else changes.</span><button class="btn warn on sm" type="button" data-resume data-k="resume">${icon('play', 14)}Resume all work</button></div>` : '';
  Canvas.setInset(Panel.open && Panel.docked() ? Panel.panelWidth() : 0);
  Canvas.select(Panel.runId());
  Canvas.markNode(Panel.workerKey());
  Canvas.update(ST);
  if (Panel.consumeOpened()) { const r = Panel.runId() && ST.runs.find((x) => x.id === Panel.runId()); Canvas.reveal(r ? locOf(r) : Panel.workerKey()); }
  const list = [...awaiting(), ...exceptions()];
  $('#needsCount').textContent = list.length ? `${list.length} item${list.length > 1 ? 's' : ''}` : '';
  $('#needsYou').innerHTML = list.length ? `<div class="cards">${list.map(approvalCard).join('')}</div>` : `<div class="panel empty">${ST.runs.length ? 'Nothing needs you right now.' : 'Nothing yet. Scan the sample quotes to start the workflow.'}</div>`;
  bindRunClicks();
}
function onViewClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'btnSweep') { act('sweep', {}, 'Scanned the sample quotes'); return; }
  if ('resume' in b.dataset) { act('pause', { paused: false }, 'Resumed'); return; }
  if (b.dataset.go && b.closest('.statusline')) { view = b.dataset.go; render(); }
}
function approvalCard(run) {
  const q = quoteOf(run), ex = run.exception, isPend = run.state === 'awaiting_approval';
  const why = ST.paused ? 'Global pause is on' : run.paused ? 'This run is paused' : '';
  return `<article class="card acard" data-run="${run.id}">
    <div class="hd"><div class="who"><span class="nm">${esc(q.client.first)} ${esc(q.client.last)}</span><span class="mono t3">${q.id}</span></div>${pill(run)}</div>
    <div class="what">${esc(q.service)} · <span class="num">${money(q.total)}</span> · sent ${ago(q.sentAt)}</div>
    ${ex ? `<div class="where">${identity(locOf(run), { sub: false })}<span class="t3">raised this</span></div>` : ''}
    <div class="body">${run.draft && isPend ? `<div class="msg">${esc(run.draft.text)}</div>` : ex ? `<div class="exc"><b>${esc(CODE_HUMAN[ex.code] || ex.code)}</b> <code>${esc(ex.code)}</code><p>${esc(ex.message)}</p></div>` : ''}</div>
    <div class="acts">${isPend ? `<button type="button" class="btn primary" data-do="approve" data-k="cap:${run.id}" ${why ? `disabled title="${why}"` : ''}>Approve</button>` : ''}<button type="button" class="btn" data-do="open" data-k="cop:${run.id}">${isPend ? 'Edit / reject' : 'Open'}</button>${why && isPend ? `<span class="t3" style="font-size:13px;align-self:center">${why}</span>` : ''}</div></article>`;
}
function bindRunClicks() {
  document.querySelectorAll('#view [data-run]:not(.tok)').forEach((el) => {
    const id = el.dataset.run;
    el.onclick = (e) => { const d = e.target.closest('[data-do]'); if (d && d.dataset.do === 'approve') { e.stopPropagation(); act(`runs/${id}/approve`, {}, 'Approved. Hand-off is simulated; nothing was sent.'); return; } if (e.target.closest('.cv')) return; openRunPanel(id); };
  });
}
function openRunPanel(id) { Panel.openRun(id); }

// ---------- other views ----------
const phead = (t, p, right = '') => `<div class="phead"><div><h1>${t}</h1><p>${p}</p></div>${right}</div>`;
function vApprovals() {
  const l = awaiting();
  $('#view').innerHTML = phead('Approvals', 'Every outbound message needs your approval of its exact text. Edits invalidate any earlier approval.') + (l.length ? `<div class="cards">${l.map(approvalCard).join('')}</div>` : '<div class="panel empty">No drafts are waiting. Scan the sample quotes from Command.</div>');
  bindRunClicks();
}
function vExceptions() {
  const l = exceptions();
  $('#view').innerHTML = phead('Exceptions', 'Things the workers refused to do or could not decide. These need a person.') + (l.length ? `<div class="cards">${l.map(approvalCard).join('')}</div>` : '<div class="panel empty">No exceptions.</div>');
  bindRunClicks();
}
function vQuotes() {
  const rows = ST.quotes.map((q) => { const run = ST.runs.find((r) => r.quoteId === q.id);
    const why = run ? (run.stopReason || (run.exception && (CODE_HUMAN[run.exception.code] || run.exception.code)) || '') : '';
    return `<tr class="${run ? 'click' : ''}" ${run ? `data-run="${run.id}" tabindex="0" data-k="row:${run.id}" aria-label="Open ${esc(q.client.first)} ${esc(q.client.last)}, ${q.id}"` : ''}><td><b>${esc(q.client.first)} ${esc(q.client.last)}</b><div class="cell-sub mono">${q.id}</div></td><td>${esc(q.service)}<div class="cell-sub">sent ${ago(q.sentAt)} · ${q.status}</div></td><td class="num">${money(q.total)}</td><td>${run ? identity(locOf(run), { sub: false }) : '<span class="t3">Not scanned</span>'}</td><td>${run ? pill(run) : '<span class="pill p-mut">Not scanned</span>'}${why ? `<div class="cell-why">${esc(why)}</div>` : ''}</td><td>${run?.arm ? `<span class="chip">${run.arm}</span>` : '<span class="t3">none</span>'}</td></tr>`; }).join('');
  $('#view').innerHTML = phead('Quotes &amp; runs', 'Sample quotes and the workflow run each one produced. Select a row for its detail.') + `<div class="panel tablewrap"><table><thead><tr><th>Client</th><th>Quote</th><th>Total</th><th>Step</th><th>State and reason</th><th>Arm</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  bindRunClicks();
  document.querySelectorAll('tr.click').forEach((tr) => (tr.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRunPanel(tr.dataset.run); } }));
}
const hms = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function evHtml(g) {
  const e = g.e, wk = ACTOR_WORKER[e.actor] || 'system', subj = subjectOf(e, ST), last = g.states[g.states.length - 1];
  const rows = [...detailRows(e), ...g.states.map((s) => ['state change', `#${s.seq} by ${workerOfActor(s.actor).name}: ${STATE_HUMAN[s.detail.from] || s.detail.from} → ${STATE_HUMAN[s.detail.to] || s.detail.to}${s.detail.why ? ' (' + s.detail.why + ')' : ''}`])];
  return `<details class="ev" style="--a:${WORKERS[wk].accent}"><summary><time datetime="${e.ts}">${hms(e.ts)}</time><span class="ev-actor">${badge(wk, 'xs')}<span>${WORKERS[wk].name}</span></span><span class="ev-sum"><span class="ev-line">${esc(summarize(e, ST.tenant.owner))}</span>${subj ? `<span class="ev-subj">${esc(subj)}</span>` : ''}${last ? `<span class="ev-to">→ ${esc(STATE_HUMAN[last.detail.to] || last.detail.to)}</span>` : ''}</span><span class="seq">#${e.seq}</span></summary>
    <dl class="ev-det">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></details>`;
}
function vActivity() {
  const groups = groupEvents(ST.audit);
  $('#view').innerHTML = phead('Activity', `Every decision in order, newest first: ${ST.auditCount} audit events, shown as ${groups.length} entries (state changes are folded into the event that caused them). Append-only and hash-chained.`, '<button class="btn" type="button" id="btnVerify" data-k="verify">Verify chain</button>') + `<div id="verifyOut"></div><div class="panel feed">${groups.length ? groups.map(evHtml).join('') : '<div class="empty">No activity yet.</div>'}</div>`;
  $('#btnVerify').onclick = async () => { const v = await api('verify'); $('#verifyOut').innerHTML = `<div class="note">${v.ok ? `<b style="color:var(--st-ok)">Chain intact.</b> ${v.count} events verified.` : `<b style="color:var(--st-bad)">Broken at #${v.brokenAt}.</b>`} (A hash chain detects accidental or casual edits to the file; it is not tamper-proof against someone who rewrites all later entries.)</div>`; };
}
function vWorkers() {
  const K = ['watcher', 'gate', 'drafter', 'owner', 'handoff', 'triage'];
  $('#view').innerHTML = phead('Workers', 'Two of these are the kind of step a language model could do later. In this build none of them calls a model.') + `<div class="wk">${K.map((k) => { const [job, real, sim, no] = WORKER_DOC[k]; return `<article class="card" id="wk-${k}" tabindex="-1" style="--a:${WORKERS[k].accent}">${identity(k, { size: 'lg' })}<p class="t2 wk-job">${job}</p><dl><dt>Real</dt><dd class="real">${real}</dd><dt>Simulated</dt><dd class="sim">${sim}</dd><dt>Cannot</dt><dd>${no}</dd></dl><div class="wk-facts">${workerFacts(k, ST).map(([l, v]) => `<span><b class="num">${v}</b> ${l.toLowerCase()}</span>`).join('')}</div><div class="wk-foot"><button type="button" class="btn sm" data-wk="${k}" data-k="wkopen:${k}">Open in panel</button></div></article>`; }).join('')}</div>`;
  document.querySelectorAll('[data-wk]').forEach((b) => (b.onclick = () => Panel.openWorker(b.dataset.wk)));
}

// ---------- wiring ----------
$('#view').addEventListener('click', (e) => { if (view === 'command') onViewClick(e); });
$('#nav').onclick = (e) => { const b = e.target.closest('[data-v]'); if (b) { view = b.dataset.v; render(); } };
$('#btnPause').onclick = () => act('pause', { paused: !ST.paused }, ST.paused ? 'Resumed' : 'Paused: no new scans, no approvals');
$('#btnReset').onclick = async () => { if (confirm('Restore the sample data and clear the audit log?')) { Panel.clearDirty(); await act('reset', {}, 'Demo reset'); } };
$('#scrim').onclick = () => Panel.close();
Panel.init({ render: () => ST && render(), act, go: (v) => { view = v; render(); } });
window.addEventListener('resize', () => { if (ST && Panel.open) render(); });
refresh();
