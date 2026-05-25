-- ============================================================
-- Supply Chain App — Initial Schema
-- Generated: 2026-05-13
-- ============================================================
-- Run this in Supabase SQL Editor:
--   1. Open project → SQL Editor (left sidebar)
--   2. Click "+ New query"
--   3. Paste this entire file
--   4. Click "Run" (or Cmd+Enter)
-- ============================================================

-- ------------------------------------------------------------
-- EXTENSIONS
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------
-- ENUMS
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM (
    'SUPER_ADMIN','SCM','GENERAL','FINANCE','ADMIN','LOGISTICS','WAREHOUSE','SUPPLIER'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE po_status AS ENUM (
    'PROPOSED','APPROVED','ISSUED','ACCEPTED','READY','IN_TRANSIT','CLEARING','DELIVERED','CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE proposal_source AS ENUM ('AUTO','MANUAL_SCM');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE shipment_method AS ENUM ('EX_FACTORY','FOB');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE shipment_status AS ENUM ('PENDING','IN_TRANSIT','CLEARING','DELIVERED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE doc_type AS ENUM (
    'PO_PDF','SUPPLIER_INVOICE','BL','PACKING_LIST','K1_DRAFT','K1_FINAL','LOGISTICS_INVOICE'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE approval_status AS ENUM ('NOT_REQUIRED','PENDING','APPROVED','REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payment_type AS ENUM ('SUPPLIER','LOGISTICS');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('PENDING','PAID');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE stock_source AS ENUM ('MANUAL','SHOPEE_API');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE line_qty_unit AS ENUM ('UNIT','CARTON');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ------------------------------------------------------------
-- HELPER FUNCTIONS
-- ------------------------------------------------------------

-- updated_at auto-update
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- NOTE: current_user_role / has_role / is_super_admin are defined AFTER the
-- profiles table (further down) because they reference public.profiles.

-- ============================================================
-- TABLES
-- ============================================================

-- 1. profiles ----------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          user_role NOT NULL DEFAULT 'GENERAL',
  company_name  TEXT,
  phone         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Auto-create profile on signup (reads role from user metadata if provided)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'GENERAL')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Helper functions that reference profiles (must come after profiles table)
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS user_role AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION has_role(VARIADIC roles user_role[])
RETURNS BOOLEAN AS $$
  SELECT current_user_role() = ANY(roles);
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT current_user_role() = 'SUPER_ADMIN';
$$ LANGUAGE SQL STABLE;

-- 2. product_categories ------------------------------------------
CREATE TABLE IF NOT EXISTS product_categories (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                     TEXT NOT NULL UNIQUE,
  default_target_turnover  NUMERIC NOT NULL DEFAULT 6,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS product_categories_updated_at ON product_categories;
CREATE TRIGGER product_categories_updated_at BEFORE UPDATE ON product_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3. products ----------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku               TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  category_id       UUID NOT NULL REFERENCES product_categories(id),
  supplier_id       UUID NOT NULL REFERENCES profiles(id),
  unit_cost         NUMERIC NOT NULL,
  units_per_carton  INT NOT NULL DEFAULT 1 CHECK (units_per_carton > 0),
  min_order_qty     INT NOT NULL DEFAULT 1,
  reorder_point     INT NOT NULL DEFAULT 0,
  target_turnover   NUMERIC,
  is_main           BOOLEAN NOT NULL DEFAULT TRUE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_products_is_main ON products(is_main) WHERE is_main = TRUE;
DROP TRIGGER IF EXISTS products_updated_at ON products;
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4. sku_mappings (bundle/fraction → main product) ---------------
CREATE TABLE IF NOT EXISTS sku_mappings (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  variant_sku         TEXT NOT NULL,
  variant_name        TEXT,
  main_product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  units_per_variant   NUMERIC NOT NULL CHECK (units_per_variant > 0),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sku_mappings_variant ON sku_mappings(variant_sku);
CREATE INDEX IF NOT EXISTS idx_sku_mappings_main ON sku_mappings(main_product_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sku_mappings_variant_main
  ON sku_mappings(variant_sku, main_product_id);
DROP TRIGGER IF EXISTS sku_mappings_updated_at ON sku_mappings;
CREATE TRIGGER sku_mappings_updated_at BEFORE UPDATE ON sku_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 5. monthly_sales -----------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_sales (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  year                INT NOT NULL CHECK (year >= 2020 AND year <= 2099),
  month               INT NOT NULL CHECK (month >= 1 AND month <= 12),
  variant_sku         TEXT NOT NULL,
  main_product_id     UUID REFERENCES products(id),
  qty_sold_variant    INT NOT NULL,
  units_equivalent    NUMERIC NOT NULL,
  uploaded_by         UUID REFERENCES profiles(id),
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_monthly_sales_yearmonth ON monthly_sales(year, month);
CREATE INDEX IF NOT EXISTS idx_monthly_sales_product ON monthly_sales(main_product_id);

-- 6. stock_snapshots ---------------------------------------------
CREATE TABLE IF NOT EXISTS stock_snapshots (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id    UUID NOT NULL REFERENCES products(id),
  quantity      INT NOT NULL,
  source        stock_source NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_snapshots_product_time
  ON stock_snapshots(product_id, recorded_at DESC);

-- 7. purchase_orders ---------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_orders (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_number             TEXT UNIQUE,
  supplier_id           UUID NOT NULL REFERENCES profiles(id),
  status                po_status NOT NULL DEFAULT 'PROPOSED',
  proposal_source       proposal_source NOT NULL,
  proposal_reason       TEXT,
  currency              TEXT NOT NULL DEFAULT 'MYR' CHECK (currency IN ('MYR','USD')),
  proposed_by           UUID REFERENCES profiles(id),
  proposed_at           TIMESTAMPTZ DEFAULT NOW(),
  approved_by           UUID REFERENCES profiles(id),
  approved_at           TIMESTAMPTZ,
  issued_by             UUID REFERENCES profiles(id),
  issued_at             TIMESTAMPTZ,
  supplier_accepted_at  TIMESTAMPTZ,
  stock_ready_date      DATE,
  shipment_method       shipment_method,
  total_amount          NUMERIC NOT NULL DEFAULT 0,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
DROP TRIGGER IF EXISTS purchase_orders_updated_at ON purchase_orders;
CREATE TRIGGER purchase_orders_updated_at BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 8. po_line_items -----------------------------------------------
CREATE TABLE IF NOT EXISTS po_line_items (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id               UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id          UUID NOT NULL REFERENCES products(id),
  quantity_unit       line_qty_unit NOT NULL DEFAULT 'UNIT',
  quantity            INT NOT NULL CHECK (quantity > 0),
  unit_cost           NUMERIC NOT NULL,
  units_equivalent    INT NOT NULL,
  line_total          NUMERIC GENERATED ALWAYS AS (quantity * unit_cost) STORED,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_line_items_po ON po_line_items(po_id);

-- 9. shipments ---------------------------------------------------
CREATE TABLE IF NOT EXISTS shipments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id               UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  container_number    TEXT,
  estimated_eta       DATE,
  supplier_eta        DATE,
  final_eta           DATE,
  actual_arrival_date DATE,
  status              shipment_status NOT NULL DEFAULT 'PENDING',
  delivered_at        TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shipments_po ON shipments(po_id);
CREATE INDEX IF NOT EXISTS idx_shipments_eta ON shipments(final_eta);
DROP TRIGGER IF EXISTS shipments_updated_at ON shipments;
CREATE TRIGGER shipments_updated_at BEFORE UPDATE ON shipments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- View for "is_delayed" computation
CREATE OR REPLACE VIEW shipments_with_delay AS
SELECT s.*,
       CASE
         WHEN s.actual_arrival_date IS NOT NULL AND s.final_eta IS NOT NULL
           THEN s.actual_arrival_date > s.final_eta
         WHEN s.final_eta IS NOT NULL AND s.estimated_eta IS NOT NULL
           THEN s.final_eta > s.estimated_eta
         ELSE FALSE
       END AS is_delayed
FROM shipments s;

-- 10. po_documents -----------------------------------------------
CREATE TABLE IF NOT EXISTS po_documents (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id             UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  shipment_id       UUID REFERENCES shipments(id) ON DELETE SET NULL,
  doc_type          doc_type NOT NULL,
  file_path         TEXT NOT NULL,
  file_name         TEXT NOT NULL,
  uploaded_by       UUID REFERENCES profiles(id),
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approval_status   approval_status NOT NULL DEFAULT 'NOT_REQUIRED',
  approved_by       UUID REFERENCES profiles(id),
  approved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_documents_po ON po_documents(po_id);
CREATE INDEX IF NOT EXISTS idx_po_documents_shipment ON po_documents(shipment_id);
CREATE INDEX IF NOT EXISTS idx_po_documents_type ON po_documents(doc_type);

-- 11. payments ---------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id             UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  payment_type      payment_type NOT NULL,
  invoice_doc_id    UUID REFERENCES po_documents(id) ON DELETE SET NULL,
  payee_name        TEXT,
  amount            NUMERIC NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'MYR' CHECK (currency IN ('MYR','USD')),
  due_date          DATE,
  status            payment_status NOT NULL DEFAULT 'PENDING',
  paid_at           TIMESTAMPTZ,
  payment_slip_path TEXT,
  recorded_by       UUID REFERENCES profiles(id),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_po ON payments(po_id);
CREATE INDEX IF NOT EXISTS idx_payments_due_date ON payments(due_date);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
DROP TRIGGER IF EXISTS payments_updated_at ON payments;
CREATE TRIGGER payments_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 12. shipment_receipts ------------------------------------------
CREATE TABLE IF NOT EXISTS shipment_receipts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shipment_id   UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES products(id),
  qty_ordered   INT NOT NULL,
  qty_received  INT NOT NULL,
  qty_damaged   INT NOT NULL DEFAULT 0,
  qty_missing   INT NOT NULL DEFAULT 0,
  notes         TEXT,
  received_by   UUID REFERENCES profiles(id),
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shipment_receipts_shipment ON shipment_receipts(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_receipts_product ON shipment_receipts(product_id);

-- 13. receipt_photos ---------------------------------------------
CREATE TABLE IF NOT EXISTS receipt_photos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  receipt_id      UUID NOT NULL REFERENCES shipment_receipts(id) ON DELETE CASCADE,
  file_path       TEXT NOT NULL,
  caption         TEXT,
  uploaded_by     UUID REFERENCES profiles(id),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_receipt_photos_receipt ON receipt_photos(receipt_id);

-- 14. audit_log --------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id      UUID REFERENCES profiles(id),
  entity_type   TEXT NOT NULL,
  entity_id     UUID NOT NULL,
  action        TEXT NOT NULL,
  old_value     JSONB,
  new_value     JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);

-- 15. notifications ----------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     UUID,
  message       TEXT NOT NULL,
  is_read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- Pattern: SUPER_ADMIN bypasses everything; other roles get specific permissions.
-- Suppliers only see rows scoped to their own user_id.

ALTER TABLE profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE products            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sku_mappings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_sales       ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_snapshots     ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_line_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_documents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_receipts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_photos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications       ENABLE ROW LEVEL SECURITY;

-- profiles: users can see/edit themselves; SUPER_ADMIN/SCM/ADMIN see all
DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR has_role('SUPER_ADMIN','SCM','ADMIN'));
DROP POLICY IF EXISTS profiles_update_self ON profiles;
CREATE POLICY profiles_update_self ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR is_super_admin());
DROP POLICY IF EXISTS profiles_admin_all ON profiles;
CREATE POLICY profiles_admin_all ON profiles FOR ALL TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

-- product_categories: all authenticated read; SUPER_ADMIN/ADMIN/SCM write
DROP POLICY IF EXISTS pc_read ON product_categories;
CREATE POLICY pc_read ON product_categories FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS pc_write ON product_categories;
CREATE POLICY pc_write ON product_categories FOR ALL TO authenticated
  USING (has_role('SUPER_ADMIN','ADMIN','SCM'))
  WITH CHECK (has_role('SUPER_ADMIN','ADMIN','SCM'));

-- products: suppliers see only own products; everyone else reads all
DROP POLICY IF EXISTS products_read ON products;
CREATE POLICY products_read ON products FOR SELECT TO authenticated
  USING (
    has_role('SUPER_ADMIN','SCM','GENERAL','FINANCE','ADMIN','LOGISTICS','WAREHOUSE')
    OR (current_user_role() = 'SUPPLIER' AND supplier_id = auth.uid())
  );
DROP POLICY IF EXISTS products_write ON products;
CREATE POLICY products_write ON products FOR ALL TO authenticated
  USING (has_role('SUPER_ADMIN','ADMIN','SCM'))
  WITH CHECK (has_role('SUPER_ADMIN','ADMIN','SCM'));

-- sku_mappings: same as products
DROP POLICY IF EXISTS skum_read ON sku_mappings;
CREATE POLICY skum_read ON sku_mappings FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS skum_write ON sku_mappings;
CREATE POLICY skum_write ON sku_mappings FOR ALL TO authenticated
  USING (has_role('SUPER_ADMIN','ADMIN','SCM'))
  WITH CHECK (has_role('SUPER_ADMIN','ADMIN','SCM'));

-- monthly_sales: SCM writes, all internal read, supplier none
DROP POLICY IF EXISTS sales_read ON monthly_sales;
CREATE POLICY sales_read ON monthly_sales FOR SELECT TO authenticated
  USING (has_role('SUPER_ADMIN','SCM','GENERAL','FINANCE','ADMIN'));
DROP POLICY IF EXISTS sales_write ON monthly_sales;
CREATE POLICY sales_write ON monthly_sales FOR ALL TO authenticated
  USING (has_role('SUPER_ADMIN','SCM'))
  WITH CHECK (has_role('SUPER_ADMIN','SCM'));

-- stock_snapshots: all internal read; SCM/ADMIN/SUPER write (and Shopee API via service role)
DROP POLICY IF EXISTS stock_read ON stock_snapshots;
CREATE POLICY stock_read ON stock_snapshots FOR SELECT TO authenticated
  USING (has_role('SUPER_ADMIN','SCM','GENERAL','FINANCE','ADMIN','LOGISTICS','WAREHOUSE'));
DROP POLICY IF EXISTS stock_write ON stock_snapshots;
CREATE POLICY stock_write ON stock_snapshots FOR ALL TO authenticated
  USING (has_role('SUPER_ADMIN','SCM','ADMIN'))
  WITH CHECK (has_role('SUPER_ADMIN','SCM','ADMIN'));

-- purchase_orders: scoped reads by role; multi-actor writes (each role updates specific fields via app logic)
DROP POLICY IF EXISTS po_read ON purchase_orders;
CREATE POLICY po_read ON purchase_orders FOR SELECT TO authenticated
  USING (
    has_role('SUPER_ADMIN','SCM','FINANCE','ADMIN','LOGISTICS','WAREHOUSE')
    OR (current_user_role() = 'SUPPLIER' AND supplier_id = auth.uid())
    OR (current_user_role() = 'GENERAL'
        AND status IN ('ISSUED','ACCEPTED','READY','IN_TRANSIT','CLEARING','DELIVERED'))
  );
DROP POLICY IF EXISTS po_write ON purchase_orders;
CREATE POLICY po_write ON purchase_orders FOR ALL TO authenticated
  USING (
    has_role('SUPER_ADMIN','SCM','ADMIN','LOGISTICS')
    OR (current_user_role() = 'SUPPLIER' AND supplier_id = auth.uid())
  )
  WITH CHECK (
    has_role('SUPER_ADMIN','SCM','ADMIN','LOGISTICS')
    OR (current_user_role() = 'SUPPLIER' AND supplier_id = auth.uid())
  );

-- po_line_items: inherit access from parent PO
DROP POLICY IF EXISTS poli_read ON po_line_items;
CREATE POLICY poli_read ON po_line_items FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = po_line_items.po_id
            AND (has_role('SUPER_ADMIN','SCM','FINANCE','ADMIN','LOGISTICS','WAREHOUSE','GENERAL')
                 OR (current_user_role() = 'SUPPLIER' AND po.supplier_id = auth.uid())))
  );
DROP POLICY IF EXISTS poli_write ON po_line_items;
CREATE POLICY poli_write ON po_line_items FOR ALL TO authenticated
  USING (has_role('SUPER_ADMIN','SCM','ADMIN'))
  WITH CHECK (has_role('SUPER_ADMIN','SCM','ADMIN'));

-- shipments: same scope as PO; logistics writes, supplier reads own
DROP POLICY IF EXISTS ship_read ON shipments;
CREATE POLICY ship_read ON shipments FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = shipments.po_id
            AND (has_role('SUPER_ADMIN','SCM','FINANCE','ADMIN','LOGISTICS','WAREHOUSE','GENERAL')
                 OR (current_user_role() = 'SUPPLIER' AND po.supplier_id = auth.uid())))
  );
DROP POLICY IF EXISTS ship_write ON shipments;
CREATE POLICY ship_write ON shipments FOR ALL TO authenticated
  USING (has_role('SUPER_ADMIN','SCM','LOGISTICS'))
  WITH CHECK (has_role('SUPER_ADMIN','SCM','LOGISTICS'));

-- po_documents: scoped reads; each role uploads relevant doc types (enforced in app code, not RLS)
DROP POLICY IF EXISTS pod_read ON po_documents;
CREATE POLICY pod_read ON po_documents FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = po_documents.po_id
            AND (has_role('SUPER_ADMIN','SCM','FINANCE','ADMIN','LOGISTICS','WAREHOUSE')
                 OR (current_user_role() = 'SUPPLIER' AND po.supplier_id = auth.uid())))
  );
DROP POLICY IF EXISTS pod_write ON po_documents;
CREATE POLICY pod_write ON po_documents FOR ALL TO authenticated
  USING (
    has_role('SUPER_ADMIN','SCM','ADMIN','LOGISTICS')
    OR (current_user_role() = 'SUPPLIER'
        AND EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = po_documents.po_id AND po.supplier_id = auth.uid()))
  )
  WITH CHECK (
    has_role('SUPER_ADMIN','SCM','ADMIN','LOGISTICS')
    OR (current_user_role() = 'SUPPLIER'
        AND EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = po_documents.po_id AND po.supplier_id = auth.uid()))
  );

-- payments: SCM/Finance/Admin/SuperAdmin all read; Finance writes; Supplier/Logistics see own
DROP POLICY IF EXISTS pay_read ON payments;
CREATE POLICY pay_read ON payments FOR SELECT TO authenticated
  USING (
    has_role('SUPER_ADMIN','SCM','FINANCE','ADMIN')
    OR (current_user_role() = 'LOGISTICS' AND payment_type = 'LOGISTICS')
    OR (current_user_role() = 'SUPPLIER'
        AND payment_type = 'SUPPLIER'
        AND EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = payments.po_id AND po.supplier_id = auth.uid()))
  );
