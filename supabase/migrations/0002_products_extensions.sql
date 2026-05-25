-- ============================================================
-- Migration 0002 — Products: multi-supplier, currencies, loading, unknown SKUs
-- 2026-05-13
-- ============================================================

-- ---- Currency enum ----
DO $$ BEGIN
  CREATE TYPE currency_code AS ENUM ('MYR','USD','CNY','THB');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---- products: new columns ----
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS cost_currency       currency_code DEFAULT 'MYR',
  ADD COLUMN IF NOT EXISTS loading_capacity    NUMERIC,
  ADD COLUMN IF NOT EXISTS pack_size           TEXT,
  ADD COLUMN IF NOT EXISTS product_family      TEXT,
  ADD COLUMN IF NOT EXISTS variation           TEXT;

-- Make unit_cost & supplier_id nullable (some imported rows have no cost/supplier yet)
ALTER TABLE products ALTER COLUMN unit_cost DROP NOT NULL;
ALTER TABLE products ALTER COLUMN supplier_id DROP NOT NULL;

-- ---- product_suppliers: many-to-many between products and supplier profiles ----
CREATE TABLE IF NOT EXISTS product_suppliers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  unit_cost       NUMERIC NOT NULL,          -- normalized cost per single main unit
  cost_currency   currency_code NOT NULL,
  cost_per_units  NUMERIC NOT NULL DEFAULT 1, -- original UOM (cost was quoted per N main units)
  is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, supplier_id)
);
CREATE INDEX IF NOT EXISTS idx_product_suppliers_product ON product_suppliers(product_id);
CREATE INDEX IF NOT EXISTS idx_product_suppliers_supplier ON product_suppliers(supplier_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_suppliers_primary
  ON product_suppliers(product_id) WHERE is_primary = TRUE;
DROP TRIGGER IF EXISTS product_suppliers_updated_at ON product_suppliers;
CREATE TRIGGER product_suppliers_updated_at BEFORE UPDATE ON product_suppliers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE product_suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ps_read ON product_suppliers;
CREATE POLICY ps_read ON product_suppliers FOR SELECT TO authenticated
  USING (
    has_role('SUPER_ADMIN','SCM','GENERAL','FINANCE','ADMIN','LOGISTICS','WAREHOUSE')
    OR (current_user_role() = 'SUPPLIER' AND supplier_id = auth.uid())
  );
DROP POLICY IF EXISTS ps_write ON product_suppliers;
CREATE POLICY ps_write ON product_suppliers FOR ALL TO authenticated
  USING (has_role('SUPER_ADMIN','SCM','ADMIN'))
  WITH CHECK (has_role('SUPER_ADMIN','SCM','ADMIN'));

-- ---- unknown_skus: log SKUs from sales imports that don't match any product/mapping ----
CREATE TABLE IF NOT EXISTS unknown_skus (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku           TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  occurrence_count INT NOT NULL DEFAULT 1,
  context       TEXT,                              -- e.g. 'monthly_sales_import_2026_05.xlsx'
  resolution    TEXT,                              -- 'PENDING','MAPPED','IGNORED','CREATED_PRODUCT'
  resolved_at   TIMESTAMPTZ,
  resolved_by   UUID REFERENCES profiles(id),
  notes         TEXT,
  UNIQUE (sku)
);
CREATE INDEX IF NOT EXISTS idx_unknown_skus_resolution ON unknown_skus(resolution);

ALTER TABLE unknown_skus ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS us_read ON unknown_skus;
CREATE POLICY us_read ON unknown_skus FOR SELECT TO authenticated
  USING (has_role('SUPER_ADMIN','SCM','ADMIN'));
DROP POLICY IF EXISTS us_write ON unknown_skus;
CREATE POLICY us_write ON unknown_skus FOR ALL TO authenticated
  USING (has_role('SUPER_ADMIN','SCM','ADMIN'))
  WITH CHECK (has_role('SUPER_ADMIN','SCM','ADMIN'));
