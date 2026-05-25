-- ============================================================
-- Migration 0007 — Product groups (ranges). Load size is a group-level total.
-- ============================================================

CREATE TABLE IF NOT EXISTS product_groups (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             TEXT NOT NULL UNIQUE,         -- e.g. "70g Eco pouch"
  category_id      UUID REFERENCES product_categories(id),
  loading_capacity NUMERIC,                      -- TOTAL units per container across all variations
  payment_terms    TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS product_groups_updated_at ON product_groups;
CREATE TRIGGER product_groups_updated_at BEFORE UPDATE ON product_groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE product_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pg_read ON product_groups;
CREATE POLICY pg_read ON product_groups FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS pg_write ON product_groups;
CREATE POLICY pg_write ON product_groups FOR ALL TO authenticated
  USING (has_role('SUPER_ADMIN','SCM','ADMIN'))
  WITH CHECK (has_role('SUPER_ADMIN','SCM','ADMIN'));

-- Populate from existing products. loading_capacity was duplicated onto each
-- variation during import; take a single representative value (MAX) as the group total.
INSERT INTO product_groups (name, loading_capacity)
SELECT product_family, MAX(loading_capacity)
FROM products
WHERE product_family IS NOT NULL AND product_family <> ''
GROUP BY product_family
ON CONFLICT (name) DO UPDATE SET loading_capacity = EXCLUDED.loading_capacity;

-- Set each group's category from any member product.
UPDATE product_groups g
SET category_id = (
  SELECT p.category_id FROM products p
  WHERE p.product_family = g.name AND p.category_id IS NOT NULL
  LIMIT 1
)
WHERE category_id IS NULL;

-- Clear the per-variation loading_capacity to avoid confusion — it now lives at group level.
UPDATE products SET loading_capacity = NULL WHERE loading_capacity IS NOT NULL;
