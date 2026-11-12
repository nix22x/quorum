// Quorum workflow canvas. A fixed-composition, two-tier scene (logical 1000 x 562):
// top row flows left to right, bottom row right to left, with the policy bus between them.
// It scales to fit (0.85 to 1.3); below the floor it pans. Every number, token and motion derives from GET /api/state.
const STATE_LABEL = {
  detected: 'detected', stopped: 'stopped', needs_attention: 'needs attention', holdout: 'holdout, observed only',
  awaiting_approval: 'awaiting approval', handed_off: 'handed off (simulated)', rejected: 'rejected',
  needs_owner: 'reply needs you', closed_declined: 'closed, client declined', closed_handled: 'closed, handled',
};
const STATE_TONE = { awaiting_approval: 'wait', needs_owner: 'wait', needs_attention: 'attn', stopped: 'mut', holdout: 'hold', handed_off: 'sim', rejected: 'mut', closed_declined: 'mut', closed_handled: 'ok', detected: 'live' };
const TONE_VAR = { wait: 'var(--st-wait)', attn: 'var(--st-bad)', ok: 'var(--st-ok)', mut: 'var(--t3)', hold: 'var(--w-gate)', sim: 'var(--w-sim)', live: 'var(--st-live)' };
const COMPLIANCE = ['no_consent', 'opted_out', 'cap'];
// A stopped run was either blocked by a policy rule (opt-out, cap, STOP) or simply not eligible (too new, too old, wrong status).
const stoppedByPolicy = (run) => /opted out|cap|STOP/.test(run.stopReason || '');
// Where a run currently sits on the canvas.
function locOf(run) {
  switch (run.state) {
    case 'detected': return 'watcher';
    case 'stopped': return run.stopReason === 'client replied STOP' ? 'triage' : 'gate';
    case 'holdout': return 'gate';
    case 'needs_attention': return COMPLIANCE.includes(run.exception?.code) ? 'gate' : 'drafter';
    case 'handed_off': return 'handoff';
    case 'closed_declined': return 'triage';
    default: return 'owner'; // awaiting_approval, rejected, needs_owner, closed_handled
  }
}
// Location implied by a run.state audit event (used for trace mode; uses only the event's own detail).
function locOfTransition(to, why) {
  if (to === 'stopped') return why === 'opt_out' ? 'triage' : 'gate';
  if (to === 'needs_attention') return COMPLIANCE.includes(why) ? 'gate' : 'drafter';
  return locOf({ state: to });
}

