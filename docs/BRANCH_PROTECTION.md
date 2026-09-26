# Protection of `main`

Checked on 2026-09-26.

## The rule, publicly readable

Ruleset "main: both checks required, no bypass" (id 24043882), visible at
https://github.com/fred1433/leasing-tests-check/rules and, without signing in, at
https://api.github.com/repos/fred1433/leasing-tests-check/rules/branches/main

- Required status checks, branch up to date: `Unit, integration and isolation` and
  `End to end (Playwright, real Clerk)`.
- Changes arrive by pull request only; no force push; no deletion.
- Bypass list: empty. Administrators, the repository owner included, are held to the same rules.

Classic branch protection with the same two required checks and "include administrators" is also on.

## A direct push, refused

An empty commit pushed straight to `main` by the repository owner on 2026-09-26:

```
remote: - 2 of 2 required status checks are expected.
 ! [remote rejected] HEAD -> main (push declined due to repository rule violations)
```

## History

The ruleset was added on 2026-09-26, after pull requests #1 to #5. Those were merged under the classic branch
protection only (required checks, administrators included), each after both checks had passed.
