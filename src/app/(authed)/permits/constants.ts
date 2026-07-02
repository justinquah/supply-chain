// Shared display metadata for permits / licences.

export const PERMIT_TYPES = [
  "GS1",
  "DVS_IMPORT_WEST",
  "DVS_PENJUAL_WEST",
  "LKIM",
  "TRADEMARK",
  "DVS_SABAH_IMPORT",
  "DVS_SARAWAK_IMPORT",
  "OTHER",
] as const;
export type PermitType = (typeof PERMIT_TYPES)[number];

export const PERMIT_TYPE_LABELS: Record<string, string> = {
  GS1: "GS1 (barcode)",
  DVS_IMPORT_WEST: "DVS Import — West M'sia",
  DVS_PENJUAL_WEST: "DVS Penjual — West M'sia",
  LKIM: "LKIM",
  TRADEMARK: "Trademark",
  DVS_SABAH_IMPORT: "DVS Import — Sabah",
  DVS_SARAWAK_IMPORT: "DVS Import — Sarawak",
  OTHER: "Other",
};

export const PERMIT_STATUSES = ["ACTIVE", "PENDING_RENEWAL", "CANCELLED"] as const;
export type PermitStatus = (typeof PERMIT_STATUSES)[number];

export const PERMIT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  PENDING_RENEWAL: "Pending renewal",
  CANCELLED: "Cancelled",
};

// Window (days) before expiry within which a permit is flagged as "expiring soon".
export const EXPIRY_SOON_DAYS = 60;
