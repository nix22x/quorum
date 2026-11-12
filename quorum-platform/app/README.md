# Quorum: estimate follow-up vertical slice

Run (needs Node 20+, no install step):

    cd ~/dev/quorum-platform/app
    node server.js
    open http://localhost:4300

Tests: `node test.mjs` (12 checks, uses a temp data file; your demo data is untouched).
State lives in `data/state.json` (git-ignored). "Reset demo" restores the sample data.

## What is real
Workflow state machine, eligibility/consent/validation rules, seeded holdout assignment, owner approve/edit/reject/pause,
approval hash of the exact text (edits clear it), persisted state, hash-chained audit log.

## What is simulated
Jobber (12 made-up quotes for a fictional business; NOT connected), sending (nothing is ever sent; hand-off only records
"handoff.simulated"), drafting (fixed template, NO language model), reply triage (keyword rules; replies are typed by you).

## Not built
Auth/multi-tenancy/RLS, Postgres, Inngest, real messaging, consent capture, quiet hours, stratified holdout, invoice reminders.
The Phase 2 architecture still applies; this slice deliberately uses one Node file and a JSON file instead.
