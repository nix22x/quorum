#!/usr/bin/env node
// Quorum Phase 2: Jobber integration spike.
// Dependency-free (Node 20+). Run `node spike.mjs help`.
// Purpose: replace documentation assumptions with observed facts about one real Jobber account,
// and write each observation to ./findings so the architecture can be confirmed or changed.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOKENS = path.join(here, '.tokens.json');
const FINDINGS = path.join(here, 'findings');
const API = 'https://api.getjobber.com/api/graphql';
const AUTHZ = 'https://api.getjobber.com/api/oauth/authorize';
const TOKEN_URL = 'https://api.getjobber.com/api/oauth/token';

// ---------- env ----------
function loadEnv() {
  const file = path.join(here, '.env');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  }
}
loadEnv();
const cfg = {
  id: process.env.JOBBER_CLIENT_ID,
  secret: process.env.JOBBER_CLIENT_SECRET,
  redirect: process.env.JOBBER_REDIRECT_URI || 'http://localhost:3000/callback',
  version: process.env.JOBBER_API_VERSION || '2025-04-16',
  webhookPort: Number(process.env.WEBHOOK_PORT || 3001),
};
function need(...keys) {
  const missing = keys.filter((k) => !cfg[k]);
  if (missing.length) {
    console.error(`Missing config: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

// ---------- findings ----------
function record(key, value) {
  fs.mkdirSync(FINDINGS, { recursive: true });
  fs.writeFileSync(path.join(FINDINGS, `${key}.json`), JSON.stringify({ recordedAt: new Date().toISOString(), value }, null, 2));
}
function readFinding(key) {
  try { return JSON.parse(fs.readFileSync(path.join(FINDINGS, `${key}.json`), 'utf8')).value; } catch { return undefined; }
}

// ---------- tokens ----------
const readTokens = () => { try { return JSON.parse(fs.readFileSync(TOKENS, 'utf8')); } catch { return undefined; } };
const writeTokens = (t) => fs.writeFileSync(TOKENS, JSON.stringify(t, null, 2), { mode: 0o600 });

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.id, client_secret: cfg.secret, ...params }),
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: res.status, body };
}

async function refresh() {
  const t = readTokens();
  if (!t?.refresh_token) throw new Error('No refresh token. Run: node spike.mjs auth');
  const { status, body } = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  if (status !== 200 || !body.access_token) throw new Error(`Refresh failed (${status}): ${JSON.stringify(body)}`);
  const rotated = Boolean(body.refresh_token && body.refresh_token !== t.refresh_token);
  const next = { ...t, ...body, refresh_token: body.refresh_token || t.refresh_token, obtained_at: Date.now() };
  writeTokens(next);
  return { rotated, expires_in: body.expires_in, fields: Object.keys(body) };
}

async function accessToken() {
  let t = readTokens();
  if (!t?.access_token) throw new Error('Not authorized. Run: node spike.mjs auth');
  const ageMs = Date.now() - (t.obtained_at || 0);
  if (ageMs > 50 * 60 * 1000) { await refresh(); t = readTokens(); }
  return t.access_token;
}

// ---------- GraphQL ----------
async function gql(query, variables, { retried = false } = {}) {
  need('id', 'secret');
  const token = await accessToken();
  const started = Date.now();
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-JOBBER-GRAPHQL-VERSION': cfg.version },
    body: JSON.stringify({ query, variables }),
  });
  const ms = Date.now() - started;
  if (res.status === 401 && !retried) { await refresh(); return gql(query, variables, { retried: true }); }
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, ms, data: json.data, errors: json.errors, cost: json.extensions?.cost, raw: json };
}

const typeStr = (t) => (!t ? '' : t.kind === 'NON_NULL' ? `${typeStr(t.ofType)}!` : t.kind === 'LIST' ? `[${typeStr(t.ofType)}]` : t.name);
const TYPE_REF = 'kind name ofType { kind name ofType { kind name ofType { kind name } } }';

// ---------- commands ----------
async function cmdAuth() {
  need('id', 'secret');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(12).toString('hex');
  const redirect = new URL(cfg.redirect);
  const url = `${AUTHZ}?${new URLSearchParams({ client_id: cfg.id, redirect_uri: cfg.redirect, response_type: 'code', state, code_challenge: challenge, code_challenge_method: 'S256' })}`;
  console.log('\nOpen this URL as an admin of your Jobber TEST account and click Allow Access:\n\n' + url + '\n');
  await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, `http://${req.headers.host}`);
      if (u.pathname !== redirect.pathname) { res.writeHead(404).end(); return; }
      const code = u.searchParams.get('code');
      if (u.searchParams.get('state') !== state || !code) { res.writeHead(400).end('Bad state or missing code'); return; }
      const { status, body } = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: cfg.redirect, code_verifier: verifier });
      if (status !== 200 || !body.access_token) { res.writeHead(500).end('Token exchange failed, see terminal'); server.close(); return reject(new Error(`Token exchange failed (${status}): ${JSON.stringify(body)}`)); }
      writeTokens({ ...body, obtained_at: Date.now() });
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Authorized. You can close this tab.');
      server.close();
      let jwtExp;
      try { jwtExp = JSON.parse(Buffer.from(body.access_token.split('.')[1], 'base64url').toString()).exp; } catch {}
      record('01-oauth', { pkceS256Accepted: true, tokenResponseFields: Object.keys(body), expires_in: body.expires_in, jwtExp, hasRefreshToken: Boolean(body.refresh_token) });
      console.log('Authorized. Token fields:', Object.keys(body).join(', '), '| expires_in:', body.expires_in);
      resolve();
    });
    server.listen(Number(redirect.port || 80), () => console.log(`Waiting for callback on ${cfg.redirect} ...`));
  });
}

