import { NextResponse } from "next/server";
import { deploymentIdentity } from "@/lib/deployment";

export const dynamic = "force-dynamic";

/** Lets the suite prove it is testing the build of this commit, not a server left over from another run. */
export function GET() {
  const { target, deploymentId } = deploymentIdentity();
  return NextResponse.json({ target, deploymentId });
}
