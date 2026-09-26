# Risk-ranked test plan: leasing CRM MVP

Scope: a leasing CRM that takes leads, holds SMS and email conversations, books showings with automated tenant
notices, and generates leases for e-signature. Ranked by harm to a real person times likelihood of a regression.
"Automate" means a Playwright or integration test on every pull request; "manual" means exploratory passes on each
release candidate, desktop and phone.

| Rank | Risk | Who is hurt | Automate | Keep manual |
|---|---|---|---|---|
| 1 | A message reaches a real tenant or prospect from a test or staging run | Tenants, the company's sender reputation | Sending boundary with allowlist on every channel (SMS, email, calendar invites, auth messages), provider credentials absent from test, worker network isolation. Challenge cases for each. | Review of every new provider call site in code review |
| 2 | A stale or duplicate notice goes out after a showing is moved or cancelled | Tenant in place (wrong time, unexpected entry) | Reschedule and cancel flows end to end through the real worker, with retries and a controllable clock (this repository) | Wording of notices, phone rendering |
| 3 | A showing is booked without the entry prerequisites (no termination notice or agreement, outside 8 a.m. to 8 p.m.) | Tenant, the landlord at the Board | Selected entry-policy scenarios with boundary and DST tests (this repository) | Cases outside the modelled scenarios, reviewed with counsel |
| 4 | Lease generated with wrong party, rent, dates, or sent for signature to the wrong address | Applicant, company | Template field mapping against fixtures; e-signature call behind the same boundary; signing webhook handling with replayed payloads | Legal review of templates; one full signing on a sandbox account per release |
| 5 | Two leads merged that are different people (shared family or house phone), or one person split in two | Both leads: their conversations are shown to the wrong person | API-level tests that refuse an uncertain merge; merge only on the rule the business chooses | The merge policy itself is a business decision, not something tests should invent |
| 6 | Conversation timeline out of order or missing an inbound message (webhook retries, delivery callbacks arriving late) | Leasing staff answer the wrong thing | Webhook idempotency and ordering tests with replayed provider payloads | Reading real threads on staging |
| 7 | Access: a signed-out user or the wrong staff role reaches tenant data | Tenants | Signed-out and role checks on every protected route and server action | Periodic review of roles |
| 8 | Scheduling rules drift (double booking an agent, buffer times, holidays) | Staff, prospects | Rule tests at the domain level, one end-to-end booking per rule family | New rules as they ship |

## What this repository covers today

Ranks 1 to 3 for the showings flow, end to end. Ranks 4 to 8 are named so they are not forgotten; none of them is
automated here, and nothing in this repository claims otherwise.

## How the suite stays trustworthy

- Zero retries in CI: a pass is a first-attempt pass, and a flaky test is visible, not absorbed.
- Traces retained on failure, never uploaded for passing runs.
- One Playwright worker because the application clock is shared; data isolated per test by run id and removed after.
- Selectors are roles, labels and test ids, not CSS structure.
- A test that waits for the notification worker waits on the queue state, not on a fixed sleep.
