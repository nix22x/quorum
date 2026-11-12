// End-to-end journey test against a real running server instance (temp data file; your demo data is untouched).
import assert from 'node:assert/strict';
import os from 'node:os'; import path from 'node:path';
process.env.QUORUM_DATA = path.join(os.tmpdir(), 'quorum-test-' + process.pid + '.json');
const { server } = await import('./server.js');
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port + '/api/';
const post = async (p, b = {}) => { const r = await fetch(base + p, { method: 'POST', body: JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
const state = async () => (await fetch(base + 'state')).json();
const run = (s, id) => s.runs.find((r) => r.id === id);
let n = 0; const t = async (name, f) => { await f(); console.log('  ✓ ' + name); n++; };

await post('reset');
await t('sweep creates runs and sends nothing', async () => {
  const r = await post('sweep'); assert.equal(r.body.created, 11);
  const s = await state();
  assert.equal(s.runs.filter((x) => x.state === 'awaiting_approval').length, 4);
  assert.equal(s.runs.filter((x) => x.arm === 'holdout').length, 2);
  assert.ok(s.audit.every((e) => e.action !== 'message.sent'));
  assert.equal(run(s, 'R-1048').exception.code, 'no_consent');
  assert.equal(run(s, 'R-1050').exception.code, 'missing_total');
  assert.equal(run(s, 'R-1049').state, 'stopped');
  assert.equal(run(s, 'R-1043').draft, null, 'holdout gets no draft');
});
await t('second sweep is idempotent', async () => { const r = await post('sweep'); assert.equal(r.body.created, 0); });
await t('edit that invents a price is flagged and cannot be approved', async () => {
  const e = await post('runs/R-1041/edit', { text: 'Hi Marcus, we can do it for $5,000 today. Reply STOP to opt out.' });
  assert.equal(e.status, 200);
  let s = await state(); assert.equal(run(s, 'R-1041').state, 'needs_attention');
  assert.equal(run(s, 'R-1041').exception.code, 'validation_failed');
  const a = await post('runs/R-1041/approve'); assert.equal(a.status, 409);
});
await t('fixing the edit returns it to the approval queue', async () => {
  await post('runs/R-1041/edit', { text: "Hi Marcus, checking in on the furnace replacement quote ($8,450). Any questions? Reply STOP to opt out." });
  const s = await state(); assert.equal(run(s, 'R-1041').state, 'awaiting_approval');
});
await t('approval stores a hash of the exact text and hand-off is simulated', async () => {
  const a = await post('runs/R-1041/approve'); assert.equal(a.status, 200);
  const s = await state(); const r = run(s, 'R-1041');
  assert.equal(r.state, 'handed_off'); assert.equal(r.approval.hash.length, 64);
  assert.ok(s.audit.some((e) => e.action === 'handoff.simulated' && e.entity === 'run:R-1041'));
});
await t('approved run cannot be edited afterwards', async () => { assert.equal((await post('runs/R-1041/edit', { text: 'x' })).status, 409); });
await t('reject requires a reason and is recorded', async () => {
  assert.equal((await post('runs/R-1042/reject', { reason: '  ' })).status, 409);
  assert.equal((await post('runs/R-1042/reject', { reason: 'Customer asked us to wait' })).status, 200);
  const s = await state(); assert.equal(run(s, 'R-1042').state, 'rejected');
  assert.ok(s.audit.some((e) => e.action === 'draft.rejected' && e.detail.reason === 'Customer asked us to wait'));
});
await t('pausing a run blocks approval; resume restores it', async () => {
  await post('runs/R-1045/pause'); assert.equal((await post('runs/R-1045/approve')).status, 409);
  await post('runs/R-1045/resume'); assert.equal((await post('runs/R-1045/approve')).status, 200);
});
await t('global pause blocks approval and scanning', async () => {
  await post('pause', { paused: true });
  assert.equal((await post('runs/R-1046/approve')).status, 409);
  assert.equal((await post('sweep')).body.refused, true);
  await post('pause', { paused: false });
});
await t('simulated STOP reply suppresses the client', async () => {
  const r = await post('runs/R-1045/reply', { text: 'STOP' }); assert.equal(r.status, 200);
  const s = await state(); assert.equal(run(s, 'R-1045').state, 'stopped');
  assert.equal(s.quotes.find((q) => q.id === 'Q-1045').optedOut, true);
});
await t('interested reply routes to the owner, who can mark it handled', async () => {
  const r = await post('runs/R-1041/reply', { text: 'Sounds good, can you start Monday?' });
  let s = await state(); assert.equal(run(s, 'R-1041').state, 'needs_owner');
  await post('runs/R-1041/resolve'); s = await state(); assert.equal(run(s, 'R-1041').state, 'closed_handled');
});
await t('audit chain verifies', async () => {
  const v = await (await fetch(base + 'verify')).json(); assert.equal(v.ok, true); assert.ok(v.count > 40);
});
console.log(`\n${n} checks passed`);
server.close(); process.exit(0);
