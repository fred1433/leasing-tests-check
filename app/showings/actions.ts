"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { BookingRefused, bookShowing, cancelShowing, rescheduleShowing } from "@/lib/showings";
import { zonedInstant } from "@/lib/time";

const AGENT_EMAIL = "agent@office.example.test";

function parseLocal(date: FormDataEntryValue | null, time: FormDataEntryValue | null): Date {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ""));
  const t = /^(\d{2}):(\d{2})$/.exec(String(time ?? ""));
  if (!d || !t) throw new BookingRefused(["Enter a date and a time."]);
  return zonedInstant(Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2]));
}

async function run(portfolio: string, fn: (userId: string) => Promise<void>) {
  const { userId } = await auth.protect();
  let error: string | null = null;
  try {
    await fn(userId);
  } catch (e) {
    if (e instanceof BookingRefused) error = e.message;
    else throw e;
  }
  const q = new URLSearchParams({ portfolio });
  if (error) q.set("error", error);
  redirect(`/showings?${q.toString()}`);
}

export async function book(form: FormData) {
  const portfolio = String(form.get("portfolio"));
  await run(portfolio, async (userId) => {
    await bookShowing(db(), {
      unitId: Number(form.get("unitId")),
      prospectName: String(form.get("prospectName") ?? "").trim(),
      prospectEmail: String(form.get("prospectEmail") ?? "").trim(),
      agentEmail: AGENT_EMAIL,
      startsAt: parseLocal(form.get("date"), form.get("time")),
      createdBy: userId,
      requestKey: String(form.get("requestKey") ?? "") || undefined,
    });
  });
}

export async function reschedule(form: FormData) {
  const portfolio = String(form.get("portfolio"));
  await run(portfolio, async () => {
    await rescheduleShowing(db(), Number(form.get("showingId")), parseLocal(form.get("date"), form.get("time")));
  });
}

export async function cancel(form: FormData) {
  const portfolio = String(form.get("portfolio"));
  await run(portfolio, async () => {
    await cancelShowing(db(), Number(form.get("showingId")));
  });
}