const Canvas = (() => {
  const W = 1000, H = 562, FLOOR = 0.85, MAX = 1.3, PAD = 20, GAP = 72, CW = 186, CH = 220, R1 = 16, R2 = R1 + CH + GAP;
  const ORDER = ['src', 'watcher', 'gate', 'drafter', 'owner', 'handoff', 'triage'];
  const COL = [0, 1, 2, 3].map((i) => PAD + i * (CW + GAP));
  const N = {
    src: { x: COL[0], y: R1 }, watcher: { x: COL[1], y: R1 }, gate: { x: COL[2], y: R1 }, drafter: { x: COL[3], y: R1 },
    owner: { x: COL[3], y: R2 }, handoff: { x: COL[2], y: R2 }, triage: { x: COL[1], y: R2 },
  };
  for (const k of ORDER) { N[k].w = CW; N[k].h = CH; }
  const HUB = { x: COL[0], y: R2, w: CW, h: CH };
  const Y1 = R1 + CH / 2, Y2 = R2 + CH / 2, BUS = R1 + CH + GAP / 2, TAP = 28;
  // Directed connectors: the main path plus exactly two return paths. p1/p2 are the visible rail ends.
  const EDGES = [
    { id: 'src>watcher', p1: [COL[0] + CW, Y1], p2: [COL[1], Y1] },
    { id: 'watcher>gate', p1: [COL[1] + CW, Y1], p2: [COL[2], Y1] },
    { id: 'gate>drafter', p1: [COL[2] + CW, Y1], p2: [COL[3], Y1] },
    { id: 'drafter>owner', p1: [COL[3] + 70, R1 + CH], p2: [COL[3] + 70, R2] },
    { id: 'owner>handoff', p1: [COL[3], Y2], p2: [COL[2] + CW, Y2] },
    { id: 'handoff>triage', p1: [COL[2], Y2], p2: [COL[1] + CW, Y2] },
    { id: 'owner>drafter', p1: [COL[3] + 124, R2], p2: [COL[3] + 124, R1 + CH], kind: 'return', label: ['Edit,', 're-check'], lp: [COL[3] + 133, BUS - 4], anchor: 'start' },
    { id: 'triage>owner', p1: [COL[1] + CW / 2, R2 + CH], p2: [COL[3] + CW / 2, R2 + CH], kind: 'return', label: ['Reply needs you'], lp: [COL[2] + CW / 2, R2 + CH + 17], anchor: 'middle' },
  ];
  for (const e of EDGES) { [e.a, e.b] = e.id.split('>'); e.kind = e.kind || 'main'; }
  const EDGE = Object.fromEntries(EDGES.map((e) => [e.id, e]));
  function edgePath(e) {
    const [x1, y1] = e.p1, [x2, y2] = e.p2;
    if (e.id === 'triage>owner') return `M${x1},${y1} C${x1},${y1 + 38} ${x2},${y2 + 38} ${x2},${y2 + 4}`;
    const dx = Math.sign(x2 - x1), dy = Math.sign(y2 - y1); // stop 4px short so the arrowhead meets the card edge
    return `M${x1},${y1} L${x2 - dx * 4},${y2 - dy * 4}`;
  }
  // Shortest route over the directed connectors (BFS).
  function route(from, to) {
    if (!from || !to || from === to) return [];
    const prev = { [from]: null }, q = [from];
    while (q.length) { const n = q.shift(); if (n === to) break; for (const e of EDGES) if (e.a === n && !(e.b in prev)) { prev[e.b] = e; q.push(e.b); } }
    if (!(to in prev)) return [];
    const out = []; for (let n = to; prev[n]; n = prev[n].a) out.unshift(prev[n].id); return out;
  }

  let root, frame, sizer, stage, links, fx, nodesEl, hubEl, toolbar, H_ = {};
  let inset = 0, focusNode = null, ST = null, fit = false, scale = 1, sel = null, prevLoc = null, lastSeq = 0, liveTimers = [], pulses = [], raf = 0, hidden = new Set();
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function mount(container, handlers) {
    H_ = handlers;
    container.innerHTML = `<div class="cv" id="cv" role="region" aria-label="Workflow canvas: estimate follow-up">
      <div class="cv-frame" id="cvFrame"><div class="cv-sizer" id="cvSizer"><div class="cv-stage" id="cvStage" style="width:${W}px;height:${H}px">
        <svg class="cv-links" id="cvLinks" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"></svg>
        <div class="cv-nodes" id="cvNodes"></div>
        <div class="cv-hub" id="cvHub" style="left:${HUB.x}px;top:${HUB.y}px;width:${HUB.w}px;height:${HUB.h}px"></div>
        <svg class="cv-fx" id="cvFx" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs><filter id="glow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="3.2"/></filter></defs><g id="cvFxG"></g></svg>
      </div></div></div>
      <button type="button" class="cv-more" data-more data-k="more">More ${icon('arrow', 14)}</button>
      <div class="cv-bar" id="cvBar"></div></div>`;
    root = container.querySelector('#cv'); frame = root.querySelector('#cvFrame'); sizer = root.querySelector('#cvSizer'); stage = root.querySelector('#cvStage');
    links = root.querySelector('#cvLinks'); fx = root.querySelector('#cvFxG'); nodesEl = root.querySelector('#cvNodes'); hubEl = root.querySelector('#cvHub'); toolbar = root.querySelector('#cvBar');
    nodesEl.innerHTML = ORDER.map((k) => { const n = N[k], w = WORKERS[k]; return `<div class="nd nd-${k}${w.sim ? ' is-sim' : ''}" id="nd-${k}" data-node="${k}" style="--a:${w.accent};left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px"></div>`; }).join('');
    root.addEventListener('click', onClick);
    enablePan();
    new ResizeObserver(layout).observe(frame);
    window.addEventListener('resize', layout);
  }
  const isMounted = () => root && document.body.contains(root);

  // ---------- scaling / pan ----------
  function layout() {
    if (!isMounted()) return;
    // While the detail panel is docked, scale as if it were closed (never above 1, never below FLOOR) and pan instead,
    // so text never shrinks below the no-panel size.
    const cw = frame.clientWidth, natural = (cw + inset) / W;
    // Enlarge on big screens only while the whole canvas still fits the visible height.
    const scroller = root.closest('#view'), availH = scroller ? scroller.clientHeight - (root.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop) - toolbar.offsetHeight - 30 : Infinity;
    const cap = Math.max(1, Math.min(MAX, availH / H));
    const noPanel = Math.max(FLOOR, Math.min(cap, natural));
    scale = fit ? Math.min(cap, cw / W) : inset ? Math.max(FLOOR, Math.min(noPanel, 1)) : noPanel;
    const pans = W * scale > cw + 0.5;
    stage.style.transform = `scale(${scale})`;
    sizer.style.width = W * scale + 'px'; sizer.style.height = H * scale + 'px';
    root.classList.toggle('pans', pans);
    edges();
    root.style.setProperty('--cv-scale', scale);
    renderBar(pans || fit);
  }
  function edges() { const max = frame.scrollWidth - frame.clientWidth; root.classList.toggle('fade-l', frame.scrollLeft > 2); root.classList.toggle('fade-r', max - frame.scrollLeft > 2); }
  function enablePan() {
    frame.addEventListener('scroll', edges, { passive: true });
    let down = null;
    frame.addEventListener('pointerdown', (e) => { if (e.button !== 0 || e.target.closest('button,a,input,textarea') || !root.classList.contains('pans')) return; down = { x: e.clientX, s: frame.scrollLeft, moved: false, id: e.pointerId }; });
    frame.addEventListener('pointermove', (e) => { if (!down) return; const dx = e.clientX - down.x; if (!down.moved && Math.abs(dx) > 3) { down.moved = true; frame.setPointerCapture(down.id); root.classList.add('dragging'); } if (down.moved) frame.scrollLeft = down.s - dx; });
    const up = () => { down = null; root.classList.remove('dragging'); };
    frame.addEventListener('pointerup', up); frame.addEventListener('pointercancel', up);
  }

  // ---------- derived facts ----------
  const runsAt = (k) => ST.runs.filter((r) => locOf(r) === k);
  const quoteOf = (r) => ST.quotes.find((q) => q.id === r.quoteId);
  const nameOf = (r) => { const q = quoteOf(r); return `${q.client.first} ${q.client.last}`; };
  const initials = (r) => { const q = quoteOf(r); return (q.client.first[0] + q.client.last[0]).toUpperCase(); };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (n) => (n == null ? 'no total' : '$' + n.toLocaleString('en-US'));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  function tok(r, mini) {
    const q = quoteOf(r), why = r.stopReason || r.exception?.code || '';
    const label = `${nameOf(r)}, ${q.id}, ${STATE_LABEL[r.state]}${why ? ': ' + why : ''}${r.paused ? ', paused' : ''}`;
    const c = TONE_VAR[STATE_TONE[r.state]];
    return `<button type="button" class="tok${mini ? ' mini' : ''}${r.paused ? ' is-paused' : ''}${sel === r.id ? ' is-sel' : ''}${hidden.has(r.id) ? ' is-pending' : ''}" data-run="${r.id}" data-k="tok:${r.id}" style="--c:${c}" aria-label="${esc(label)}" title="${esc(label)}">${mini ? initials(r) : `<span class="tok-i">${initials(r)}</span><span class="tok-id">${q.id.slice(2)}</span>`}</button>`;
  }
  // Tokens for a group: up to `max` shown; beyond that, max-1 plus "+N".
  function toks(list, max = 3) {
    if (!list.length) return '';
    const show = list.length > max ? list.slice(0, max - 1) : list, more = list.length - show.length;
    return show.map((r) => tok(r, true)).join('') + (more ? `<button type="button" class="tok-more" data-go="quotes" data-k="more:${list[0].id}" aria-label="${more} more, open Quotes and runs">+${more}</button>` : '');
  }
  // One row: dot, label, count on the left; the runs themselves on the right.
  function grp(label, list, tone, { max = 3, zero = false } = {}) {
    if (!list.length && !zero) return '';
    return `<div class="grp" data-grp="${esc(label)}" data-count="${list.length}"><span class="grp-l"><i style="background:${TONE_VAR[tone]}"></i>${label}<b class="num">${list.length}</b></span><span class="grp-t">${toks(list, max)}</span></div>`;
  }
  const kv = (l, v) => `<div class="kv2"><span>${l}</span><b class="num">${v}</b></div>`;
  // Calm status vocabulary: Idle, Waiting on you, Needs attention, Done (plus Paused, a real engine state), each with a count.
  function status(word, tone, detail = '') { return `<div class="nd-status" data-status="${word}"><i style="background:${TONE_VAR[tone]}"></i>${word === 'Paused' ? icon('pause', 12) : ''}<b>${word}</b>${detail ? `<span class="num">${detail}</span>` : ''}</div>`; }
  function head(k) { const w = WORKERS[k]; return `<div class="nd-head">${badge(k, 'sm')}<button type="button" class="nd-name" data-worker="${k}" data-k="w:${k}" title="${esc(w.role)}">${w.name}</button></div><div class="nd-type">${w.typeShort || w.type}</div>`; }
  const lastEvent = (pred) => ST.audit.find(pred); // audit is newest-first
  const clockShort = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

  function nodeHtml(k) {
    const runs = ST.runs, paused = ST.paused;
    if (k === 'src') {
      const un = ST.quotes.filter((q) => !q.swept).length;
      return `<div class="nd-head">${badge('src', 'sm')}<span class="nd-name nd-src-name">Sample Jobber</span></div><div class="nd-type">Simulated source</div>
        <div class="nd-status" data-status="Not connected"><i class="dash"></i><b>Not connected</b></div>
        <div class="nd-body"><span class="chip sim nd-simchip">SIMULATED</span><div class="nd-bigrow"><span class="nd-big num">${ST.quotes.length}</span><span>sample quotes,<br>all made up</span></div><div class="nd-cap">${un ? `${un} not scanned yet` : 'All scanned'}</div></div>`;
    }
    if (k === 'watcher') {
      const sw = lastEvent((e) => e.action === 'sweep.started'), skipped = ST.audit.filter((e) => e.action === 'quote.skipped').length;
      const st = paused ? status('Paused', 'wait', 'no scans') : sw ? status('Done', 'ok', plural(runs.length, 'run')) : status('Idle', 'mut');
      return `${head(k)}${st}<div class="nd-body">${sw ? `${kv('Last scan', clockShort(sw.ts))}${kv('Quotes read', sw.detail.quotes)}${kv('Runs created', runs.length)}${kv('Skipped', skipped)}<div class="nd-cap">From sample data</div>` : '<p class="nd-empty">No scan yet. Reads the sample quotes, not Jobber.</p>'}</div>
        ${grp('Scanning', runs.filter((r) => r.state === 'detected'), 'live')}`;
    }
    if (k === 'gate') {
      const at = runsAt('gate'), hold = at.filter((r) => r.state === 'holdout');
      const policy = at.filter((r) => r.state === 'needs_attention' || (r.state === 'stopped' && stoppedByPolicy(r)));
      const inelig = at.filter((r) => r.state === 'stopped' && !stoppedByPolicy(r));
      const passed = runs.filter((r) => r.arm === 'treatment').length, total = passed + at.length;
      const attn = at.filter((r) => r.state === 'needs_attention').length;
      const st = attn ? status('Needs attention', 'attn', attn) : runs.length ? status('Done', 'ok', `${total} checked`) : status('Idle', 'mut');
      const seg = (n, c, l) => n ? `<span style="flex:${n};background:${c}" title="${l}: ${n}"></span>` : '';
      return `${head(k)}${st}<div class="nd-body">${total ? `<div class="segbar" role="img" aria-label="${passed} passed, ${hold.length} holdout, ${inelig.length} not eligible, ${policy.length} blocked by policy">${seg(passed, 'var(--st-ok)', 'Passed')}${seg(hold.length, 'var(--w-gate)', 'Holdout')}${seg(inelig.length, 'var(--t3)', 'Not eligible')}${seg(policy.length, 'var(--st-bad)', 'Blocked by policy')}</div>
        <div class="grp"><span class="grp-l"><i style="background:var(--st-ok)"></i>Passed<b class="num">${passed}</b></span></div>${grp('Holdout', hold, 'hold', { zero: true })}${grp('Not eligible', inelig, 'mut', { zero: true })}${grp('Policy block', policy, 'attn', { zero: true })}` : '<p class="nd-empty">Checks eligibility, consent and holdout for every run.</p>'}</div>`;
    }
    if (k === 'drafter') {
      const at = runsAt('drafter'), withDraft = runs.filter((r) => r.draft);
      const refused = at.filter((r) => r.exception?.code === 'missing_total'), failed = at.filter((r) => r.exception?.code !== 'missing_total');
      const le = lastEvent((e) => e.action === 'draft.created' || e.action === 'draft.edited');
      const lr = le && runs.find((r) => 'run:' + r.id === le.entity && r.draft);
      const st = at.length ? status('Needs attention', 'attn', at.length) : withDraft.length ? status('Done', 'ok', plural(withDraft.length, 'draft')) : status('Idle', 'mut');
      let body = '<p class="nd-empty">Fixed template. No AI model yet.</p>';
      if (lr) {
        const v = lr.draft.validation, fails = v.checks.filter((c) => !c.ok).length, tight = refused.length && failed.length;
        body = `<div class="nd-cap">Latest v${lr.draft.version} · no AI model yet</div>${tight ? '' : `<blockquote class="excerpt">${esc(lr.draft.text)}</blockquote>`}
          <div class="vstat ${v.ok ? 'ok' : 'no'}">${icon(v.ok ? 'check' : 'x', 14)}${v.ok ? `${v.checks.length}/${v.checks.length} checks pass` : `${fails} of ${v.checks.length} checks failed`}</div>`;
      }
      return `${head(k)}${st}<div class="nd-body">${body}</div>${grp('Refused: no total', refused, 'attn')}${grp('Failed checks', failed, 'attn')}`;
    }
    if (k === 'owner') {
      const at = runsAt('owner'), pend = at.filter((r) => r.state === 'awaiting_approval'), reply = at.filter((r) => r.state === 'needs_owner');
      const decided = at.filter((r) => r.state === 'rejected' || r.state === 'closed_handled');
      const waiting = pend.length + reply.length;
      const st = paused && waiting ? status('Paused', 'wait', `${waiting} waiting`) : waiting ? status('Waiting on you', 'wait', waiting) : decided.length || runs.some((r) => r.approval) ? status('Done', 'ok', `${runs.filter((r) => r.approval).length + at.filter((r) => r.state === 'rejected').length} decided`) : status('Idle', 'mut');
      let body = '<p class="nd-empty">Nothing waiting. Every outbound message needs your approval of its exact text.</p>';
      const top = pend[0] || reply[0], rest = [...pend, ...reply].filter((r) => r !== top), tight = rest.length && decided.length;
      if (top) {
        const q = quoteOf(top), isPend = top.state === 'awaiting_approval';
        const why = ST.paused ? 'Global pause is on' : top.paused ? 'This run is paused' : '';
        body = `<div class="ptop"><div class="ptop-hd">${tok(top)}<span class="ptop-amt num">${money(q.total)}</span></div>
          ${tight ? '' : `<div class="ptop-txt">${esc(isPend ? top.draft.text : '“' + (top.reply?.text || '') + '”')}</div>`}
          <div class="ptop-acts">${isPend ? `<button type="button" class="btn primary sm" data-approve="${top.id}" data-k="ap:${top.id}" ${why ? `disabled title="${why}"` : ''} aria-label="Approve draft for ${esc(nameOf(top))}">Approve</button>` : ''}<button type="button" class="btn sm" data-open="${top.id}" data-k="op:${top.id}" aria-label="Open ${esc(nameOf(top))}">Open</button></div></div>`;
      }
      return `${head(k)}${st}<div class="nd-body">${body}</div>${grp('Waiting', rest, 'wait')}${grp('Decided', decided, 'mut')}`;
    }
    if (k === 'handoff') {
      const at = runsAt('handoff'), sim = ST.audit.filter((e) => e.action === 'handoff.simulated'), last = sim[0];
      const st = sim.length ? status('Done', 'ok', `${sim.length} simulated`) : status('Idle', 'mut');
      return `${head(k)}${st}<div class="nd-body"><div class="nd-off">${icon('lock', 14)}Sending disabled</div>${kv('Actually sent', 0)}${kv('Simulated hand-offs', sim.length)}${last ? `<div class="kv2" title="SHA-256 prefix of the last approved text"><span>Text hash</span><b class="mono hash">${last.detail.textHash.slice(0, 6)}</b></div>` : ''}</div>
        ${grp('Here now', at, 'sim')}`;
    }
    if (k === 'triage') {
      const at = runsAt('triage'), all = ST.audit.filter((e) => e.action === 'reply.triaged'), lr = all[0];
      const lrun = lr && runs.find((r) => 'run:' + r.id === lr.entity);
      const sup = at.filter((r) => r.state === 'stopped'), dec = at.filter((r) => r.state === 'closed_declined');
      const st = all.length ? status('Done', 'ok', `${all.length} triaged`) : status('Idle', 'mut');
      return `${head(k)}${st}<div class="nd-body">${lrun?.reply ? `<div class="nd-cap">Simulated: <b class="tri-label">${esc(lrun.reply.label.replace('_', '-'))}</b></div><blockquote class="excerpt${sup.length && dec.length ? ' one' : ''}">“${esc(lrun.reply.text)}”</blockquote>` : '<p class="nd-empty">No replies. Replies are typed by you in this demo; no AI model yet.</p>'}</div>
        ${grp('Suppressed', sup, 'attn')}${grp('Declined', dec, 'mut')}`;
    }
  }

  function hubHtml() {
    const runs = ST.runs;
    const policy = runs.filter((r) => (r.state === 'needs_attention' && COMPLIANCE.includes(r.exception?.code)) || (r.state === 'stopped' && stoppedByPolicy(r))).length;
    const inelig = runs.filter((r) => r.state === 'stopped' && !stoppedByPolicy(r)).length;
    const vfail = runs.filter((r) => r.draft && !r.draft.validation.ok).length;
    const f = (l, v, key, cls = '') => `<div class="kv2 ${cls}" data-hub="${key}"><span>${l}</span><b class="num">${v}</b></div>`;
    return `<div class="hub-hd"><span class="hub-mark">${BRAND_MARK}</span><div><div class="hub-title">Policy layer</div><div class="hub-sub">For every worker</div></div></div>
      <ul class="hub-rules"><li>Approval for all outbound</li><li>SMS consent, no opt-out</li><li>Max 2 follow-ups a quote</li></ul>
      <div class="hub-facts">${f('Global pause', ST.paused ? 'On' : 'Off', 'pause', ST.paused ? 'is-wait' : '')}${f('Blocked by policy', policy, 'policy')}${f('Not eligible', inelig, 'inelig')}${f('Validation failures', vfail, 'vfail')}</div>`;
  }

  function linksHtml(trace) {
    const acc = (k) => WORKERS[k].accent;
    let defs = '<defs>', body = '';
    // Policy bus: one line from the hub through the gap between the tiers, with a tap to every worker.
    const hx = HUB.x + HUB.w / 2, end = COL[3] + TAP, dim = trace ? ' dim' : '';
    body += `<path class="bus${ST.paused ? ' is-paused' : ''}${dim}" d="M${hx},${HUB.y} L${hx},${BUS + 10} Q${hx},${BUS} ${hx + 10},${BUS} L${end},${BUS}"/>`;
    for (const k of ORDER.slice(1)) {
      const n = N[k], x = n.x + TAP, top = n.y < BUS, y = top ? n.y + n.h : n.y, blockedByPause = ST.paused && (k === 'watcher' || k === 'owner');
      body += `<path class="bus tap${blockedByPause ? ' is-paused' : ''}${dim}" d="M${x},${BUS} L${x},${y}"/><circle class="tether-port${blockedByPause ? ' is-paused' : ''}${dim}" cx="${x}" cy="${y}" r="3"/>`;
    }
    for (const e of EDGES) {
      const key = e.a + '-' + e.b;
      defs += `<linearGradient id="lg-${key}" gradientUnits="userSpaceOnUse" x1="${e.p1[0]}" y1="${e.p1[1]}" x2="${e.p2[0]}" y2="${e.p2[1] + (e.p1[1] === e.p2[1] ? 0.01 : 0)}"><stop offset="0" style="stop-color:${acc(e.a)}"/><stop offset="1" style="stop-color:${acc(e.b)}"/></linearGradient>`;
      defs += `<marker id="mk-${key}" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4.4" markerHeight="4.4" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M1,1.2 L8.5,5 L1,8.8 z" style="fill:${acc(e.b)}"/></marker>`;
      const on = trace ? trace.edges.has(e.id) : false;
      body += `<path class="edge edge-${e.kind}${trace ? (on ? ' is-on' : ' dim') : ''}" id="edge-${key}" data-edge="${e.id}" d="${edgePath(e)}" style="stroke:url(#lg-${key})" marker-end="url(#mk-${key})"/>`;
      if (e.label) body += `<text class="edge-label${trace && !on ? ' dim' : ''}" x="${e.lp[0]}" y="${e.lp[1]}" text-anchor="${e.anchor}">${e.label.map((l, i) => `<tspan x="${e.lp[0]}" dy="${i ? 16 : 0}">${l}</tspan>`).join('')}</text>`;
    }
    return defs + '</defs>' + body;
  }

  function renderBar(showFit) {
    if (!toolbar || !ST) return;
    const t = sel && ST.runs.find((r) => r.id === sel);
    const lg = (l, c) => `<span class="lg"><i style="background:${c}"></i>${l}</span>`;
    toolbar.innerHTML = `<div class="bar-legend" aria-label="Legend">${lg('Waiting on you', 'var(--st-wait)')}${lg('Needs attention', 'var(--st-bad)')}${lg('Done', 'var(--st-ok)')}${lg('Idle', 'var(--t3)')}${lg('Acted in last 4s (glow)', 'var(--st-live)')}<span class="lg"><i class="lg-dash"></i>Simulated</span></div>
      <div class="bar-mid">${t ? `<span class="bar-trace">${icon('trace', 16)}Tracing <b>${esc(nameOf(t))}</b> · ${t.quoteId}</span><button type="button" class="btn ghost sm" data-clear-trace data-k="cleartrace">Clear</button><span class="bar-sep" aria-hidden="true"></span>` : ''}<span class="num" data-runcount>${ST.runs.length} run${ST.runs.length === 1 ? '' : 's'}</span></div>
      <div class="bar-right">${showFit ? `<button type="button" class="btn ghost sm" data-fit data-k="fit" aria-pressed="${fit}">${icon('fit', 16)}${fit ? 'Readable size' : 'Fit'}</button>` : ''}</div>`;
  }

  // ---------- trace ----------
  function traceOf(runId) {
    const evs = ST.audit.filter((e) => e.entity === 'run:' + runId).slice().reverse();
    const locs = ['src', 'watcher'];
    for (const e of evs) if (e.action === 'run.state') { const l = locOfTransition(e.detail.to, e.detail.why); if (l !== locs[locs.length - 1]) locs.push(l); }
    const edges = new Set(), nodes = new Set(['src']);
    for (let i = 1; i < locs.length; i++) for (const id of route(locs[i - 1], locs[i])) { edges.add(id); nodes.add(EDGE[id].a); nodes.add(EDGE[id].b); }
    return { edges, nodes };
  }

  // ---------- render ----------
  function update(state) {
    ST = state; if (!isMounted()) return;
    const trace = sel && ST.runs.find((r) => r.id === sel) ? traceOf(sel) : null;
    if (!trace) sel = null;
    const motion = diffMotion();
    links.innerHTML = linksHtml(trace);
    for (const k of ORDER) {
      const el = nodesEl.querySelector('#nd-' + k);
      el.innerHTML = nodeHtml(k);
      el.classList.toggle('dim', !!trace && !trace.nodes.has(k));
      el.classList.toggle('on-trace', !!trace && trace.nodes.has(k));
      const waiting = k === 'owner' && ST.runs.some((r) => r.state === 'awaiting_approval' || r.state === 'needs_owner');
      el.classList.toggle('is-wait', waiting);
      el.classList.toggle('is-focus', k === focusNode);
    }
    hubEl.innerHTML = hubHtml();
    hubEl.classList.toggle('is-paused', ST.paused);
    hubEl.classList.toggle('dim', !!trace);
    root.classList.toggle('is-paused', ST.paused);
    root.classList.toggle('tracing', !!trace);
    applyLive();
    layout();
    if (motion) play(motion);
  }

  // Nodes glow only if their worker acted in the last 4 seconds (from audit timestamps).
  function applyLive() {
    liveTimers.forEach(clearTimeout); liveTimers = [];
    const now = Date.now(), until = {};
    for (const e of ST.audit) { const age = now - Date.parse(e.ts); if (age > 4000) break; const k = ACTOR_WORKER[e.actor]; if (k && N[k] && !(k in until)) until[k] = 4000 - age; }
    for (const k of ORDER) {
      const el = nodesEl.querySelector('#nd-' + k), ms = until[k];
      el.classList.toggle('is-live', ms > 0);
      if (ms > 0) liveTimers.push(setTimeout(() => el.classList.remove('is-live'), ms));
    }
  }

  // Compare to the previous snapshot: which runs moved, and along which connectors.
  function diffMotion() {
    const cur = Object.fromEntries(ST.runs.map((r) => [r.id, locOf(r)]));
    const maxSeq = ST.audit.length ? ST.audit[0].seq : 0;
    const first = prevLoc === null || maxSeq < lastSeq; // first paint or reset: no motion
    const moved = [];
    if (!first) for (const r of ST.runs) { const from = prevLoc[r.id] || 'src', to = cur[r.id]; if (from !== to) { const hops = route(from, to); if (hops.length) moved.push({ id: r.id, hops }); } }
    prevLoc = cur; lastSeq = maxSeq;
    if (!moved.length || reduce()) return null;
    return moved;
  }
  // Choreography: hops play in order per run; runs are staggered so a full scan finishes in about 3s.
  function play(moved) {
    const HOP = 300, longest = Math.max(...moved.map((m) => m.hops.length)) * HOP;
    const stagger = moved.length > 1 ? Math.max(40, Math.min(220, (3000 - longest) / (moved.length - 1))) : 0;
    moved.forEach((m, i) => {
      hidden.add(m.id); setPending(m.id, true);
      m.hops.forEach((id, j) => pulses.push({ id, run: m.id, t0: performance.now() + i * stagger + j * HOP, dur: HOP, last: j === m.hops.length - 1 }));
    });
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function setPending(runId, on) { root.querySelectorAll(`.tok[data-run="${runId}"]`).forEach((t) => t.classList.toggle('is-pending', on)); }
  function tick(now) {
    fx.innerHTML = '';
    const lit = new Set();
    pulses = pulses.filter((p) => {
      const k = (now - p.t0) / p.dur;
      if (k < 0) return true;
      if (k >= 1) { if (p.last) { hidden.delete(p.run); setPending(p.run, false); arrive(p.run); } return false; }
      const path = links.querySelector(`[data-edge="${p.id}"]`); if (!path) return false;
      const L = path.getTotalLength(), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2, pt = path.getPointAtLength(L * e);
      const tail = path.getPointAtLength(Math.max(0, L * e - 14));
      const c = WORKERS[EDGE[p.id].b].accent;
      fx.insertAdjacentHTML('beforeend', `<line x1="${tail.x}" y1="${tail.y}" x2="${pt.x}" y2="${pt.y}" class="trail" style="stroke:${c}"/><circle cx="${pt.x}" cy="${pt.y}" r="7" class="pulse-glow" style="fill:${c}" filter="url(#glow)"/><circle cx="${pt.x}" cy="${pt.y}" r="3.2" class="pulse-core"/>`);
      lit.add(p.id); return true;
    });
    links.querySelectorAll('.edge').forEach((el) => el.classList.toggle('is-active', lit.has(el.dataset.edge)));
    if (pulses.length) raf = requestAnimationFrame(tick); else { raf = 0; fx.innerHTML = ''; }
  }
  function arrive(runId) { root.querySelectorAll(`.tok[data-run="${runId}"]`).forEach((t) => { t.classList.remove('arrive'); void t.offsetWidth; t.classList.add('arrive'); setTimeout(() => t.classList.remove('arrive'), 700); }); }

  function onClick(e) {
    const t = e.target.closest('button'); if (!t || !root.contains(t)) return;
    if (t.dataset.run) { H_.openRun(t.dataset.run); return; }
    if (t.dataset.approve) { H_.approve(t.dataset.approve); return; }
    if (t.dataset.open) { H_.openRun(t.dataset.open); return; }
    if (t.dataset.worker) { H_.worker(t.dataset.worker); return; }
    if (t.dataset.go) { H_.go(t.dataset.go); return; }
    if ('fit' in t.dataset) { fit = !fit; layout(); return; }
    if ('more' in t.dataset) { frame.scrollTo({ left: frame.scrollWidth, behavior: reduce() ? 'auto' : 'smooth' }); return; }
    if ('clearTrace' in t.dataset) { H_.clearTrace(); return; }
  }
  function setInset(px) { inset = px || 0; }
  // Scroll the canvas so a node and its neighbours sit in the visible part of the frame.
  function reveal(key) {
    if (!isMounted() || !key || !N[key]) return;
    layout();
    const cx = (N[key].x + N[key].w / 2) * scale, max = frame.scrollWidth - frame.clientWidth;
    if (max <= 0) return;
    frame.scrollTo({ left: Math.max(0, Math.min(max, cx - frame.clientWidth / 2)), behavior: reduce() ? 'auto' : 'smooth' });
  }
  function markNode(key) { focusNode = key || null; if (!isMounted()) return; nodesEl.querySelectorAll('.nd').forEach((n) => n.classList.toggle('is-focus', n.dataset.node === focusNode)); }
  function select(runId) { if (sel === runId) return; sel = runId || null; if (ST && isMounted()) update(ST); }
  function forget() { prevLoc = null; }
  return { mount, update, select, setInset, reveal, markNode, isMounted, layout, forget, get selected() { return sel; }, get scale() { return scale; }, W, H, FLOOR, N, EDGES, route };
})();
