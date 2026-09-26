/**
 * Explicit deployment identity.
 *
 * `next build` and `next start` always run with NODE_ENV=production, including on
 * staging, so NODE_ENV cannot tell staging from production. Every process that can
 * send (the web server and the notification worker) must be told what it is.
 */
export type DeploymentTarget = "test" | "staging";

export class DeploymentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeploymentConfigError";
  }
}

export interface DeploymentIdentity {
  target: DeploymentTarget;
  deploymentId: string;
}

/** Credentials a test process must never hold. The test target needs none of them. */
const PROVIDER_SECRETS = [
  "TWILIO_AUTH_TOKEN",
  "TWILIO_API_KEY_SECRET",
  "SENDGRID_API_KEY",
  "GRAPH_CLIENT_SECRET",
  "AZURE_CLIENT_SECRET",
] as const;

export function productionCredentialFindings(env: NodeJS.ProcessEnv, target: DeploymentTarget): string[] {
  const findings: string[] = [];
  const clerkSecret = env.CLERK_SECRET_KEY ?? "";
  const clerkPublishable = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  if (clerkSecret.startsWith("sk_live_")) findings.push("CLERK_SECRET_KEY is a production key (sk_live_)");
  if (clerkPublishable.startsWith("pk_live_")) findings.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is a production key (pk_live_)");
  if (target === "test") {
    for (const name of PROVIDER_SECRETS) {
      if (env[name]) findings.push(`${name} is set, but the test target sends nothing to providers`);
    }
  }
  return findings;
}

export function deploymentIdentity(env: NodeJS.ProcessEnv = process.env): DeploymentIdentity {
  const raw = env.DEPLOYMENT_TARGET;
  if (raw === "production") {
    throw new DeploymentConfigError("DEPLOYMENT_TARGET=production: this suite and its test controls never run against production.");
  }
  if (raw !== "test" && raw !== "staging") {
    throw new DeploymentConfigError(
      `DEPLOYMENT_TARGET must be "test" or "staging" (got ${raw ? `"${raw}"` : "nothing"}). NODE_ENV is deliberately not used to decide.`,
    );
  }
  const deploymentId = env.DEPLOYMENT_ID;
  if (!deploymentId) {
    throw new DeploymentConfigError("DEPLOYMENT_ID is required so every capture and report names the build it came from.");
  }
  const findings = productionCredentialFindings(env, raw);
  if (findings.length > 0) {
    throw new DeploymentConfigError(`Refusing to start: ${findings.join("; ")}.`);
  }
  return { target: raw, deploymentId };
}
