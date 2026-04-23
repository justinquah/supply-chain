import { z } from "zod";

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6, "Password must be at least 6 characters"),
  name: z.string().min(1, "Name is required"),
  role: z.enum(["ADMIN", "FINANCE", "SUPPLIER", "LOGISTICS"]),
  companyName: z.string().optional(),
  phone: z.string().optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(["ADMIN", "FINANCE", "SUPPLIER", "LOGISTICS"]).optional(),
  companyName: z.string().optional(),
  phone: z.string().optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6).optional(),
});

export const createProductSchema = z.object({
  sku: z.string().min(1, "SKU is required"),
  name: z.string().min(1, "Name is required"),
  categoryId: z.string().min(1, "Category is required"),
  supplierId: z.string().min(1, "Supplier is required"),
  unitCost: z.number().min(0),
  sellingPrice: z.number().min(0).optional(),
  weightPerUnit: z.number().min(0),
  volumePerUnit: z.number().min(0),
  unitsPerCarton: z.number().int().min(1).optional(),
  minOrderQty: z.number().int().min(1).optional(),
  reorderPoint: z.number().int().min(0).optional(),
});

export const updateProductSchema = createProductSchema.partial();

export const monthlySalesSchema = z.object({
  productId: z.string().min(1),
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  unitsSold: z.number().int().min(0),
});

export const createPOSchema = z.object({
  supplierId: z.string().min(1, "Supplier is required"),
  containerType: z.enum(["20FT", "40FT", "LCL"]).optional(),
  depositPercent: z.number().min(0).max(100).optional(),
  balanceDueDays: z.number().int().min(0).optional(),
  notes: z.string().optional(),
  lineItems: z.array(
    z.object({
      productId: z.string().min(1),
      quantity: z.number().int().min(1),
      unitCost: z.number().min(0),
    })
  ).min(1, "At least one line item is required"),
});

export const updateShipmentSchema = z.object({
  status: z.enum([
    "PENDING",
    "SHIPPED",
    "IN_TRANSIT",
    "AT_PORT",
    "CUSTOMS_CLEARANCE",
    "CLEARED",
    "DELIVERED",
  ]).optional(),
  etd: z.string().optional(),
  eta: z.string().optional(),
  portOfOrigin: z.string().optional(),
  portOfDest: z.string().optional(),
  shippingLine: z.string().optional(),
  vesselName: z.string().optional(),
  containerNumber: z.string().optional(),
  notes: z.string().optional(),
});

export const updatePaymentSchema = z.object({
  status: z.enum(["PENDING", "PAID", "OVERDUE"]).optional(),
  paidDate: z.string().optional(),
  notes: z.string().optional(),
});

export const containerConfigSchema = z.object({
  type: z.string().min(1),
  maxWeightKg: z.number().min(0),
  maxVolumeCbm: z.number().min(0),
  estimatedCost: z.number().min(0).optional(),
  description: z.string().optional(),
});
