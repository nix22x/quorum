# Jobber integration spike

Goal: replace documentation assumptions with observed facts before we commit to the integration design.
Takes about 45 minutes. Needs Node 20+ and no dependencies.

## One-time setup (you, about 10 minutes)
1. Create a Developer Center account at https://developer.getjobber.com/ (separate from any Jobber account). Turn on 2FA.
2. Create a Jobber developer **test account** (90-day window; see the Getting Started page). Put realistic data in it:
   about 10 clients, 15 quotes in mixed states (draft, sent/awaiting response, approved, archived), 5 invoices (some past due).
3. In the Developer Center create an app (Draft state is fine). Set the OAuth callback URL to `http://localhost:3000/callback`.
   Select read scopes for clients, quotes, requests, invoices, jobs, and any write scope that lets you create/update quotes.
   Note which scopes exist in the list: paste the list into `findings/scopes.txt`.
4. `cp .env.example .env` and fill in the client ID and secret. `.env` is git-ignored. Never paste secrets into chat.

## Run
```
node spike.mjs auth         # open the printed URL as the test account admin, click Allow Access
node spike.mjs refresh      # does the refresh token rotate?
node spike.mjs introspect   # webhook topics, quote/client fields, messaging mutations
node spike.mjs probe        # rate-limit cost and bucket behaviour
node spike.mjs webhook      # in another terminal: expose with a tunnel, add webhooks, edit quotes in the test account
node spike.mjs report       # writes SPIKE-REPORT.md
```
Then tell Claude "spike done" and it will read SPIKE-REPORT.md and findings/ and update the architecture.

## Also do by hand (cannot be tested from a test account)
- Email Jobber API support: is a Draft custom integration allowed for 3 to 5 design partners, and what is the approval path beyond 5?
- At design-partner recruitment, record each partner's Jobber plan and whether they could authorize the app.
