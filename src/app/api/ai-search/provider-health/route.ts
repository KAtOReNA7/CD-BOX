import { NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/auth/current-user";
import { isProviderCheck, providerChecks, runProviderCheck } from "@/lib/ai/provider-health";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = await requireApiOwner();
  if (!auth.authorized) return auth.response;

  const check = new URL(request.url).searchParams.get("check");
  if (!isProviderCheck(check)) {
    return NextResponse.json({ error: `check must be one of: ${providerChecks.join(", ")}` }, { status: 400 });
  }

  return NextResponse.json(await runProviderCheck(check));
}
