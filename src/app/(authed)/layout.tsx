import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { NavBar } from "@/components/nav-bar";

const ROLE_LABELS: Record<string, string> = {
  SCM: "Supply Chain Manager",
  ACCOUNTS: "Accounts",
  FINANCE: "Finance",
  ADMIN: "Admin",
  WAREHOUSE: "Warehouse",
};

export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentUser();
  if (!profile) redirect("/login");

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <NavBar
        name={profile.name}
        roleLabel={ROLE_LABELS[profile.role] || profile.role}
        role={profile.role}
      />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
    </div>
  );
}
