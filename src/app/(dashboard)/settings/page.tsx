"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ROLE_LABELS } from "@/lib/constants";

type User = {
  id: string;
  email: string;
  name: string;
  role: string;
  companyName: string | null;
  phone: string | null;
  isActive: boolean;
};

export default function SettingsPage() {
  const { data: session } = useSession();
  const currentUser = session?.user as any;
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  const [form, setForm] = useState({
    email: "",
    password: "",
    name: "",
    role: "ADMIN",
    companyName: "",
    phone: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadUsers() {
    const res = await fetch("/api/users");
    if (res.ok) setUsers(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    loadUsers();
  }, []);

  function openCreate() {
    setEditingUser(null);
    setForm({
      email: "",
      password: "",
      name: "",
      role: "ADMIN",
      companyName: "",
      phone: "",
    });
    setError("");
    setShowForm(true);
  }

  function openEdit(u: User) {
    setEditingUser(u);
    setForm({
      email: u.email,
      password: "",
      name: u.name,
      role: u.role,
      companyName: u.companyName || "",
      phone: u.phone || "",
    });
    setError("");
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const url = editingUser
      ? `/api/users/${editingUser.id}`
      : "/api/users";
    const method = editingUser ? "PATCH" : "POST";

    const body: any = {
      name: form.name,
      role: form.role,
      companyName: form.companyName || undefined,
      phone: form.phone || undefined,
    };

    if (!editingUser) {
      body.email = form.email;
      body.password = form.password;
    } else if (form.password) {
      body.password = form.password;
    }

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Failed to save user");
      setSaving(false);
      return;
    }

    setShowForm(false);
    setSaving(false);
    loadUsers();
  }

  async function toggleActive(u: User) {
    await fetch(`/api/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !u.isActive }),
    });
    loadUsers();
  }

  if (currentUser?.role !== "ADMIN") {
    return (
      <div className="text-center py-12 text-gray-500">
        You do not have access to settings.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-sm text-gray-500">Manage users and system configuration</p>
        </div>
        <Button onClick={openCreate}>Add User</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 font-medium">Name</th>
                    <th className="pb-2 font-medium">Email</th>
                    <th className="pb-2 font-medium">Role</th>
                    <th className="pb-2 font-medium">Company</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b">
                      <td className="py-3">{u.name}</td>
                      <td className="py-3 text-gray-500">{u.email}</td>
                      <td className="py-3">
                        <Badge variant="secondary">
                          {ROLE_LABELS[u.role] || u.role}
                        </Badge>
                      </td>
                      <td className="py-3 text-gray-500">
                        {u.companyName || "-"}
                      </td>
                      <td className="py-3">
                        <Badge
                          variant={u.isActive ? "default" : "destructive"}
                        >
                          {u.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="py-3 space-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(u)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleActive(u)}
                        >
                          {u.isActive ? "Deactivate" : "Activate"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={showForm} onOpenChange={setShowForm}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>
              {editingUser ? "Edit User" : "Add User"}
            </SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-6">
            {error && (
              <div className="bg-red-50 text-red-600 text-sm p-3 rounded-md border border-red-200">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.target.value })
                }
                required
              />
            </div>
            {!editingUser && (
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) =>
                    setForm({ ...form, email: e.target.value })
                  }
                  required
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>
                {editingUser ? "New Password (leave blank to keep)" : "Password"}
              </Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) =>
                  setForm({ ...form, password: e.target.value })
                }
                required={!editingUser}
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={form.role}
                onChange={(e) =>
                  setForm({ ...form, role: e.target.value })
                }
              >
                <option value="ADMIN">Admin</option>
                <option value="FINANCE">Finance</option>
                <option value="SUPPLIER">Supplier</option>
                <option value="LOGISTICS">Logistics</option>
              </select>
            </div>
            {(form.role === "SUPPLIER" || form.role === "LOGISTICS") && (
              <div className="space-y-2">
                <Label>Company Name</Label>
                <Input
                  value={form.companyName}
                  onChange={(e) =>
                    setForm({ ...form, companyName: e.target.value })
                  }
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                value={form.phone}
                onChange={(e) =>
                  setForm({ ...form, phone: e.target.value })
                }
              />
            </div>
            <div className="flex gap-2 pt-4">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : editingUser ? "Update" : "Create"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
