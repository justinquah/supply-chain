import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getShopeeTokens } from "@/lib/shopee";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SyncButton } from "./sync-button";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ shopee?: string; shopee_error?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const profile = await getCurrentUser();
  const canManage = ["SUPER_ADMIN", "SCM", "ADMIN"].includes(profile?.role ?? "");

  const supabase = await createClient();
  const tokens = await getShopeeTokens();
  const environment = process.env.SHOPEE_ENVIRONMENT || "sandbox";
  const configured = !!process.env.SHOPEE_PARTNER_ID;
  const connected = !!tokens?.shop_id && !!tokens?.refresh_token;

  const { data: recentSyncs } = await supabase
    .from("sync_log")
    .select("*")
    .eq("provider", "SHOPEE")
    .order("created_at", { ascending: false })
    .limit(5);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Integrations and data sync</p>
      </div>

      {sp.shopee === "connected" && (
        <Banner ok>Shopee shop connected successfully.</Banner>
      )}
      {sp.shopee_error && (
        <Banner>Shopee connection failed: {decodeURIComponent(sp.shopee_error)}</Banner>
      )}
      {sp.error === "not_configured" && (
        <Banner>Shopee partner credentials are not configured on the server.</Banner>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Shopee Open API</CardTitle>
          <span
            className={
              "text-xs px-2 py-0.5 rounded-full font-medium " +
              (environment === "live"
                ? "bg-brand/10 text-brand"
                : "bg-amber-100 text-amber-700")
            }
          >
            {environment.toUpperCase()}
          </span>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Info label="Partner configured" value={configured ? "Yes" : "No"} />
            <Info
              label="Connection"
              value={connected ? "Connected" : "Not connected"}
              good={connected}
              bad={!connected}
            />
            <Info label="Shop ID" value={tokens?.shop_id || "—"} />
            <Info
              label="Token expires"
              value={
                tokens?.expires_at
                  ? new Date(tokens.expires_at).toLocaleString("en-MY")
                  : "—"
              }
            />
          </div>

          {canManage && (
            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
              <a
                href="/api/shopee/auth"
                className="inline-flex items-center rounded-lg bg-brand text-white text-sm font-medium px-3 py-1.5 hover:bg-brand-dark transition-colors"
              >
                {connected ? "Re-authorize shop" : "Connect Shopee shop"}
              </a>
              <SyncButton disabled={!connected} />
            </div>
          )}

          <p className="text-xs text-gray-400">
            {environment === "sandbox"
              ? "Sandbox mode — syncing pulls Shopee test data, not real inventory. Switch SHOPEE_ENVIRONMENT to 'live' after deploying to a public HTTPS domain."
              : "Live mode — syncing pulls real shop inventory into stock snapshots (source: Shopee API)."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent syncs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-2 pl-4 pr-3 font-medium">When</th>
                <th className="py-2 px-3 font-medium">Status</th>
                <th className="py-2 px-3 font-medium text-right">Items</th>
                <th className="py-2 px-3 font-medium text-right">Matched</th>
                <th className="py-2 px-3 font-medium text-right">Unmatched</th>
                <th className="py-2 pr-4 pl-3 font-medium">Message</th>
              </tr>
            </thead>
            <tbody>
              {(recentSyncs ?? []).map((s: any) => (
                <tr key={s.id} className="border-b border-gray-100">
                  <td className="py-2 pl-4 pr-3 text-gray-600">
                    {new Date(s.created_at).toLocaleString("en-MY")}
                  </td>
                  <td className="py-2 px-3">
                    <span
                      className={
                        s.status === "OK" ? "text-emerald-700" : "text-red-600"
                      }
                    >
                      {s.status}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{s.items_synced ?? "—"}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{s.matched ?? "—"}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{s.unmatched ?? "—"}</td>
                  <td className="py-2 pr-4 pl-3 text-gray-500 text-xs max-w-[260px] truncate">
                    {s.message || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(recentSyncs ?? []).length === 0 && (
            <p className="text-sm text-gray-500 py-6 text-center">No syncs yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Info({
  label,
  value,
  good,
  bad,
}: {
  label: string;
  value: string;
  good?: boolean;
  bad?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div
        className={
          "font-medium mt-0.5 " +
          (good ? "text-emerald-700" : bad ? "text-gray-500" : "text-gray-900")
        }
      >
        {value}
      </div>
    </div>
  );
}

function Banner({ children, ok }: { children: React.ReactNode; ok?: boolean }) {
  return (
    <div
      className={
        "text-sm rounded-md p-3 border " +
        (ok
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : "bg-red-50 text-red-700 border-red-200")
      }
    >
      {children}
    </div>
  );
}
