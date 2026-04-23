import { prisma } from "./prisma";

/**
 * Generate PO number in format: BC-PO-YYMM-NNN
 * e.g. BC-PO-2604-001
 */
export async function generatePONumber(): Promise<string> {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `BC-PO-${yy}${mm}-`;

  // Count existing POs with this prefix
  const count = await prisma.purchaseOrder.count({
    where: {
      poNumber: { startsWith: prefix },
    },
  });

  const seq = String(count + 1).padStart(3, "0");
  return `${prefix}${seq}`;
}
