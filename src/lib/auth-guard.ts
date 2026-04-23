import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "./auth";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "FINANCE" | "SUPPLIER" | "LOGISTICS";
  companyName: string | null;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  return session.user as SessionUser;
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function requireRole(...roles: string[]) {
  const user = await getSessionUser();
  if (!user) return { user: null as null, response: unauthorized() };
  if (!roles.includes(user.role))
    return { user: null as null, response: forbidden() };
  return { user, response: null };
}
