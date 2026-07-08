-- ============================================================
-- Migration 0028 — Per-product stock "pieces per unit" divisor (2026-07-08)
-- ============================================================
-- Some inventory exports report a product at the individual-piece level even though the
-- product's SKU is the multi-pack (the sellable MAIN unit). E.g. JJ-DF-INDOOR-500GX16 is an
-- 8kg pack (16 x 500g) but the stock file lists 500g pieces; BC-ECO-CHK-MACK-70GX-6PCS is a
-- 5+1 six-pack but the file lists single 70g pouches. The COST is correct (per pack); only the
-- stock quantity needs dividing. Since the file uses the pack SKU directly (a factor-1 product
-- match), the -70G/-500G sku_mappings don't apply — so we divide by this per-product factor on
-- import instead. Default 1 = no change.
-- ============================================================
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock_pieces_per_unit NUMERIC NOT NULL DEFAULT 1
    CHECK (stock_pieces_per_unit > 0);

-- 8kg Classic Dry Food: file counts 500g pieces -> 16 per 8kg pack
UPDATE public.products SET stock_pieces_per_unit = 16
  WHERE sku IN ('JJ-DF-INDOOR-500GX16','JJ-DF-BABY-500GX16');

-- 70g 5+1 Eco pouch: file counts single 70g pouches -> 6 per pack
UPDATE public.products SET stock_pieces_per_unit = 6
  WHERE sku IN ('BC-ECO-CHK-MACK-70GX-6PCS','BC-ECO-CHK-SAR-70GX-6PCS','BC-ECO-CHK-SAL-TUNA-70GX-6PCS');
