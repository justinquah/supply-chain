"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
};

const typeColors: Record<string, string> = {
  PO_SENT: "bg-blue-100 text-blue-700",
  PO_APPROVED: "bg-green-100 text-green-700",
  PO_REJECTED: "bg-red-100 text-red-700",
  ETA_CHANGED: "bg-amber-100 text-amber-700",
  ETA_REQUEST: "bg-orange-100 text-orange-700",
  ETA_REQUEST_RESPONSE: "bg-purple-100 text-purple-700",
  PAYMENT_DUE: "bg-yellow-100 text-yellow-700",
  PAYMENT_PAID: "bg-green-100 text-green-700",
  DOC_UPLOADED: "bg-cyan-100 text-cyan-700",
  SHIPMENT_UPDATE: "bg-indigo-100 text-indigo-700",
  BATCH_UPDATED: "bg-teal-100 text-teal-700",
};

export default function NotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  async function loadNotifications() {
    const res = await fetch("/api/notifications?limit=50");
    if (res.ok) {
      const data = await res.json();
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadNotifications();
  }, []);

  async function markAllRead() {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAllRead: true }),
    });
    loadNotifications();
  }

  async function markRead(id: string) {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notificationIds: [id] }),
    });
  }

  function handleClick(notif: Notification) {
    markRead(notif.id);
    if (notif.link) {
      router.push(notif.link);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-gray-500">
            {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" onClick={markAllRead}>
            Mark All Read
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-gray-500">Loading...</p>
          ) : notifications.length === 0 ? (
            <p className="p-6 text-center text-gray-500">
              No notifications yet
            </p>
          ) : (
            <div className="divide-y">
              {notifications.map((notif) => (
                <div
                  key={notif.id}
                  className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                    !notif.isRead ? "bg-blue-50/50" : ""
                  }`}
                  onClick={() => handleClick(notif)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {!notif.isRead && (
                          <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                        )}
                        <Badge
                          className={
                            typeColors[notif.type] || "bg-gray-100 text-gray-700"
                          }
                        >
                          {notif.type.replace(/_/g, " ")}
                        </Badge>
                        <span className="font-medium text-sm">
                          {notif.title}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 ml-4">
                        {notif.message}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">
                      {format(new Date(notif.createdAt), "dd MMM HH:mm")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