async function cmdRefresh() {
  const before = readTokens();
  const r = await refresh();
  const out = { ...r, refreshTokenChanged: r.rotated, hadRefreshTokenBefore: Boolean(before?.refresh_token) };
  record('02-refresh', out);
  console.log('Refresh OK. Rotation observed:', r.rotated, '| expires_in:', r.expires_in);
}

async function cmdIntrospect() {
  const out = {};
  const topics = await gql(`{ __type(name: "WebHookTopicEnum") { enumValues { name } } }`);
  out.webhookTopics = topics.data?.__type?.enumValues?.map((v) => v.name) ?? { error: topics.errors ?? topics.raw };
  console.log('\nWebhook topics:', Array.isArray(out.webhookTopics) ? out.webhookTopics.join(', ') : JSON.stringify(out.webhookTopics));

  const schema = await gql(`{ __schema { queryType { fields { name args { name type { ${TYPE_REF} } } } } mutationType { fields { name description args { name type { ${TYPE_REF} } } } } types { name kind } } }`);
  if (!schema.data) { out.schemaError = schema.errors ?? schema.raw; console.log('Introspection unavailable:', JSON.stringify(out.schemaError)); record('03-schema', out); return; }
  const S = schema.data.__schema;
  const q = S.queryType.fields, m = S.mutationType?.fields ?? [];
  const comms = /message|sms|text|email|send|communicat|notif|remind|follow/i;
  out.quotesQueryArgs = q.find((f) => f.name === 'quotes')?.args.map((a) => `${a.name}: ${typeStr(a.type)}`);
  out.commsTypes = S.types.filter((t) => comms.test(t.name) && !t.name.startsWith('__')).map((t) => `${t.name} (${t.kind})`);
  out.commsMutations = m.filter((f) => comms.test(f.name) || comms.test(f.description || '')).map((f) => ({ name: f.name, description: f.description, args: f.args.map((a) => a.name) }));
  out.quoteMutations = m.filter((f) => /quote/i.test(f.name)).map((f) => f.name);
  out.allMutationNames = m.map((f) => f.name);

  const fieldsOf = async (name) => {
    const r = await gql(`{ __type(name: "${name}") { fields { name description type { ${TYPE_REF} } } } }`);
    return r.data?.__type?.fields?.map((f) => ({ name: f.name, type: typeStr(f.type), description: f.description })) ?? null;
  };
  out.quoteFields = await fieldsOf('Quote');
  out.clientFields = await fieldsOf('Client');
  out.consentLikeClientFields = (out.clientFields || []).filter((f) => /consent|follow|sms|text|marketing|opt|communicat|prefer/i.test(f.name + ' ' + (f.description || '')));
  const quoteStatus = out.quoteFields?.find((f) => /status/i.test(f.name));
  if (quoteStatus) {
    const enumName = quoteStatus.type.replace(/[\[\]!]/g, '');
    const e = await gql(`{ __type(name: "${enumName}") { enumValues { name } } }`);
    out.quoteStatusEnum = { type: enumName, values: e.data?.__type?.enumValues?.map((v) => v.name) };
  }
  record('03-schema', out);
  console.log('\nquotes() args:', out.quotesQueryArgs?.join(' | '));
  console.log('Quote status values:', JSON.stringify(out.quoteStatusEnum));
  console.log('Client consent/communication-like fields:', out.consentLikeClientFields.map((f) => f.name).join(', ') || '(none found)');
  console.log('Messaging-related mutations:', out.commsMutations.map((x) => x.name).join(', ') || '(none found)');
  console.log('Messaging-related types:', out.commsTypes.join(', ') || '(none found)');
  console.log('Full detail written to findings/03-schema.json');
}

