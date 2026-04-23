import { prisma } from "./prisma";

export type NotificationType =
  | "PO_SENT"
  | "PO_APPROVED"
  | "PO_REJECTED"
  | "ETA_CHANGED"
  | "ETA_REQUEST"
  | "ETA_REQUEST_RESPONSE"
  | "PAYMENT_DUE"
  | "PAYMENT_PAID"
  | "DOC_UPLOADED"
  | "SHIPMENT_UPDATE"
  | "BATCH_UPDATED";

export async function createNotification(params: {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
}) {
  return prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      title: params.title,
      message: params.message,
      link: params.link || null,
    },
  });
}

// Notify multiple users at once
export async function notifyUsers(
  userIds: string[],
  type: NotificationType,
  title: string,
  message: string,
  link?: string
) {
  return prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      type,
      title,
      message,
      link: link || null,
    })),
  });
}

// Notify all users with a specific role
export async function notifyRole(
  role: string,
  type: NotificationType,
  title: string,
  message: string,
  link?: string
) {
  const users = await prisma.user.findMany({
    where: { role, isActive: true },
    select: { id: true },
  });
  if (users.length === 0) return;
  return notifyUsers(users.map((u) => u.id), type, title, message, link);
}
