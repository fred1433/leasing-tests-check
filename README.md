# Showings: a Playwright + TypeScript suite that tests notifications without contacting tenants

A small, real Next.js leasing application (synthetic data only) and the test suite that protects one flow end to end:
**reschedule a showing, and the old notice must not send.**

Written, reviewed and maintained by **Frederic de Lavenne de Choulot**. I use AI coding agents as tooling; every file
here was read and checked by me, and every claim below can be re-run from this repository.

## What is under test

A leasing agent books a showing for a unit that has a tenant in place. The tenant's notice is queued for 10 a.m. the
day before. The agent moves the showing. Later, the old queued notice comes due (or retries after a provider
timeout). Only a notice for the current time may reach the sending boundary.

Scope: this regression covers the tenant's SMS and email. Calendar updates, and what happens when a showing moves
after an earlier notice already went out, are separate findings logged in
[docs/EXPLORATORY_NOTE.md](docs/EXPLORATORY_NOTE.md), not covered here.

- Next.js 16 (App Router), TypeScript, PostgreSQL
- Clerk, development instance, real sign-in through Clerk's own form with a `+clerk_test` identity
- A notification worker with a queue, retries and backoff, as a separate process
- One clock shared by the web server and the worker, movable by the tests

The evidence of a harmful change being stopped is in the pull requests:

- **PR #1, a deliberately injected defect** (said so in its title, description and commit message, and labelled
  `injected-defect`): the worker renders from the job's snapshot and skips
  the showing lookup. The end-to-end test fails on the exact stale notice; the fix restores the currency check (one
  primary-key read of two columns, version and status); the same test passes.
- **PR #2, a real bug found by exploratory testing**: double-clicking "Book showing" booked twice. The regression test
  was pushed first and failed; the fix followed; the same test passes. See [docs/BUG_REPORT.md](docs/BUG_REPORT.md).

Later, a review found a narrower window: the worker could read version 1, a move could commit version 2, and the
worker would still capture the version-1 notice. The worker now reads the showing `FOR SHARE` inside the same
transaction that commits the outbound intent, and a move takes `FOR UPDATE` on the same row. Either the move commits
first and the old notice is dropped, or the notice commits first and the move waits for it (the notice was true when
it was committed; the move then queues its own). `tests/integration/interleaving.test.ts` forces both orders
deterministically; both tests fail if the lock is removed.

## How this demo avoids contacting tenants

- Test notification payloads are captured, never delivered.
- The notification worker has no network route.
- Clerk uses a development instance, a password sign-in and a test identity.
- Staging transports are disabled in this sample.

In more detail, each with its own tests:

1. **No production credentials in a test process.** `DEPLOYMENT_TARGET` must be set explicitly to `test` or
   `staging` (never inferred from `NODE_ENV`: `next start` always runs as production). On `test`, any Twilio,
   SendGrid or Graph secret, or any `sk_live_` / `pk_live_` Clerk key, stops the process at startup.
2. **One server-side sending boundary** (`lib/outbound/boundary.ts`) for the application's own messages: Twilio SMS,
   SendGrid mail, Microsoft Graph mail **and calendar events** (creating an event with attendees makes Exchange send
   invitations, and updates can notify attendees, so a calendar write is treated as a send), and Clerk invitations
   and phone codes if the application ever sends them. It validates the known recipient-bearing fields (to, cc, bcc,
   reply-to, from, attendees) against an allowlist, then runs a defensive scan of the whole final payload for other
   addresses or phone numbers. The scan is a safety net, not proof that every way of writing an address is
   understood. A missing or malformed allowlist closes the gate. On the test target the transport is a capture: the
   final rendered payload is stored and no provider is called. On staging the boundary refuses to send, because
   staging transports are not wired in this sample. A capture proves what the application attempted to send, not
   delivery or lawful service.
3. **The worker has no route to the internet.** In CI it runs in its own Linux network namespace (loopback only) and
   reaches PostgreSQL through the unix socket; locally on macOS, under a `sandbox-exec` profile that denies outbound
   IP. Code that bypasses the boundary and calls a provider directly cannot connect. The CI worker refuses to start if
   it can reach the internet.

Clerk's own sign-in messages do not pass through this boundary. The suite relies on Clerk's documented test
behaviour: the identity is a `+clerk_test` address signing in with a password, and when Clerk asks for a code it is
the fixed test code, which Clerk does not email. Verification *links* are emailed even to test addresses, so the
suite never uses them. Global setup refuses any identity without `+clerk_test`, and teardown revokes the test user's
sessions, failing the run if that cannot be confirmed.

## Selected Ontario entry-policy scenarios

Not a compliance engine and not legal advice. `lib/policy/entry.ts` models a narrow, sourced set of scenarios:

- **Showing to a prospective tenant (RTA s.26(3))**: only after a notice of termination or an agreement to
  terminate; between 8 a.m. and 8 p.m.; after an attempt to inform the tenant. A lease end date alone never allows a
  showing. No 24-hour written notice is required for this basis. Whether an attempt was a *reasonable* effort is left
  to a person. Booking is kept apart from entry: a booking is "bookable, notice pending" (`assessShowingBooking`); a
  planned or queued notice never counts as an attempt, only a recorded one does (`assessEntry`). Keeping the whole
  visit inside 8 a.m. to 8 p.m. (so 7:45 p.m. for 30 minutes is refused) is this sample's conservative scheduling
  rule, not a statutory test.
