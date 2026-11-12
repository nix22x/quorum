// Quorum vertical slice: zero-dependency Node server (Node 20+).
// Real here: state machine, validation, compliance gate, approval hashing, persisted state, hash-chained audit log.
// Simulated here: Jobber (sample data only), message sending (nothing is ever sent), drafting (template, no AI model), reply triage (keyword rules).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4300);
const DATA_FILE = process.env.QUORUM_DATA || path.join(ROOT, 'data', 'state.json');
const HOLDOUT_PCT = 25;
const SEED = 'quorum-demo-seed-1';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const DAY = 86400000;

// ---------- sample data (fictional business and clients) ----------
const TENANT = { name: 'Northgate Heating & Air', owner: 'Dana', currency: 'USD', sample: true };
function sampleQuotes(now = Date.now()) {
  const q = (id, first, last, service, total, ageDays, extra = {}) => ({
    id, client: { first, last, phone: '•••• ' + (1000 + (parseInt(sha(id).slice(0, 4), 16) % 9000)) },
    service, total, status: 'sent', sentAt: now - ageDays * DAY,
    consentSms: true, optedOut: false, handoffs: 0, swept: false, ...extra,
  });
  return [
    q('Q-1041', 'Marcus', 'Webb', 'Furnace replacement (96% AFUE)', 8450, 4),
    q('Q-1042', 'Priya', 'Raman', 'Heat pump install, 2 zones', 12900, 6),
    q('Q-1043', 'Tom', 'Okafor', 'Water heater swap, 50 gal', 2175, 3),
    q('Q-1044', 'Elena', 'Brandt', 'AC tune-up and duct seal', 685, 9),
    q('Q-1045', 'Jorge', 'Salinas', 'Boiler service plan', 420, 12),
    q('Q-1046', 'Hannah', 'Lindqvist', 'Bathroom re-pipe', 3980, 5),
    q('Q-1047', 'Wes', 'Calloway', 'Gas line to range', 760, 2),
    q('Q-1048', 'Aisha', 'Mbeki', 'Thermostat and zoning upgrade', 1890, 7, { consentSms: false }),
    q('Q-1049', 'Greg', 'Holloway', 'Furnace repair, blower motor', 940, 8, { optedOut: true }),
    q('Q-1050', 'Nina', 'Castellanos', 'Mini-split, single room', null, 10),
    q('Q-1051', 'Dev', 'Patel', 'Tankless water heater', 4720, 11, { status: 'approved' }),
    q('Q-1052', 'Sam', 'Reyes', 'Drain camera inspection', 310, 120),
  ];
}
function freshState() {
  return { version: 1, seed: SEED, paused: false, seq: 0, quotes: sampleQuotes(), runs: {}, audit: [] };
}

let S;
function load() {
  try { S = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { S = freshState(); save(); }
}
function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(S));
  fs.renameSync(tmp, DATA_FILE);
}

// ---------- audit log (append-only, hash-chained) ----------
function audit(actor, action, entity, detail = {}) {
  const prev = S.audit.length ? S.audit[S.audit.length - 1].hash : 'genesis';
  const e = { seq: ++S.seq, ts: new Date().toISOString(), actor, action, entity, detail, prev };
  e.hash = sha(prev + JSON.stringify([e.seq, e.ts, e.actor, e.action, e.entity, e.detail]));
  S.audit.push(e);
  return e;
}
function verifyChain() {
  let prev = 'genesis';
  for (const e of S.audit) {
    const h = sha(prev + JSON.stringify([e.seq, e.ts, e.actor, e.action, e.entity, e.detail]));
    if (e.prev !== prev || e.hash !== h) return { ok: false, brokenAt: e.seq, count: S.audit.length };
    prev = e.hash;
  }
  return { ok: true, count: S.audit.length };
}

