"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ALL_NAV = [
  { href: "/dashboard", label: "Dashboard", roles: null },
  { href: "/kpi", label: "KPIs", roles: null },
  { href: "/sales", label: "Sales", roles: null },
  { href: "/purchase-orders", label: "PO & Invoices", roles: null },
  { href: "/finance", label: "Finance", roles: ["FINANCE", "ADMIN", "SCM"] },
  {
    href: "/warehouse",
    label: "Warehouse",
    roles: ["WAREHOUSE", "ADMIN", "SCM", "LOGISTICS"],
  },
  { href: "/products", label: "Products", roles: null },
  { href: "/suppliers", label: "Suppliers", roles: ["SCM", "ADMIN"] },
  { href: "/stock", label: "Stock Levels", roles: null },
  { href: "/settings", label: "Settings", roles: null },
];

export function NavBar({
  name,
  roleLabel,
  role,
}: {
  name: string;
  roleLabel: string;
  role: string;
}) {
  const pathname = usePathname();

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-2">
              <Image
                src="/jjangx3-logo.png"
                alt="JJANGX3"
                width={36}
                height={36}
                className="h-9 w-9 object-contain"
                priority
              />
              <span className="font-extrabold hidden sm:inline tracking-tight text-brand-ink">
                JJANGX3{" "}
                <span className="text-gray-400 font-medium">Supply Chain</span>
              </span>
            </Link>
            <nav className="flex items-center gap-1">
              {ALL_NAV.filter(
                (item) => item.roles === null || item.roles.includes(role)
              ).map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== "/dashboard" &&
                    pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                      active
                        ? "bg-brand/10 text-brand"
                        : "text-gray-600 hover:text-gray-900 hover:bg-black/5"
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="text-right hidden sm:block">
              <div className="font-medium text-gray-900 leading-tight">
                {name}
              </div>
              <div className="text-xs text-gray-500">{roleLabel}</div>
            </div>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="text-sm text-gray-600 hover:text-gray-900 underline underline-offset-2"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>
    </header>
  );
}
