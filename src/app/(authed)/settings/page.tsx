import { requireRole, createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UsersTable } from "./users-table";

export default async function SettingsPage() {
  // Gate: ADMIN and SCM (SCM = ADMIN) can access settings/user-management.
  await requireRole("ADMIN", "SCM");

  const supabase = await createClient();
  const { data: users } = await supabase
    .from("profiles")
    .select("id, email, name, role")
    .eq("is_active", true)
    .order("name");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Application settings and administration
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>User &amp; Role Management</CardTitle>
        </CardHeader>
        <CardContent>
          <UsersTable users={users ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}
