"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { appRoleSchema } from "@/types/index";
import type { AppRoleEnum } from "@/types/index";

/**
 * Invite a new user by email and assign a role.
 * Gated to ADMIN only. Validates role server-side against appRoleSchema.
 * Always passes role in invite metadata — the handle_new_user trigger requires it
 * (no GENERAL fallback after migration 0011).
 */
export async function inviteUser(
  email: string,
  role: AppRoleEnum,
  name: string
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("ADMIN");

  const roleResult = appRoleSchema.safeParse(role);
  if (!roleResult.success) {
    return { ok: false, error: "Invalid role. Must be one of: SCM, ACCOUNTS, FINANCE, ADMIN." };
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { role: roleResult.data, name },
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Update the role of an existing user.
 * Gated to ADMIN only. Validates role server-side against appRoleSchema.
 */
export async function updateUserRole(
  userId: string,
  role: AppRoleEnum
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("ADMIN");

  const roleResult = appRoleSchema.safeParse(role);
  if (!roleResult.success) {
    return { ok: false, error: "Invalid role. Must be one of: SCM, ACCOUNTS, FINANCE, ADMIN." };
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("profiles")
    .update({ role: roleResult.data })
    .eq("id", userId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true };
}