DROP POLICY IF EXISTS pay_write ON payments;
CREATE POLICY pay_write ON payments FOR ALL TO authenticated
  USING (has_role('SUPER_ADMIN','FINANCE'))
  WITH CHECK (has_role('SUPER_ADMIN','FINANCE'));

-- shipment_receipts: warehouse writes; SCM/supplier read (supplier own)
DROP POLICY IF EXISTS sr_read ON shipment_receipts;
CREATE POLICY sr_read ON shipment_receipts FOR SELECT TO authenticated
  USING (
    has_role('SUPER_ADMIN','SCM','ADMIN','WAREHOUSE','LOGISTICS','GENERAL','FINANCE')
    OR (current_user_role() = 'SUPPLIER'
        AND EXISTS (
          SELECT 1 FROM shipments s
          JOIN purchase_orders po ON po.id = s.po_id
          WHERE s.id = shipment_receipts.shipment_id AND po.supplier_id = auth.uid()))
  );
DROP POLICY IF EXISTS sr_write ON shipment_receipts;
CREATE POLICY sr_write ON shipment_receipts FOR ALL TO authenticated
  USING (has_role('SUPER_ADMIN','SCM','WAREHOUSE'))
  WITH CHECK (has_role('SUPER_ADMIN','SCM','WAREHOUSE'));

