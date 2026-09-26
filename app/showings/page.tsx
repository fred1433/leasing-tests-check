import { randomUUID } from "node:crypto";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { formatShowingWindow } from "@/lib/time";
import { book, cancel, reschedule } from "./actions";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  tenant_sms: "Text to tenant",
  tenant_email: "Email to tenant",
  calendar_event: "Calendar invite",
};

function statusLabel(status: string, error: string | null): string {
  switch (status) {
    case "queued":
      return "Waiting to send";
    case "running":
      return "Sending";
    case "sent":
      return "Sent";
    case "superseded":
      return `Not sent: ${error ?? "no longer true"}`;
    case "blocked":
      return `Blocked: ${error ?? ""}`;
    default:
      return `Failed: ${error ?? ""}`;
  }
}

export default async function ShowingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await auth.protect();
  const { portfolio, error } = await searchParams;
  const user = await currentUser();
  if (!portfolio) {
    return (
      <main>
        <h1>Showings</h1>
        <p className="note" data-testid="signed-in-as">
          Open a portfolio with ?portfolio=... Signed in as {user?.primaryEmailAddress?.emailAddress}.
        </p>
      </main>
    );
  }
  const pool = db();
  const units = (await pool.query("SELECT * FROM units WHERE run_id = $1 ORDER BY id", [portfolio])).rows;
  const showings = (await pool.query("SELECT * FROM showings WHERE run_id = $1 ORDER BY id", [portfolio])).rows;
  const jobs = (
    await pool.query("SELECT * FROM notification_jobs WHERE run_id = $1 ORDER BY showing_id, showing_version, id", [portfolio])
  ).rows;

  return (
    <main>
      <h1>Showings</h1>
      <p className="note" data-testid="signed-in-as">
        Synthetic data. Signed in as {user?.primaryEmailAddress?.emailAddress}.
      </p>
      {error ? (
        <p className="error" role="alert" data-testid="error">
          {error}
        </p>
      ) : null}
      {units.map((u) => (
        <section className="unit" key={u.id} data-testid={`unit-${u.label}`}>
          <h2>
            {u.address}, {u.label}
          </h2>
          <p className="note">Tenant in place: {u.tenant_name}</p>
          <form action={book} aria-label={`Book a showing for ${u.label}`}>
            <input type="hidden" name="portfolio" value={portfolio} />
            <input type="hidden" name="unitId" value={u.id} />
            <input type="hidden" name="requestKey" value={randomUUID()} />
            <label>
              Prospect
              <input name="prospectName" required />
            </label>
            <label>
              Prospect email
              <input name="prospectEmail" type="email" required />
            </label>
            <label>
              Date
              <input name="date" type="date" required />
            </label>
            <label>
              Time
              <input name="time" type="time" required />
            </label>
            <button type="submit">Book showing</button>
          </form>
          {showings
            .filter((s) => s.unit_id === u.id)
            .map((s) => (
              <div className="showing" key={s.id} data-status={s.status} data-testid={`showing-${s.id}`}>
                <strong data-testid="when">
                  {s.status === "cancelled" ? "Cancelled: " : ""}
                  {formatShowingWindow(new Date(s.starts_at), s.duration_minutes)}
                </strong>{" "}
                with {s.prospect_name}
                <ul className="notices" aria-label="Notices">
                  {jobs
                    .filter((j) => j.showing_id === s.id)
                    .map((j) => (
                      <li key={j.id} className={`status-${j.status}`} data-testid={`notice-${j.kind}-v${j.showing_version}`}>
                        {KIND_LABEL[j.kind]} for {formatShowingWindow(new Date(j.payload.startsAt), j.payload.durationMinutes)}:{" "}
                        {statusLabel(j.status, j.last_error)}
                      </li>
                    ))}
                </ul>
                {s.status === "booked" ? (
                  <>
                    <form action={reschedule} aria-label="Reschedule">
                      <input type="hidden" name="portfolio" value={portfolio} />
                      <input type="hidden" name="showingId" value={s.id} />
                      <label>
                        New date
                        <input name="date" type="date" required />
                      </label>
                      <label>
                        New time
                        <input name="time" type="time" required />
                      </label>
                      <button type="submit">Reschedule</button>
                    </form>
                    <form action={cancel} aria-label="Cancel showing">
                      <input type="hidden" name="portfolio" value={portfolio} />
                      <input type="hidden" name="showingId" value={s.id} />
                      <button className="secondary" type="submit">
                        Cancel showing
                      </button>
                    </form>
                  </>
                ) : null}
              </div>
            ))}
        </section>
      ))}
    </main>
  );
}