async function cmdProbe() {
  const schema = readFinding('03-schema');
  if (!schema) { console.error('Run `node spike.mjs introspect` first.'); process.exit(1); }
  const have = new Set((schema.quoteFields || []).map((f) => f.name));
  const scalars = ['id', 'quoteNumber', 'title', 'quoteStatus', 'createdAt', 'updatedAt', 'jobberWebUri'].filter((f) => have.has(f));
  const sel = [...scalars];
  if (have.has('amounts')) sel.push('amounts { total }');
  const clientSel = 'client { id firstName lastName }';
  const results = {};
  const run = async (label, body) => {
    const r = await gql(`query { quotes(first: 20) { totalCount nodes { ${body} } pageInfo { hasNextPage endCursor } } }`);
    results[label] = { status: r.status, ms: r.ms, cost: r.cost, errors: r.errors, sampleCount: r.data?.quotes?.nodes?.length, totalCount: r.data?.quotes?.totalCount };
    if (label === 'withClient' && r.data) results.sample = r.data.quotes.nodes.slice(0, 3);
    console.log(`${label}: status ${r.status}, ${r.ms}ms, requested ${r.cost?.requestedQueryCost}, actual ${r.cost?.actualQueryCost}, available ${r.cost?.throttleStatus?.currentlyAvailable}/${r.cost?.throttleStatus?.maximumAvailable}`, r.errors ? `ERRORS ${JSON.stringify(r.errors).slice(0, 300)}` : '');
  };
  await run('flat', sel.join(' '));
  if (have.has('client')) await run('withClient', `${sel.join(' ')} ${clientSel}`);
  // Does omitting `first` change the charged cost? (Docs say it assumes 100 nodes.)
  const noFirst = await gql(`query { quotes { nodes { ${sel.join(' ')} } } }`);
  results.noFirst = { status: noFirst.status, cost: noFirst.cost, errors: noFirst.errors };
  console.log('noFirst requested cost:', noFirst.cost?.requestedQueryCost);
  // Sequential burst to see the leaky bucket behave.
  const burst = [];
  for (let i = 0; i < 10; i++) { const r = await gql(`query { quotes(first: 20) { nodes { ${sel.join(' ')} } } }`); burst.push({ ms: r.ms, available: r.cost?.throttleStatus?.currentlyAvailable, status: r.status }); }
  results.burst = burst;
  console.log('Burst of 10 (available points):', burst.map((b) => b.available).join(' -> '));
  record('04-probe', results);
}

async function cmdWebhook() {
  need('secret');
  fs.mkdirSync(FINDINGS, { recursive: true });
  const log = path.join(FINDINGS, '05-webhook-events.jsonl');
  const seen = new Map();
  const server = http.createServer((req, res) => {
    const started = process.hrtime.bigint();
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const header = req.headers['x-jobber-hmac-sha256'];
      const expected = crypto.createHmac('sha256', cfg.secret).update(raw).digest('base64');
      let valid = false;
      try { valid = header && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected)); } catch {}
      let body; try { body = JSON.parse(raw.toString()); } catch { body = { raw: raw.toString().slice(0, 500) }; }
      const ev = body?.data?.webHookEvent;
      const dedupeKey = ev ? `${ev.topic}:${ev.itemId}` : undefined;
      const prev = dedupeKey ? seen.get(dedupeKey) : undefined;
      if (dedupeKey) seen.set(dedupeKey, Date.now());
      res.writeHead(valid ? 200 : 401).end();
      const respondMs = Number(process.hrtime.bigint() - started) / 1e6;
      const entry = { receivedAt: new Date().toISOString(), valid, respondMs, topic: ev?.topic, itemId: ev?.itemId, accountId: ev?.accountId, occurredAt: ev?.occurredAt ?? ev?.occuredAt, lagMs: ev?.occurredAt ? Date.now() - Date.parse(ev.occurredAt) : undefined, sameKeyWithinMs: prev ? Date.now() - prev : undefined, headerNames: Object.keys(req.headers) };
      fs.appendFileSync(log, JSON.stringify(entry) + '\n');
      console.log(JSON.stringify(entry));
    });
  });
  server.listen(cfg.webhookPort, () => {
    console.log(`Webhook receiver on http://localhost:${cfg.webhookPort}/ (HMAC-SHA256 verified with your client secret).`);
    console.log('Expose it (e.g. `cloudflared tunnel --url http://localhost:' + cfg.webhookPort + '`), add that URL as a webhook in the Developer Center for each quote, client, request and invoice topic, then edit, send and approve a quote in the test account. Ctrl+C when done; run `report`.');
  });
}

