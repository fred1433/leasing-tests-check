# Measurements

Nothing here is an estimate. The latest measurement comes first; earlier ones are kept unchanged below, because
they describe the code as it was then.

## Current: `main` at 2ef18ad, 2026-09-26 afternoon

After pull requests #6 (row lock between the currency check and the outbound intent, fixture cleanup, verified
session revocation, booking kept apart from a recorded attempt to inform) and #7.

### Reliability of the required checks

Ten runs of the `ci` workflow on new GitHub-hosted runners, started one after another (workflow_dispatch, run ids
36252977993, 36253183576, 36253269463, 36253354382, 36253441126, 36253523041, 36253611569, 36253696562, 36253774402, 36253851359).

| | Result |
|---|---|
| Runs | 10, all green |
| End-to-end test executions | 90 (9 per run: 8 scenarios plus the Clerk sign-in step), 90 passed on the first attempt |
| Retries | 0: Playwright is configured with `retries: 0` |
| Unit and integration test executions | 950 (95 per run), 0 failures |
| Playwright suite duration | 20.5 s to 24.4 s |
| End-to-end job duration, including install and `next build` | 74 s to 98 s |
| Unit, integration and isolation job duration | 21 s to 29 s |
| Notification worker egress | blocked in all 10 runs |
| Test-user sessions confirmed revoked at the end of the run | 10 of 10 |

Found by measuring: the first batch of ten runs on this code was started all at once, and 7 of the 10 failed. Every
run signs in as the same Clerk test user, and since #6 each run's teardown revokes that user's sessions, so runs
revoked each other's sessions mid-test (runs 36252541005 to 36252578621). #7 queues end-to-end jobs on that shared
user; the ten runs above were then started one after another. Those seven failures are a property of sharing one
test account, not of the application; with one account per parallel run they would run concurrently.

### Mutation testing (separate from the required checks)

Run [36253006354](https://github.com/fred1433/leasing-tests-check/actions/runs/36253006354), same files as before.

| Mutants | Killed | Survived | No coverage | Timeout | Compile errors | Score |
|---|---|---|---|---|---|---|
| 550 | 408 | 115 | 27 | 0 | 0 | 74.18 % |

The 37 new mutants come from the new booking decision in `lib/policy/entry.ts`. Same reading as before: a grade of the
unit tests on the rule code, not a share of real bugs caught.

## Earlier measurement, kept as it was: `main` at aa85de3, 2026-09-26 morning

### Reliability of the required checks

Ten fresh runs of the `ci` workflow, each on a new GitHub-hosted runner (workflow_dispatch, run ids
36246832597, 36246828796, 36246825631, 36246822432, 36246819310, 36246815910, 36246812857, 36246809699, 36246805907, 36246801688).

| | Result |
|---|---|
| Runs | 10 |
| End-to-end test executions | 90 (9 per run: 8 scenarios plus the Clerk sign-in step), 90 passed on the first attempt |
| Retries | 0: Playwright is configured with `retries: 0`, so a pass cannot hide a retry |
| Failures | 0 |
| Unit and integration test executions | 800 (80 per run), 0 failures |
| Playwright suite duration | 19.5 s to 21.3 s |
| End-to-end job duration, including install and `next build` | 69 s to 81 s |
| Unit, integration and isolation job duration | 23 s to 37 s |
| Notification worker egress | blocked in all 10 runs (the worker refuses to start otherwise) |

Ten clean runs do not prove the suite can never flake; they are the measured starting point. The failing runs in this
repository's history are the intended ones (pull request #1 with the injected defect, the regression test of pull
request #2 before its fix) and the first attempt of run 36245954122, on the first push, which started before the
Clerk keys were added to the repository; its rerun (attempt 2) passed.

### Mutation testing (separate from the required checks)

Stryker 10 with the Vitest runner, on the rule code only: `lib/policy/entry.ts`, `lib/outbound/allowlist.ts`,
`lib/outbound/recipients.ts`, `lib/notifications.ts`. Run
[36246836415](https://github.com/fred1433/leasing-tests-check/actions/runs/36246836415), report attached as an artifact.

| Mutants | Killed | Survived | No coverage | Timeout | Compile errors | Score |
|---|---|---|---|---|---|---|
| 513 | 376 | 113 | 24 | 0 | 0 | 73.29 % |

What this number is: how the unit tests react to small automatic rewrites of that code. What it is not: a share of
real bugs caught. Most survivors change message wording or object fields the unit tests do not pin (those are pinned
end to end instead); the rendering of email and SMS payloads is covered by the Playwright suite, not by unit tests, so it
shows as "no coverage" here. A first Stryker pass led to five new unit tests (Graph `sendMail` recipient lists, a
field holding two addresses, 11-digit phone numbers, display-name wrappers, SMS prefix length).

Tooling note: with Vitest 5.0 Stryker 10.0 reported mutants as surviving that the tests plainly kill (a 15 % score
for the same code). Vitest is pinned to 4.1 until the runner supports 5.
