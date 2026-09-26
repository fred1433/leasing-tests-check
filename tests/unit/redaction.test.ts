import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEiLCJzaWQiOiJzZXNzXzEifQ.c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWduYXR1cmU";

function traceFolder(members: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "redact-"));
  const spec = join(dir, "members.json");
  writeFileSync(spec, JSON.stringify(members));
  execFileSync("python3", [
    "-c",
    "import json,sys,zipfile; m=json.load(open(sys.argv[1])); z=zipfile.ZipFile(sys.argv[2],'w'); [z.writestr(k,v) for k,v in m.items()]; z.close()",
    spec,
    join(dir, "trace.zip"),
  ]);
  return dir;
}

function readZip(dir: string): string {
  return execFileSync("python3", ["-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(''.join(z.read(n).decode() for n in z.namelist()))", join(dir, "trace.zip")], {
    encoding: "utf8",
  });
}

describe("trace redaction before upload", () => {
  it("removes session cookies, JWTs, dev-browser and testing tokens, and keeps the useful text", () => {
    const network = JSON.stringify({
      type: "resource-snapshot",
      snapshot: {
        request: { url: `https://x.clerk.accounts.dev/v1/client?__clerk_db_jwt=dvb_abc123def456`, headers: [{ name: "Cookie", value: `__session=${JWT}` }] },
        response: { cookies: [{ name: "__client_uat", value: "1790000000" }] },
      },
    });
    const dir = traceFolder({
      "0-trace.network": network,
      "resources/body.json": `{"jwt":"${JWT}","note":"Tuesday, October 6, 2:00 p.m."}`,
      "0-trace.trace": JSON.stringify({ type: "action", url: "http://localhost/?__clerk_testing_token=tt_secret_value" }),
    });
    const result = spawnSync("python3", ["scripts/redact_traces.py", dir], { encoding: "utf8" });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const text = readZip(dir);
    expect(text).not.toContain(JWT);
    expect(text).not.toContain("dvb_abc123def456");
    expect(text).not.toContain("tt_secret_value");
    expect(text).not.toContain("1790000000");
    expect(text).toContain("Tuesday, October 6, 2:00 p.m.");
  });

  it("fails, so nothing is uploaded, when a known secret survives in an unrecognised shape", () => {
    const dir = traceFolder({ "resources/body.txt": "password is Correct-Horse-Battery-9" });
    const result = spawnSync("python3", ["scripts/redact_traces.py", dir], {
      encoding: "utf8",
      env: { ...process.env, FORBIDDEN_VALUES: "Correct-Horse-Battery-9" },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/LEAK remains/);
  });
});
