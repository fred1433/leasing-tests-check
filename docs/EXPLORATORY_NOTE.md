# Exploratory testing note

Session: 2026-09-26, Frederic de Lavenne de Choulot.
Build: this demonstrator on `main` before the double-booking fix, run locally, Chromium desktop and a 390 px phone
viewport, clock moved through the test controls.
Charter: book, move and cancel showings the way a busy leasing agent would, and look for any way a tenant or a
prospect could receive a wrong, duplicate or missing message.

## Findings

1. **Double-clicking "Book showing" books the showing twice.** Reproduced 3 times out of 3. Two showings, two sets
   of queued notices: the tenant would get every notice twice. Logged with steps and evidence in
   [BUG_REPORT.md](BUG_REPORT.md), fixed, and covered by a regression test.
2. **Moving a showing creates a second calendar invite and never withdraws the first.** The prospect and the agent
   would hold two invites, one for the old time. Logged: the calendar adapter should update the existing event
   (Graph `PATCH /events/{id}`), which also sends an update email, so the same boundary applies.
3. **A showing moved after its notice went out is not announced until 10 a.m. the day before the new time.**
   Notice for Tuesday 2 p.m. sent Monday 10 a.m.; moved on Monday 3 p.m. to Thursday; the next tenant message is
   queued for Wednesday 10 a.m. The tenant may expect someone on Tuesday. Product question: send a change notice
   immediately when the earlier one already went out?
4. **Cancelling a showing after its notice went out sends nothing.** Same family as 3. Product question.
5. Rescheduling into the past is refused, but the message adds a second, confusing sentence ("No attempt to inform
   the tenant is recorded before the showing"). Minor wording issue.
6. Booking at 7:45 p.m. is refused because a 30-minute showing would end after 8 p.m.; the message names the rule.
   No issue.
7. At 390 px the forms wrap to two columns and every control stays reachable. No issue.

## Not explored in this session

Keyboard-only use, screen readers, slow networks, two agents editing the same showing at the same moment.