-- receipt_photos: same scope as receipts
DROP POLICY IF EXISTS rp_read ON receipt_photos;
CREATE POLICY rp_read ON receipt_photos FOR SELECT TO authenticated
  USING (
    has_role('SUPER_ADMIN','SCM','ADMIN','WAREHOUSE','LOGISTICS','GENERAL','FINANCE')
    OR (current_user_role() = 'SUPPLIER'
        AND EXISTS (
          SELECT 1 FROM shipment_receipts sr
          JOIN shipments s ON s.id = sr.shipment_id
          JOIN purchase_orders po ON po.id = s.po_id
          WHERE sr.id = receipt_photos.receipt_id AND po.supplier_id = auth.uid()))
  );
DROP POLICY IF EXISTS rp_write ON receipt_photos;
CREATE POLICY rp_write ON receipt_photos FOR ALL TO authenticated
  USING (has_role('SUPER_ADMIN','SCM','WAREHOUSE'))
  WITH CHECK (has_role('SUPER_ADMIN','SCM','WAREHOUSE'));

-- audit_log: only SUPER_ADMIN/SCM read; system writes via service role
DROP POLICY IF EXISTS audit_read ON audit_log;
CREATE POLICY audit_read ON audit_log FOR SELECT TO authenticated
  USING (has_role('SUPER_ADMIN','SCM'));