- **Entry on written notice (s.27)**: a written-notice ground; at least 24 hours of elapsed time (tested across both
  daylight-saving changes); reason, date and time of entry stated; 8 a.m. to 8 p.m. The "inspection" and "reason in
  the tenancy agreement" labels do not establish that the entry is reasonable; the decision says so.
- **Service kept apart from communication**: email counts only with written consent (LTB Rule 3.1); posting on the
  unit door is allowed for a s.27 notice (Rule 3.2); a text message is not a listed service method. Mail, courier and
  fax are reported as excluded because their deemed-service dates (Rule 3.9) are not modelled.
- **Excluded, not judged**: emergency entry, consent at the time of entry.

Sources read on 2026-09-26: LTB Interpretation Guideline 19, "The Landlord's Right of Entry into a Rental Unit"
(effective 2018-12-15, updated 2026-07-01); LTB Rules of Procedure (updated 2026-09-21), Rules 3.1, 3.2, 3.9.

## Tests

| Layer | Where | What it proves |
|---|---|---|
| Unit (Vitest) | `tests/unit` | Entry-policy scenarios and boundaries, DST, allowlist parsing, every recipient field per provider, deployment identity, the worker's currency decision, notice text |
| Integration (Vitest + PostgreSQL) | `tests/integration` | Worker retries and exhaustion, cancel then retry, reschedule, missing or malformed configuration, idempotent capture, refused booking, a seed that fails halfway, network isolation of the worker |
| End to end (Playwright) | `tests/e2e` | Real Clerk sign-in; reschedule; valid booking; cancel then retry; forbidden calendar attendee stopped before Graph; missing termination basis; 8 p.m. limit; double submission books once; signed-out access |

The Playwright run has 9 tests: 8 scenarios plus the Clerk sign-in step they depend on.

Every test creates its data under its own run id and removes it afterwards, including after a failure. Playwright
runs with one worker (the clock is shared), zero retries, and traces kept only for failures.

## CI

`.github/workflows/ci.yml` runs on every pull request and on `main`:

- **Unit, integration and isolation**: no secrets.
- **End to end (Playwright, real Clerk)**: builds the application from the same checkout, checks that the server under
  test reports this run's deployment id (so a stale server cannot pass), runs the suite, revokes the test user's Clerk
  sessions and checks that none is left (the run fails otherwise), then redacts every trace and report file
  (`scripts/redact_traces.py`: cookies, Clerk session, dev-browser and testing tokens, plus the exact secret values)
  and verifies the result. Only then are the HTML report, and the redacted traces on failure, uploaded. Without the
  revocation marker or a clean verification, nothing is uploaded. Both failure paths have negative tests.

Both are required checks on `main`, with no bypass, administrators included: see
[docs/BRANCH_PROTECTION.md](docs/BRANCH_PROTECTION.md) for the public ruleset and a refused direct push. Pull requests from forks get no secrets (GitHub's
default); the workflow never uses `pull_request_target`, and the end-to-end check fails for a fork until a maintainer
has read the change and reruns it from a branch in this repository.

Measured reliability of these checks, and the Stryker results: [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md).

`mutation.yml` runs Stryker on demand, apart from the required checks. Its score describes how the unit tests react to
small rewrites of the rule code; it is not a count of real bugs caught.

## Run it locally

Requirements: Node 24+, pnpm, PostgreSQL, a Clerk **development** instance with a password-enabled `+clerk_test` user.

```bash
pnpm install
createdb leasing_test
cp .env.example .env.local   # fill in the Clerk development keys and the test user's password
set -a; source .env.local; set +a
pnpm db:reset
pnpm test:unit               # unit + integration
pnpm build && pnpm test:e2e  # starts next start and the sandboxed worker
```

## Taking this into your repository

Carries over as is:

- the Playwright configuration (zero retries, traces on failure, HTML report), the Clerk sign-in setup and storage
  state kept out of git
- the run-id data pattern: seed, isolate, clean up, survive a half-finished seed
- the sending boundary: allowlist format, per-provider recipient fields, payload scan, capture table
- the three safety controls and their tests, the worker sandbox script, the CI layout and fork policy

Must be adapted to your application:

- selectors and page flows, your seeding (API or SQL), your queue and worker entry points
- where your real provider calls live: each one moves behind the boundary
- your business rules: notice timing, scheduling rules, and the entry-policy scenarios your counsel confirms
- staging transports (Twilio test credentials, SendGrid sandbox mode, a Graph test tenant) sit behind the same
  boundary; they are not wired in this sample

## Limits

- This is a demonstrator of the method. It has never touched a real leasing application, and says nothing about one.
- It tests up to the sending boundary: not Twilio, SendGrid or Exchange delivery, and not e-signature.
- No claim of exactly-once delivery: the tested worker scenarios do not emit obsolete or duplicate notice intents.
- Exploratory findings 2 to 5 in [docs/EXPLORATORY_NOTE.md](docs/EXPLORATORY_NOTE.md) are logged, not fixed.
