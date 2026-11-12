// Shared, read-only interpretation of state: plain-English audit summaries and per-worker facts.
// Used by the detail panel (Trace tab, worker view), the Activity view and the Workers page.
const STATE_HUMAN = {
  detected: 'detected', stopped: 'stopped', needs_attention: 'needs attention', holdout: 'holdout (observed only)',
  awaiting_approval: 'awaiting approval', handed_off: 'handed off (simulated)', rejected: 'rejected',
  needs_owner: 'reply needs you', closed_declined: 'closed: client declined', closed_handled: 'closed: handled',
};
const CODE_HUMAN = { no_consent: 'no SMS consent on file', opted_out: 'client opted out', cap: 'follow-up cap reached', missing_total: 'quote total is missing', validation_failed: 'draft fails validation', reply_needs_you: 'reply needs a person' };
const escE = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Who/what an event is about: "Marcus Webb · Q-1041", or null for tenant-level events.
function subjectOf(e, st) {
  let qid = null;
  if (e.entity.startsWith('run:')) { const r = st.runs.find((x) => 'run:' + x.id === e.entity); qid = r ? r.quoteId : 'Q-' + e.entity.slice(6); }
  else if (e.entity.startsWith('quote:')) qid = e.entity.slice(6);
  if (!qid) return null;
  const q = st.quotes.find((x) => x.id === qid);
  return q ? `${q.client.first} ${q.client.last} · ${q.id}` : qid;
}
// One plain-English line per audit event. Plain text (escaped by the caller).
function summarize(e, owner = 'the owner') {
  const d = e.detail || {};
  switch (e.action) {
    case 'demo.reset': return 'Demo reset; sample data restored and the previous log discarded';
    case 'sweep.started': return `Scanned ${d.quotes} sample quotes (simulated Jobber, not connected)`;
    case 'sweep.refused': return 'Scan refused: global pause is on';
    case 'quote.skipped': return `Skipped: ${d.reason}`;
    case 'quote.detected': return `Found a sent quote, ${d.ageDays} days old`;
    case 'eligibility.failed': return `Not eligible: ${d.reason}`;
    case 'eligibility.passed': return 'Eligibility passed (3 to 60 days old, not opted out, under the cap)';
    case 'compliance.blocked': return `Blocked by policy: ${CODE_HUMAN[d.code] || d.code}`;
    case 'arm.assigned': return d.arm === 'holdout' ? `Assigned to holdout (bucket ${d.bucket} of 100): observed only, no message` : `Assigned to treatment (bucket ${d.bucket} of 100)`;
    case 'draft.refused': return `Refused to draft: ${d.reason}`;
    case 'draft.created': return `Wrote draft v${d.version} from a fixed template (no AI model)`;
    case 'draft.validated': return d.ok ? 'Draft passed all validation checks' : `Draft failed ${d.failed.length} check${d.failed.length === 1 ? '' : 's'}: ${d.failed.join(', ')}`;
    case 'approval.requested': return `Asked ${owner} to approve the exact text`;
    case 'draft.edited': return `Edited the draft (now v${d.version})${d.approvalInvalidated ? '; the earlier approval was cleared' : ''}`;
    case 'draft.approved': return `Approved draft v${d.version}; text hash ${d.textHash.slice(0, 8)}`;
    case 'handoff.simulated': return 'Simulated hand-off: nothing was sent';
    case 'draft.rejected': return `Rejected: “${d.reason}”`;
    case 'run.paused': return 'Paused this run';
    case 'run.resumed': return 'Resumed this run';
    case 'system.paused': return 'Paused all work';
    case 'system.resumed': return 'Resumed all work';
    case 'reply.simulated': return `Typed a simulated client reply: “${d.text}”`;
    case 'reply.triaged': return `Labelled the reply “${String(d.label).replace('_', '-')}” (keyword rules, no AI model)`;
    case 'suppression.added': return `Suppressed the client: ${d.reason}`;
    case 'reply.handled': return 'Marked the reply handled';
    case 'run.state': return `State: ${STATE_HUMAN[d.from] || d.from} → ${STATE_HUMAN[d.to] || d.to}${d.why ? ` (${CODE_HUMAN[d.why] || d.why})` : ''}`;
    default: return e.action;
  }
}
// Structured detail for the expanded view: every stored field, nothing invented.
function detailRows(e) {
  const rows = [['action', e.action], ['entity', e.entity], ['seq', '#' + e.seq], ['time', e.ts]];
  for (const [k, v] of Object.entries(e.detail || {})) rows.push([k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
  rows.push(['hash', e.hash.slice(0, 16) + '…'], ['prev', e.prev === 'genesis' ? 'genesis' : e.prev.slice(0, 16) + '…']);
  return rows;
}
// Attach each run.state event to the event that caused it (the nearest earlier event on the same entity),
// so state changes are shown as a transition tag rather than as duplicate rows. Input: newest-first.
function groupEvents(list) {
  const chrono = list.slice().reverse(), out = [], lastFor = {};
  for (const e of chrono) {
    const prev = lastFor[e.entity];
    if (e.action === 'run.state' && prev) { prev.states.push(e); continue; }
    const g = { e, states: [] }; out.push(g); lastFor[e.entity] = g;
  }
  return out.reverse();
}

// What each worker does, honestly split into real / simulated / cannot.
const WORKER_DOC = {
  watcher: ['Find quotes that were sent but not approved. Create one workflow run per quote.', 'Scan logic and run creation are real code.', 'Reads the 12 sample quotes, not Jobber. Real build: webhooks plus a reconciliation poll.', 'Cannot contact clients or change quotes.'],
  gate: ['Check eligibility (3 to 60 days old, under 2 follow-ups), consent and opt-out, assign treatment or holdout, validate every draft, block unsafe approvals.', 'All rules, the seeded holdout hash and the validation checks are real code.', 'Consent flags are sample data. Holdout is a seeded hash without stratification. Quiet hours not built.', 'Cannot be overridden by the Drafter or by a model.'],
  drafter: ['Write one short follow-up per eligible quote using only the quote total and service.', 'Produces and versions real drafts; edits are tracked.', 'No language model is called. Text comes from a fixed template, so draft quality here says nothing about AI quality.', 'Cannot send, approve, or decide eligibility.'],
  owner: ['Approve, edit or reject the exact text. Pause one run or everything.', 'Real controls. Approval stores a hash of the exact text; any edit clears it.', 'You are the only approver in this slice; no roles.', 'Nothing proceeds without it.'],
  handoff: ['Where a real send would occur after approval.', 'The approved-text hash check is real.', 'Does not send anything. Records “handoff.simulated”.', 'No SMS or email integration exists.'],
  triage: ['Label a reply: opt-out, declined, interested, question, unclear. STOP suppresses the client.', 'Rules, suppression and routing to you are real.', 'Replies are typed by you in the demo; there is no inbox.', 'Cannot answer a client.'],
};
// Current real counts per worker, derived from state only.
function workerFacts(k, st) {
  const R = st.runs, n = (f) => R.filter(f).length, A = st.audit, ev = (a) => A.filter((e) => e.action === a);
  const sweep = ev('sweep.started')[0];
  switch (k) {
    case 'watcher': return [['Last scan', sweep ? new Date(sweep.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : 'never'], ['Quotes read', sweep ? sweep.detail.quotes : 0], ['Runs created', R.length], ['Skipped', ev('quote.skipped').length], ['Not scanned yet', st.quotes.filter((q) => !q.swept).length]];
    case 'gate': return [['Passed', n((r) => r.arm === 'treatment')], ['Holdout', n((r) => r.state === 'holdout')], ['Not eligible', n((r) => r.state === 'stopped' && !stoppedByPolicy(r))], ['Blocked by policy', n((r) => (r.state === 'needs_attention' && COMPLIANCE.includes(r.exception?.code)) || (r.state === 'stopped' && stoppedByPolicy(r)))], ['Validation failures', n((r) => r.draft && !r.draft.validation.ok)]];
    case 'drafter': return [['Drafts written', n((r) => r.draft)], ['Edited by owner', n((r) => r.draft?.editedBy)], ['Refused (no total)', n((r) => r.exception?.code === 'missing_total')], ['Failing checks', n((r) => r.draft && !r.draft.validation.ok)]];
    case 'owner': return [['Waiting on you', n((r) => r.state === 'awaiting_approval')], ['Replies needing you', n((r) => r.state === 'needs_owner')], ['Approved', n((r) => r.approval)], ['Rejected', n((r) => r.state === 'rejected')], ['Replies handled', n((r) => r.state === 'closed_handled')]];
    case 'handoff': return [['Actually sent', 0], ['Simulated hand-offs', ev('handoff.simulated').length], ['Sending', 'disabled']];
    case 'triage': return [['Replies triaged', ev('reply.triaged').length], ['Routed to you', n((r) => r.state === 'needs_owner' || r.state === 'closed_handled')], ['Suppressed (STOP)', n((r) => r.state === 'stopped' && r.stopReason === 'client replied STOP')], ['Declined', n((r) => r.state === 'closed_declined')]];
    default: return [];
  }
}
