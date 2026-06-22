import { getCurrentUser } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const profile = await getCurrentUser();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Application settings and administration
        </p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-base font-medium text-gray-900 mb-1">
          User &amp; Role Management
        </h2>
        <p className="text-sm text-gray-500">
          Admin user management will be available here. Invite users and assign
          roles (SCM, Accounts, Finance, Admin).
        </p>
      </div>
    </div>
  );
}
