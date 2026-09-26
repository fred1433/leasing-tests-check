# Measurements

Measured on 2026-09-26 on `main` at aa85de3. Nothing here is an estimate.

## Reliability of the required checks

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

## Mutation testing (separate from the required checks)

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
