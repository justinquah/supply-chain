export const ROLES = {
  ADMIN: "ADMIN",
  FINANCE: "FINANCE",
  SUPPLIER: "SUPPLIER",
  LOGISTICS: "LOGISTICS",
} as const;

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  FINANCE: "Finance",
  SUPPLIER: "Supplier",
  LOGISTICS: "Logistics",
};

export const PO_STATUSES = {
  DRAFT: "DRAFT",
  PENDING_SUPPLIER: "PENDING_SUPPLIER",
  CONFIRMED: "CONFIRMED",
  IN_TRANSIT: "IN_TRANSIT",
  CUSTOMS: "CUSTOMS",
  RECEIVED: "RECEIVED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;

export const PO_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_SUPPLIER: "Pending Supplier",
  CONFIRMED: "Confirmed",
  IN_TRANSIT: "In Transit",
  CUSTOMS: "Customs",
  RECEIVED: "Received",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const PO_STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  PENDING_SUPPLIER: "bg-yellow-100 text-yellow-700",
  CONFIRMED: "bg-blue-100 text-blue-700",
  IN_TRANSIT: "bg-purple-100 text-purple-700",
  CUSTOMS: "bg-amber-100 text-amber-700",
  RECEIVED: "bg-green-100 text-green-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-red-100 text-red-700",
};

export const SHIPMENT_STATUSES = {
  PENDING: "PENDING",
  SHIPPED: "SHIPPED",
  IN_TRANSIT: "IN_TRANSIT",
  AT_PORT: "AT_PORT",
  CUSTOMS_CLEARANCE: "CUSTOMS_CLEARANCE",
  CLEARED: "CLEARED",
  DELIVERED: "DELIVERED",
} as const;

export const SHIPMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  SHIPPED: "Shipped",
  IN_TRANSIT: "In Transit",
  AT_PORT: "At Port",
  CUSTOMS_CLEARANCE: "Customs Clearance",
  CLEARED: "Cleared",
  DELIVERED: "Delivered",
};

export const SHIPMENT_STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-700",
  SHIPPED: "bg-blue-100 text-blue-700",
  IN_TRANSIT: "bg-purple-100 text-purple-700",
  AT_PORT: "bg-amber-100 text-amber-700",
  CUSTOMS_CLEARANCE: "bg-orange-100 text-orange-700",
  CLEARED: "bg-green-100 text-green-700",
  DELIVERED: "bg-emerald-100 text-emerald-700",
};

export const PAYMENT_STATUSES = {
  PENDING: "PENDING",
  PAID: "PAID",
  OVERDUE: "OVERDUE",
} as const;

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  PAID: "Paid",
  OVERDUE: "Overdue",
};

export const PAYMENT_STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  PAID: "bg-green-100 text-green-700",
  OVERDUE: "bg-red-100 text-red-700",
};

export const PAYMENT_TYPES = {
  DEPOSIT: "DEPOSIT",
  BALANCE: "BALANCE",
  OTHER: "OTHER",
} as const;

export const DOCUMENT_TYPES = {
  BL: "BL",
  COMMERCIAL_INVOICE: "COMMERCIAL_INVOICE",
  PACKING_LIST: "PACKING_LIST",
  K1: "K1",
  OTHER: "OTHER",
} as const;

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  BL: "Bill of Lading",
  COMMERCIAL_INVOICE: "Commercial Invoice",
  PACKING_LIST: "Packing List",
  K1: "K1 (Customs Form)",
  OTHER: "Other",
};

export const CONTAINER_TYPES = {
  "20FT": "20FT",
  "40FT": "40FT",
  LCL: "LCL",
} as const;

export const CONTAINER_TYPE_LABELS: Record<string, string> = {
  "20FT": "20ft Container",
  "40FT": "40ft Container",
  LCL: "LCL (Less than Container Load)",
};

export function formatCurrency(amount: number): string {
  return `RM ${amount.toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