// ---------- deterministic steps ----------
const money = (n) => '$' + n.toLocaleString('en-US');
const ageDays = (q) => Math.floor((Date.now() - q.sentAt) / DAY);
function assignArm(q) {
  const bucket = parseInt(sha(S.seed + ':' + q.id).slice(0, 8), 16) % 100;
  return { arm: bucket < HOLDOUT_PCT ? 'holdout' : 'treatment', bucket };
}
function eligibility(q) {
  const age = ageDays(q);
  if (q.status !== 'sent') return `quote status is "${q.status}", not "sent"`;
  if (age < 3) return `sent ${age} days ago; waiting period is 3 days`;
  if (age > 60) return `sent ${age} days ago; older than the 60-day window`;
  if (q.optedOut) return 'client has opted out';
  if (q.handoffs >= 2) return 'follow-up cap (2) reached';
  return null;
}
// Drafter: template-based. NO language model is called in this build.
function draftText(q) {
  const age = ageDays(q);
  const when = age <= 4 ? 'a few days ago' : `${age} days ago`;
  return `Hi ${q.client.first}, it's ${TENANT.owner} at ${TENANT.name}. Just checking in on the ${q.service.split(',')[0].toLowerCase()} quote I sent ${when} (${money(q.total)}). Happy to answer questions or adjust the scope. Reply STOP to opt out.`;
}
const BANNED = ['limited time', 'act now', 'guarantee', 'free money', 'last chance'];
function validate(text, q) {
  const checks = [];
  const add = (name, ok, msg) => checks.push({ name, ok, msg: ok ? 'ok' : msg });
  add('Length ≤ 320 characters', text.length <= 320, `${text.length} characters`);
  add('Contains opt-out text (STOP)', /\bSTOP\b/.test(text), 'missing "Reply STOP to opt out"');
  const amounts = [...text.matchAll(/\$\s?([\d,]+(?:\.\d{2})?)/g)].map((m) => Number(m[1].replace(/,/g, '')));
  add('Only states the real quote total', amounts.every((a) => a === q.total), `mentions ${amounts.map(money).join(', ')}; quote total is ${q.total == null ? 'unknown' : money(q.total)}`);
  add('No pressure or banned phrases', !BANNED.some((b) => text.toLowerCase().includes(b)), 'contains a banned phrase');
  add('No unresolved placeholders', !/[{}<>]|\[\w+\]/.test(text), 'contains {placeholder} or brackets');
  add('Not empty', text.trim().length > 0, 'empty');
  return { ok: checks.every((c) => c.ok), checks };
}
function gate(q) {
  if (!q.consentSms) return { ok: false, code: 'no_consent', message: 'No recorded SMS consent for this client. Quorum will not text them; the owner can follow up manually.' };
  if (q.optedOut) return { ok: false, code: 'opted_out', message: 'Client opted out (suppressed).' };
  if (q.handoffs >= 2) return { ok: false, code: 'cap', message: 'Follow-up cap reached.' };
  return { ok: true };
}
function triage(text) {
  const t = text.trim().toLowerCase();
  if (/^(stop|stopall|unsubscribe|cancel|end|quit)\b/.test(t)) return 'opt_out';
  if (/\b(not interested|no thanks|went with|already (hired|chose|booked)|found someone)\b/.test(t)) return 'declined';
  if (/\b(yes|yep|go ahead|let'?s do it|sounds good|book|schedule|approve|ready)\b/.test(t)) return 'interested';
  if (/\?|\b(price|cost|how much|when|discount|financing)\b/.test(t)) return 'question';
  return 'unclear';
}

// ---------- engine ----------
const E = (runId) => 'run:' + runId;
function setState(run, state, actor, why) {
  const from = run.state; run.state = state; run.updatedAt = Date.now();
  audit(actor, 'run.state', E(run.id), { from, to: state, ...(why ? { why } : {}) });
}
function sweep() {
  if (S.paused) { audit('system', 'sweep.refused', 'tenant', { reason: 'global pause is on' }); return { refused: true }; }
  audit('worker:watcher', 'sweep.started', 'tenant', { source: 'SAMPLE DATA (simulated Jobber, not connected)', quotes: S.quotes.length });
  let created = 0;
  for (const q of S.quotes) {
    if (q.swept) continue;
    q.swept = true;
    if (q.status !== 'sent') { audit('worker:watcher', 'quote.skipped', 'quote:' + q.id, { reason: `status is "${q.status}"` }); continue; }
    const id = 'R-' + q.id.slice(2);
    const run = { id, quoteId: q.id, state: 'detected', arm: null, draft: null, approval: null, paused: false, exception: null, reply: null, createdAt: Date.now(), updatedAt: Date.now() };
    S.runs[id] = run; created++;
    audit('worker:watcher', 'quote.detected', E(id), { quote: q.id, ageDays: ageDays(q) });
    const why = eligibility(q);
    if (why) { audit('worker:gatekeeper', 'eligibility.failed', E(id), { reason: why }); run.exception = null; run.stopReason = why; setState(run, 'stopped', 'worker:gatekeeper', why); continue; }
    audit('worker:gatekeeper', 'eligibility.passed', E(id), {});
    const g = gate(q);
    if (!g.ok) { run.exception = { code: g.code, message: g.message }; audit('worker:gatekeeper', 'compliance.blocked', E(id), { code: g.code }); setState(run, 'needs_attention', 'worker:gatekeeper', g.code); continue; }
    const a = assignArm(q); run.arm = a.arm;
    audit('worker:gatekeeper', 'arm.assigned', E(id), { arm: a.arm, bucket: a.bucket, holdoutPercent: HOLDOUT_PCT, method: 'seeded hash; stratification not implemented in this slice' });
    if (a.arm === 'holdout') { setState(run, 'holdout', 'worker:gatekeeper', 'observed only, no draft'); continue; }
    if (q.total == null) { run.exception = { code: 'missing_total', message: 'Quote total is missing in the source data, so a safe draft cannot be written.' }; audit('worker:drafter', 'draft.refused', E(id), { reason: 'missing total' }); setState(run, 'needs_attention', 'worker:drafter', 'missing_total'); continue; }
    const text = draftText(q);
    run.draft = { text, original: text, version: 1, validation: validate(text, q), editedBy: null };
    audit('worker:drafter', 'draft.created', E(id), { version: 1, method: 'template (no AI model called)', chars: text.length });
    audit('worker:gatekeeper', 'draft.validated', E(id), { ok: run.draft.validation.ok, failed: run.draft.validation.checks.filter((c) => !c.ok).map((c) => c.name) });
    setState(run, 'awaiting_approval', 'worker:drafter');
    audit('system', 'approval.requested', E(id), { approver: TENANT.owner + ' (owner)' });
  }
  save();
  return { created };
}
const need = (c, m) => { if (!c) { const e = new Error(m); e.status = 409; throw e; } };
const getRun = (id) => { const r = S.runs[id]; if (!r) { const e = new Error('no such run'); e.status = 404; throw e; } return r; };
const qOf = (run) => S.quotes.find((q) => q.id === run.quoteId);

function edit(id, text) {
  const run = getRun(id), q = qOf(run);
  need(['awaiting_approval', 'needs_attention'].includes(run.state) && run.draft, `cannot edit in state ${run.state}`);
  need(typeof text === 'string', 'text required');
  const before = run.draft.text;
  run.draft.text = text; run.draft.version++; run.draft.editedBy = TENANT.owner;
  run.draft.validation = validate(text, q);
  const hadApproval = !!run.approval; run.approval = null;
  audit('human:owner', 'draft.edited', E(id), { version: run.draft.version, before, after: text, approvalInvalidated: hadApproval });
  audit('worker:gatekeeper', 'draft.validated', E(id), { ok: run.draft.validation.ok, failed: run.draft.validation.checks.filter((c) => !c.ok).map((c) => c.name) });
  if (run.state === 'needs_attention' && run.exception?.code === 'validation_failed' && run.draft.validation.ok) { run.exception = null; setState(run, 'awaiting_approval', 'human:owner', 'edit fixed validation'); }
  else if (run.state === 'awaiting_approval' && !run.draft.validation.ok) { run.exception = { code: 'validation_failed', message: 'Edited draft fails validation. Fix it to continue.' }; setState(run, 'needs_attention', 'worker:gatekeeper', 'validation_failed'); }
  save(); return run;
}
function approve(id) {
  const run = getRun(id), q = qOf(run);
  need(!S.paused, 'Global pause is on. Resume to approve.');
  need(!run.paused, 'This run is paused. Resume it first.');
  need(run.state === 'awaiting_approval' && run.draft, `cannot approve in state ${run.state}`);
  need(run.draft.validation.ok, 'Draft fails validation and cannot be approved.');
  const g = gate(q); need(g.ok, g.message);
  const hash = sha(run.draft.text);
  run.approval = { hash, by: TENANT.owner, at: new Date().toISOString(), version: run.draft.version };
  audit('human:owner', 'draft.approved', E(id), { version: run.draft.version, textHash: hash.slice(0, 16), text: run.draft.text });
  // Hand-off invariant: the exact approved text must be what is handed off.
  need(sha(run.draft.text) === run.approval.hash, 'approval hash mismatch');
  q.handoffs++;
  audit('worker:handoff', 'handoff.simulated', E(id), { note: 'SIMULATED. Nothing was sent to anyone. In a real build this is where the channel adapter would send.', textHash: hash.slice(0, 16) });
  setState(run, 'handed_off', 'worker:handoff');
  save(); return run;
}
function reject(id, reason) {
  const run = getRun(id);
  need(['awaiting_approval', 'needs_attention'].includes(run.state), `cannot reject in state ${run.state}`);
  need(reason && reason.trim(), 'a reason is required');
  run.approval = null;
  audit('human:owner', 'draft.rejected', E(id), { reason: reason.trim(), version: run.draft?.version ?? null });
  setState(run, 'rejected', 'human:owner', reason.trim());
  save(); return run;
}
function pauseRun(id, paused) {
  const run = getRun(id);
  need(!['rejected', 'stopped', 'handed_off'].includes(run.state), `cannot pause in state ${run.state}`);
  run.paused = !!paused;
  audit('human:owner', paused ? 'run.paused' : 'run.resumed', E(id), {});
  save(); return run;
}
function pauseAll(paused) { S.paused = !!paused; audit('human:owner', paused ? 'system.paused' : 'system.resumed', 'tenant', {}); save(); }
function simulateReply(id, text) {
  const run = getRun(id), q = qOf(run);
  need(run.state === 'handed_off', 'replies can only be simulated after a (simulated) hand-off');
  need(text && text.trim(), 'reply text required');
  audit('human:owner', 'reply.simulated', E(id), { note: 'SIMULATED reply typed into the demo; not from a real client', text });
  const label = triage(text);
  run.reply = { text, label };
  audit('worker:triage', 'reply.triaged', E(id), { label, method: 'keyword rules (no AI model)' });
  if (label === 'opt_out') { q.optedOut = true; audit('worker:triage', 'suppression.added', 'quote:' + q.id, { reason: 'STOP received' }); run.stopReason = 'client replied STOP'; setState(run, 'stopped', 'worker:triage', 'opt_out'); }
  else if (label === 'declined') setState(run, 'closed_declined', 'worker:triage');
  else { run.exception = { code: 'reply_needs_you', message: label === 'interested' ? 'Client sounds interested. This needs a human.' : label === 'question' ? 'Client asked a question. This needs a human.' : 'Could not classify the reply. This needs a human.' }; setState(run, 'needs_owner', 'worker:triage', label); }
  save(); return run;
}
function resolve(id, note) {
  const run = getRun(id);
  need(run.state === 'needs_owner', `cannot resolve in state ${run.state}`);
  run.exception = null; audit('human:owner', 'reply.handled', E(id), { note: note || '' });
  setState(run, 'closed_handled', 'human:owner');
  save(); return run;
}
function reset() { S = freshState(); audit('system', 'demo.reset', 'tenant', { note: 'Sample data restored; previous audit log discarded' }); save(); }

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
function view() {
  return { tenant: TENANT, paused: S.paused, holdoutPercent: HOLDOUT_PCT, quotes: S.quotes, runs: Object.values(S.runs), audit: S.audit.slice(-400).reverse(), auditCount: S.audit.length, serverTime: Date.now() };
}
function readBody(req) { return new Promise((res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { res(b ? JSON.parse(b) : {}); } catch { res({}); } }); }); }
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    if (url.pathname.startsWith('/api/')) {
      const p = url.pathname.slice(5).split('/');
      if (req.method === 'GET' && p[0] === 'state') return json(200, view());
      if (req.method === 'GET' && p[0] === 'verify') return json(200, verifyChain());
      if (req.method !== 'POST') return json(405, { error: 'method' });
      const b = await readBody(req);
      if (p[0] === 'sweep') return json(200, sweep());
      if (p[0] === 'reset') { reset(); return json(200, { ok: true }); }
      if (p[0] === 'pause') { pauseAll(b.paused); return json(200, { ok: true }); }
      if (p[0] === 'runs' && p[1]) {
        const act = p[2];
        const run = act === 'edit' ? edit(p[1], b.text) : act === 'approve' ? approve(p[1]) : act === 'reject' ? reject(p[1], b.reason) : act === 'pause' ? pauseRun(p[1], true) : act === 'resume' ? pauseRun(p[1], false) : act === 'reply' ? simulateReply(p[1], b.text) : act === 'resolve' ? resolve(p[1], b.note) : null;
        if (!run) return json(404, { error: 'unknown action' });
        return json(200, { ok: true, run });
      }
      return json(404, { error: 'not found' });
    }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.join(ROOT, 'public', path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(path.join(ROOT, 'public'))) { res.writeHead(403); return res.end(); }
    const buf = fs.readFileSync(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  } catch (e) {
    if (e.code === 'ENOENT') { res.writeHead(404); return res.end('not found'); }
    json(e.status || 500, { error: e.message });
  }
});
load();
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, '127.0.0.1', () => console.log(`Quorum slice running at http://localhost:${PORT}  (sample data, simulated Jobber, nothing is ever sent)`));
}
export { server };
