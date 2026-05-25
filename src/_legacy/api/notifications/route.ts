import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { searchParams } = req.nextUrl;
  const unreadOnly = searchParams.get("unreadOnly") === "true";
  const limit = parseInt(searchParams.get("limit") || "20");

  const where: any = { userId: user.id };
  if (unreadOnly) where.isRead = false;

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.notification.count({
      where: { userId: user.id, isRead: false },
    }),
  ]);

  return NextResponse.json({ notifications, unreadCount });
}

// Mark notifications as read
export async function PATCH(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const body = await req.json();
  const { notificationIds, markAllRead } = body;

  if (markAllRead) {
    await prisma.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true },
    });
  } else if (notificationIds?.length) {
    await prisma.notification.updateMany({
      where: { id: { in: notificationIds }, userId: user.id },
      data: { isRead: true },
    });
  }

  return NextResponse.json({ success: true });
}
