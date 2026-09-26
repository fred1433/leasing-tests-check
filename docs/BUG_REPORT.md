# BUG: Double-clicking "Book showing" books the showing twice, and the tenant gets every notice twice

**Severity:** High. A tenant receives duplicate entry notices, and the calendar shows two showings for one visit.
**Priority:** Fix before the next release; agents double-click on slow connections.
**Found by:** exploratory testing, 2026-09-26 ([EXPLORATORY_NOTE.md](EXPLORATORY_NOTE.md), finding 1).
**Environment:** local build of `main` at 83dfa9b, Chromium, synthetic data. Reproduced 3 times out of 3.

## Steps to reproduce

1. Sign in and open a portfolio with a unit that has a notice of termination recorded (Unit B in the fixtures).
2. In "Book a showing for Unit B", enter a prospect name and email, date 2026-10-06, time 14:00.
3. Double-click **Book showing**.

## Expected

One showing for Tuesday, October 6, 2:00 p.m. to 2:30 p.m., with one text, one email and one calendar invite queued.

## Actual

Two identical showings, and six queued messages: the tenant would receive the text and the email twice, and the
prospect two calendar invites.

## Evidence

- Regression test, pushed alone before any fix: `tests/e2e/double-booking.spec.ts` (commit 2be467f).
- It failed in CI: https://github.com/fred1433/leasing-tests-check/actions/runs/36246471712
  `expect(locator).toHaveCount(1)`, received 2. The Playwright trace is attached to that run as the
  `playwright-traces` artifact.

## Cause

The booking server action inserts a new showing for every submission. Nothing ties two submissions of the same form
together, so the second request, sent before the first redirect returns, books again.

## Fix

Each rendered booking form carries a one-time request key. `showings.request_key` is unique; a repeated submission
hits the constraint (`ON CONFLICT DO NOTHING`), returns the existing showing and queues nothing. This holds under
concurrency: the second transaction waits for the first and then finds the key taken. Disabling the button while
the request is in flight is a useful addition, but not a fix on its own: a retrying proxy or a second tab can still
repeat the request.

## Fix verification

The same regression test, unchanged, passes on the fix commit, together with the whole suite:
https://github.com/fred1433/leasing-tests-check/pull/2 (checks tab).