function cmdReport() {
  const oauth = readFinding('01-oauth'), refreshF = readFinding('02-refresh'), schema = readFinding('03-schema'), probe = readFinding('04-probe');
  let events = [];
  try { events = fs.readFileSync(path.join(FINDINGS, '05-webhook-events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch {}
  const yn = (v) => (v === undefined ? 'NOT YET TESTED' : v ? 'yes' : 'no');
  const lines = [];
  lines.push('# Jobber spike report', `Generated ${new Date().toISOString()}`, '', '| # | Question | Result |', '| - | - | - |');
  const row = (n, q, r) => lines.push(`| ${n} | ${q} | ${r} |`);
  row(1, 'OAuth with PKCE S256 completes; access-token lifetime', oauth ? `yes; expires_in ${oauth.expires_in}s; fields: ${oauth.tokenResponseFields.join(', ')}` : 'NOT YET TESTED');
  row(2, 'Refresh works; does the refresh token rotate?', refreshF ? `refresh ok; rotation observed: ${yn(refreshF.rotated)}` : 'NOT YET TESTED');
  row(3, 'Webhook topics available (quote, request, client, invoice)', schema?.webhookTopics ? (Array.isArray(schema.webhookTopics) ? schema.webhookTopics.filter((t) => /QUOTE|REQUEST|CLIENT|INVOICE|APP_/.test(t)).join(', ') : 'introspection failed') : 'NOT YET TESTED');
  row(4, 'Quote status values (needed to detect awaiting response)', schema?.quoteStatusEnum ? `${schema.quoteStatusEnum.type}: ${(schema.quoteStatusEnum.values || []).join(', ')}` : 'NOT YET TESTED');
  row(5, 'Quote query filter/sort arguments', schema?.quotesQueryArgs ? schema.quotesQueryArgs.join('; ') : 'NOT YET TESTED');
  row(6, 'Client consent / communication preference fields readable', schema ? (schema.consentLikeClientFields?.map((f) => f.name).join(', ') || 'none found') : 'NOT YET TESTED');
  row(7, 'API can send client email/text (messaging mutations)', schema ? (schema.commsMutations?.map((m) => m.name).join(', ') || 'none found') : 'NOT YET TESTED');
  row(8, 'Cost of a 20-quote page (requested / actual points)', probe?.withClient?.cost ? `${probe.withClient.cost.requestedQueryCost} / ${probe.withClient.cost.actualQueryCost} of ${probe.withClient.cost.throttleStatus?.maximumAvailable}` : probe?.flat?.cost ? `${probe.flat.cost.requestedQueryCost} / ${probe.flat.cost.actualQueryCost}` : 'NOT YET TESTED');
  row(9, 'Webhook: HMAC valid, respond time, delivery lag, duplicates', events.length ? `${events.length} events; valid ${events.filter((e) => e.valid).length}; max respond ${Math.max(...events.map((e) => e.respondMs)).toFixed(1)}ms; max lag ${Math.max(...events.map((e) => e.lagMs || 0))}ms; duplicates within window ${events.filter((e) => e.sameKeyWithinMs !== undefined).length}` : 'NOT YET TESTED');
  lines.push('', '## Cannot be tested from a developer test account (ask Jobber or a real partner)', '',
    '- Whether a customer account on each plan (Core, Connect, Grow, Plus) can authorize an app. Test with the first design partner and record their plan.',
    '- Whether a Draft custom integration is permitted for design partners, and the 5-paying-account threshold. Email the Jobber API support address listed in the Developer Center.',
    '- Whether the AI-drafted-quote and native follow-up automations expose any state through the API (check the Quote and Client fields in findings/03-schema.json).');
  fs.writeFileSync(path.join(here, 'SPIKE-REPORT.md'), lines.join('\n'));
  console.log(lines.join('\n'));
}

function help() {
  console.log(`Usage: node spike.mjs <command>
  auth         OAuth (PKCE) against your Jobber test account, saves .tokens.json
  refresh      Force a token refresh and record whether the refresh token rotates
  introspect   Record webhook topics, quote and client fields, filters, messaging mutations
  probe        Query quotes, record rate-limit cost and leaky-bucket behaviour
  webhook      Run a signed-webhook receiver and log latency, lag and duplicates
  report       Write SPIKE-REPORT.md from everything recorded`);
}

const cmds = { auth: cmdAuth, refresh: cmdRefresh, introspect: cmdIntrospect, probe: cmdProbe, webhook: cmdWebhook, report: cmdReport, help };
const cmd = process.argv[2] || 'help';
if (!cmds[cmd]) { help(); process.exit(1); }
Promise.resolve(cmds[cmd]()).catch((e) => { console.error(e.message || e); process.exit(1); });
