"use client";

import { useState, useTransition } from "react";
import { ROLES, ROLE_LABELS } from "@/lib/constants";
import { inviteUser, updateUserRole } from "./actions";
import { Button } from "@/components/ui/button";

type UserRow = {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
};

const ROLE_OPTIONS = Object.keys(ROLES) as (keyof typeof ROLES)[];

export function UsersTable({ users }: { users: UserRow[] }) {
  const [isPending, startTransition] = useTransition();

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<string>(ROLE_OPTIONS[0]);
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Per-row change messages
  const [rowMsgs, setRowMsgs] = useState<Record<string, { ok: boolean; text: string }>>({});

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteMsg(null);
    startTransition(async () => {
      const res = await inviteUser(inviteEmail, inviteRole as any, inviteName);
      if (res.ok) {
        setInviteMsg({ ok: true, text: "Invite sent. The user will receive an email to set their password." });
        setInviteEmail("");
        setInviteName("");
        setInviteRole(ROLE_OPTIONS[0]);
      } else {
        setInviteMsg({ ok: false, text: res.error ?? "Unknown error" });
      }
    });
  }

  function handleRoleChange(userId: string, newRole: string) {
    setRowMsgs((prev) => ({ ...prev, [userId]: { ok: true, text: "Saving…" } }));
    startTransition(async () => {
      const res = await updateUserRole(userId, newRole as any);
      setRowMsgs((prev) => ({
        ...prev,
        [userId]: res.ok
          ? { ok: true, text: "Role updated." }
          : { ok: false, text: res.error ?? "Failed to update role." },
      }));
    });
  }

  return (
    <div className="space-y-8">
      {/* User list */}
      <div>
        <h2 className="text-base font-medium text-gray-900 mb-3">Current Users</h2>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                <th className="py-2.5 pl-4 pr-3 font-medium">Name</th>
                <th className="py-2.5 px-3 font-medium">Email</th>
                <th className="py-2.5 px-3 font-medium">Role</th>
                <th className="py-2.5 pl-3 pr-4 font-medium">Change role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="py-2.5 pl-4 pr-3 font-medium text-gray-900">
                    {u.name || "—"}
                  </td>
                  <td className="py-2.5 px-3 text-gray-600">{u.email || "—"}</td>
                  <td className="py-2.5 px-3 text-gray-600">
                    {ROLE_LABELS[u.role] ?? u.role}
                  </td>
                  <td className="py-2.5 pl-3 pr-4">
                    <div className="flex items-center gap-2">
                      <select
                        defaultValue={u.role}
                        disabled={isPending}
                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
                        className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                      {rowMsgs[u.id] && (
                        <span
                          className={
                            "text-xs " +
                            (rowMsgs[u.id].ok ? "text-emerald-600" : "text-red-600")
                          }
                        >
                          {rowMsgs[u.id].text}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-sm text-gray-400">
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite form */}
      <div>
        <h2 className="text-base font-medium text-gray-900 mb-3">Invite a New User</h2>
        <form onSubmit={handleInvite} className="bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-3 max-w-md">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Email *</label>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Name</label>
            <input
              type="text"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              placeholder="Full name"
              className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Role *</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Sending…" : "Send invite"}
            </Button>
            {inviteMsg && (
              <span
                className={
                  "text-sm " +
                  (inviteMsg.ok ? "text-emerald-600" : "text-red-600")
                }
              >
                {inviteMsg.text}
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
