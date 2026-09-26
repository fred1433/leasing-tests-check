/**
 * Ends every active session of the test user. Every HTTP response is checked, and the
 * function throws if any call fails or a session is still active afterwards, so a run
 * cannot report "revoked" when it was not.
 */
export async function revokeTestUserSessions(opts: {
  secretKey: string;
  email: string;
  fetchImpl?: typeof fetch;
  apiBase?: string;
}): Promise<number> {
  const f = opts.fetchImpl ?? fetch;
  const base = opts.apiBase ?? "https://api.clerk.com/v1";
  const headers = { Authorization: `Bearer ${opts.secretKey}` };
  const getJson = async <T>(url: string): Promise<T> => {
    const res = await f(url, { headers });
    if (!res.ok) throw new Error(`Clerk ${res.status} on GET ${url.replace(base, "")}`);
    return (await res.json()) as T;
  };
  const users = await getJson<Array<{ id: string }>>(`${base}/users?email_address=${encodeURIComponent(opts.email)}`);
  if (users.length !== 1) throw new Error(`expected exactly one Clerk test user for ${opts.email}, found ${users.length}`);
  const userId = users[0].id;
  const active = () => getJson<Array<{ id: string }>>(`${base}/sessions?user_id=${userId}&status=active&limit=500`);
  const sessions = await active();
  for (const session of sessions) {
    const res = await f(`${base}/sessions/${session.id}/revoke`, { method: "POST", headers });
    if (!res.ok) throw new Error(`Clerk ${res.status} revoking session ${session.id}`);
  }
  const left = await active();
  if (left.length > 0) throw new Error(`${left.length} test-user session(s) still active after revocation`);
  return sessions.length;
}
