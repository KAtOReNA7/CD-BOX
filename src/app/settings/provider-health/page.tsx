import { requirePageOwner } from "@/lib/auth/current-user";
import { isProviderCheck, providerChecks, runProviderCheck } from "@/lib/ai/provider-health";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function ProviderHealthPage({
  searchParams,
}: {
  searchParams: Promise<{ check?: string }>;
}) {
  await requirePageOwner();
  const requestedCheck = (await searchParams).check;
  const check = isProviderCheck(requestedCheck) ? requestedCheck : "models";
  const result = await runProviderCheck(check);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <div>
        <p className="text-sm text-muted-foreground">Owner-only diagnostics</p>
        <h1 className="text-2xl font-semibold">AI provider health</h1>
      </div>
      <nav className="flex flex-wrap gap-3">
        {providerChecks.map((item) => (
          <a className="border px-3 py-2 text-sm" href={`/settings/provider-health?check=${item}`} key={item}>
            {item}
          </a>
        ))}
      </nav>
      <pre className="overflow-auto border bg-white p-4 text-sm" data-testid="provider-health-result">
        {JSON.stringify(result, null, 2)}
      </pre>
    </main>
  );
}
