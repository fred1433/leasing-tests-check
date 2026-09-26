import { describe, expect, it } from "vitest";
import { DeploymentConfigError, deploymentIdentity } from "@/lib/deployment";

const ok = { DEPLOYMENT_TARGET: "test", DEPLOYMENT_ID: "ci-123" };

describe("deployment identity", () => {
  it("accepts an explicit test identity", () => {
    expect(deploymentIdentity({ ...ok } as unknown as NodeJS.ProcessEnv)).toEqual({ target: "test", deploymentId: "ci-123" });
  });

  it("does not infer anything from NODE_ENV (next start always sets production)", () => {
    expect(() => deploymentIdentity({ NODE_ENV: "production", DEPLOYMENT_ID: "x" } as unknown as NodeJS.ProcessEnv)).toThrow(/NODE_ENV is deliberately not used/);
    expect(() => deploymentIdentity({ NODE_ENV: "test", DEPLOYMENT_ID: "x" } as unknown as NodeJS.ProcessEnv)).toThrow(DeploymentConfigError);
  });

  it("refuses production outright", () => {
    expect(() => deploymentIdentity({ ...ok, DEPLOYMENT_TARGET: "production" } as unknown as NodeJS.ProcessEnv)).toThrow(/never run against production/);
  });

  it("requires a deployment id", () => {
    expect(() => deploymentIdentity({ DEPLOYMENT_TARGET: "test" } as unknown as NodeJS.ProcessEnv)).toThrow(/DEPLOYMENT_ID/);
  });

  it("refuses to start with a production Clerk key", () => {
    expect(() => deploymentIdentity({ ...ok, CLERK_SECRET_KEY: "sk_live_abc" } as unknown as NodeJS.ProcessEnv)).toThrow(/sk_live_/);
  });

  it.each(["TWILIO_AUTH_TOKEN", "SENDGRID_API_KEY", "GRAPH_CLIENT_SECRET"])("refuses to start on the test target holding %s", (name) => {
    expect(() => deploymentIdentity({ ...ok, [name]: "anything" } as unknown as NodeJS.ProcessEnv)).toThrow(new RegExp(name));
  });
});