-- notifications: each user reads/updates own
DROP POLICY IF EXISTS notif_read ON notifications;
CREATE POLICY notif_read ON notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_super_admin());
DROP POLICY IF EXISTS notif_update ON notifications;
CREATE POLICY notif_update ON notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR is_super_admin());

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('po-pdfs',        'po-pdfs',        FALSE),
  ('invoices',       'invoices',       FALSE),
  ('shipping-docs',  'shipping-docs',  FALSE),
  ('payment-slips',  'payment-slips',  FALSE),
  ('receipt-photos', 'receipt-photos', FALSE)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: any authenticated user can read/write; app enforces which paths.
-- Tighter per-supplier scoping for storage is enforced via app-issued signed URLs.
DROP POLICY IF EXISTS storage_read ON storage.objects;
CREATE POLICY storage_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('po-pdfs','invoices','shipping-docs','payment-slips','receipt-photos'));

DROP POLICY IF EXISTS storage_write ON storage.objects;
CREATE POLICY storage_write ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('po-pdfs','invoices','shipping-docs','payment-slips','receipt-photos'));

DROP POLICY IF EXISTS storage_update ON storage.objects;
CREATE POLICY storage_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id IN ('po-pdfs','invoices','shipping-docs','payment-slips','receipt-photos'));

DROP POLICY IF EXISTS storage_delete ON storage.objects;
CREATE POLICY storage_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('po-pdfs','invoices','shipping-docs','payment-slips','receipt-photos') AND is_super_admin());

-- ============================================================
-- DONE
-- ============================================================
-- After running this, verify with: SELECT tablename FROM pg_tables WHERE schemaname='public';
-- Should list 15 tables.
