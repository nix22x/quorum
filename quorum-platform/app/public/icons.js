// Quorum icon set: original line drawings on a 24px grid, 1.5px stroke, currentColor.
// Worker identity: one definition used by the canvas, nav, tables, drawer and activity feed.
const ICON_PATHS = {
  command: '<circle cx="6" cy="7" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="12" cy="17.5" r="2.5"/><path d="M8.5 7h7M7.3 9.2l3.4 6M16.7 9.2l-3.4 6"/>',
  approvals: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12.3l2.4 2.4 4.6-5.2"/>',
  exceptions: '<path d="M12 4.2 20.6 19H3.4z"/><path d="M12 10v4"/><path d="M12 16.6v.2"/>',
  quotes: '<path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4M9.5 12h6M9.5 15.5h6"/>',
  activity: '<path d="M3 12h3.8l2.4-5.5 4.2 11 2.4-5.5H21"/>',
  workers: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5"/><circle cx="16.8" cy="8" r="2.2"/><path d="M15.6 13.4c2.5 0 4.3 1.4 4.9 4"/>',
  pause: '<rect x="6.5" y="5" width="3.8" height="14" rx="1.3"/><rect x="13.7" y="5" width="3.8" height="14" rx="1.3"/>',
  play: '<path d="M8 5.6v12.8a.6.6 0 0 0 .9.5l10-6.4a.6.6 0 0 0 0-1l-10-6.4a.6.6 0 0 0-.9.5z"/>',
  reset: '<path d="M4.6 12.4a7.5 7.5 0 1 0 2.3-5.6"/><path d="M4.5 4.2v4.1h4.1"/>',
  source: '<ellipse cx="12" cy="6" rx="7" ry="2.6"/><path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6"/><path d="M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6"/>',
  watcher: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/><path d="M14.3 9.7l4.4-4.4"/>',
  gate: '<path d="M12 3.5l7 2.8v5.4c0 4.2-2.9 7.5-7 8.8-4.1-1.3-7-4.6-7-8.8V6.3z"/><path d="M9.2 12l2 2 3.8-4"/>',
  drafter: '<path d="M14.4 5.4l4.2 4.2L9.2 19H5v-4.2z"/><path d="M12.6 7.2l4.2 4.2M4 21h7"/>',
  handoff: '<path d="M20.5 3.5 3.5 10.4l6.9 3.1 3.1 6.9z"/><path d="M10.4 13.5l4.6-4.6"/>',
  triage: '<path d="M3.5 13.5h4.8l1.6 2.6h4.2l1.6-2.6h4.8"/><path d="M6 5h12l2.5 8.5v5A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5v-5z"/>',
  fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plug: '<path d="M9 3.5v4M15 3.5v4M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0z"/><path d="M12 16v4.5"/>',
  msgoff: '<path d="M4 5.5h16v10H9l-4 3.5v-3.5H4z"/><path d="M3.5 3.5l17 17"/>',
  policy: '<rect x="4" y="4" width="16" height="16" rx="5"/><path d="M8 9.5h8M8 14.5h8"/><circle cx="10.5" cy="9.5" r="1.6"/><circle cx="14" cy="14.5" r="1.6"/>',
  trace: '<circle cx="5.5" cy="17.5" r="2"/><circle cx="18.5" cy="6.5" r="2"/><path d="M7.3 16.4c4-1.4 1.6-7.8 5.5-9.2 1.5-.5 2.8-.6 3.8-.7"/>',
  arrow: '<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
};
function icon(name, size = 20, cls = '') {
  return `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name] || ''}</svg>`;
}
const BRAND_MARK = '<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".45"/><circle cx="10" cy="19.5" r="3.2" fill="var(--w-watcher)"/><circle cx="22" cy="19.5" r="3.2" fill="var(--w-gate)"/><circle cx="16" cy="9.5" r="3.2" fill="var(--w-owner)"/></svg>';

// Worker identity. `type` is the honest implementation tag.
const WORKERS = {
  src: { key: 'src', name: 'Sample Jobber', role: 'Made-up quotes for a fictional business', type: 'Simulated source', icon: 'source', accent: 'var(--w-sim)', sim: true },
  watcher: { key: 'watcher', name: 'Watcher', role: 'Finds quotes that were sent but not approved', type: 'Deterministic', icon: 'watcher', accent: 'var(--w-watcher)', actor: 'worker:watcher' },
  gate: { key: 'gate', name: 'Gatekeeper', role: 'Eligibility, consent, holdout and draft checks', type: 'Policy', icon: 'gate', accent: 'var(--w-gate)', actor: 'worker:gatekeeper' },
  drafter: { key: 'drafter', name: 'Drafter', role: 'Writes one follow-up per eligible quote', type: 'Template · no AI model yet', typeShort: 'Template', icon: 'drafter', accent: 'var(--w-drafter)', actor: 'worker:drafter' },
  owner: { key: 'owner', name: 'Owner approval', role: 'You approve, edit or reject the exact text', type: 'Human', icon: null, accent: 'var(--w-owner)', actor: 'human:owner' },
  handoff: { key: 'handoff', name: 'Hand-off', role: 'Where a real send would happen. Nothing is sent.', type: 'Simulated · sending disabled', typeShort: 'Simulated', icon: 'handoff', accent: 'var(--w-sim)', actor: 'worker:handoff', sim: true },
  triage: { key: 'triage', name: 'Reply triage', role: 'Labels replies; STOP suppresses the client', type: 'Keyword rules · no AI model yet', typeShort: 'Keyword rules', icon: 'triage', accent: 'var(--w-triage)', actor: 'worker:triage' },
  system: { key: 'system', name: 'System', role: 'Quorum itself', type: 'Deterministic', icon: 'policy', accent: 'var(--w-system)', actor: 'system' },
};
const ACTOR_WORKER = { 'worker:watcher': 'watcher', 'worker:gatekeeper': 'gate', 'worker:drafter': 'drafter', 'human:owner': 'owner', 'worker:handoff': 'handoff', 'worker:triage': 'triage', system: 'system' };
const workerOfActor = (a) => WORKERS[ACTOR_WORKER[a] || 'system'];
let OWNER_NAME = 'Owner';
const monogram = (name) => String(name || '?').trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

// Tinted rounded badge with the worker's glyph (Owner approval uses the tenant owner's monogram, never a face).
function badge(key, size = 'md') {
  const w = WORKERS[key];
  const inner = key === 'owner' ? `<span class="mono-glyph">${monogram(OWNER_NAME)}</span>` : icon(w.icon, size === 'xs' ? 12 : size === 'sm' ? 14 : size === 'lg' ? 22 : 18);
  return `<span class="wbadge wbadge-${size}${w.sim ? ' is-sim' : ''}" style="--a:${w.accent}" aria-hidden="true">${inner}</span>`;
}
// Inline identity (badge + name), e.g. for activity actors and table cells.
function identity(key, { sub = true, size = 'sm' } = {}) {
  const w = WORKERS[key];
  return `<span class="ident" style="--a:${w.accent}">${badge(key, size)}<span class="ident-txt"><span class="ident-name">${w.name}</span>${sub ? `<span class="ident-sub">${w.type}</span>` : ''}</span></span>`;
}
