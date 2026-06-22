-- ============================================================
-- Migration 0011 — Role cleanup: add ACCOUNTS enum value, remap
--   deprecated-role rows to ADMIN, drop column default, update
--   handle_new_user trigger, rewrite is_super_admin() helper, and
--   rebuild every RLS policy that referenced a deprecated role or
--   is_super_admin() across all migrations (0001, 0002, 0003, 0005,
--   0007, 0008).
--
-- APPEND-ONLY: do NOT edit past migrations (0001–0010).
--
-- IMPORTANT: ALTER TYPE … ADD VALUE cannot run inside a transaction
-- block. This file deliberately has NO surrounding BEGIN/COMMIT. The
-- Supabase migration runner applies each statement individually, which
-- is the correct behaviour. Do not add BEGIN/COMMIT around Step 1.
-- ============================================================

-- ============================================================
-- Step 1: Add ACCOUNTS to the user_role enum (bare — no transaction)
-- ============================================================
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'ACCOUNTS';

-- ============================================================
-- Step 2: Remap every deprecated-role profile row to ADMIN (D-02)
-- ============================================================
-- After this UPDATE, no row in public.profiles carries a deprecated role.
UPDATE public.profiles
  SET role = 'ADMIN'
  WHERE role IN ('SUPER_ADMIN', 'GENERAL', 'LOGISTICS', 'WAREHOUSE', 'SUPPLIER');

-- ============================================================
-- Step 3: Drop the GENERAL column default (D-03)
-- New users must receive an explicit role at invite time. The
-- handle_new_user trigger (Step 4) enforces this — it will throw
-- if raw_user_meta_data does not carry a valid role value.
-- ============================================================
ALTER TABLE public.profiles
  ALTER COLUMN role DROP DEFAULT;

-- ============================================================
-- Step 4: Rewrite handle_new_user trigger — remove GENERAL fallback (D-03)
-- ============================================================
-- COALESCE on role is removed. If the invite metadata does not supply
-- a role, the cast will raise an error and block the insert — which is
-- correct: every invite must supply a role via inviteUserByEmail({ data: { role } }).
-- The COALESCE on name is preserved so invites without a display name
-- fall back to the email address.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    (NEW.raw_user_meta_data->>'role')::user_role
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Step 5: Rewrite is_super_admin() to delegate to has_role('ADMIN') (D-07)
-- ============================================================
-- Existing policies that still call is_super_admin() will now grant
-- access to ADMIN-role users (as intended). No rows will ever match
-- 'SUPER_ADMIN' after Step 2, so leaving the function intact without
-- this rewrite would silently deny all admin access.
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT has_role('ADMIN');
$$ LANGUAGE SQL STABLE;

-- ============================================================
-- Step 6: Rebuild RLS policies — full blast-radius coverage
-- ============================================================
-- Each policy is DROPped then re-CREATEd so the definition is clean.
-- Dead roles removed: SUPER_ADMIN, GENERAL, LOGISTICS, WAREHOUSE, SUPPLIER.
-- Dead branches removed: SUPPLIER-scoped sub-selects (no SUPPLIER rows remain).
-- ACCOUNTS added where Phase-4 PO/document access needs it (per Open Question #3).
--
-- Tables from 0001: profiles, product_categories, products, sku_mappings,
--   monthly_sales, stock_snapshots, purchase_orders, po_line_items, shipments,
--   po_documents, payments, shipment_receipts, receipt_photos, audit_log,
--   notifications, storage.objects.
-- Tables from 0002: product_suppliers, unknown_skus.
-- Tables from 0003: incoming_stock, sales_uploads (stock_snapshots policy also reset).
-- Tables from 0005: fx_rates.
-- Tables from 0007: product_groups.
-- Tables from 0008: purchase_orders (po_write), po_documents (pod_write).

-- ----------------------------------------------------------
-- profiles (from 0001)
-- ----------------------------------------------------------

-- profiles_select: SUPER_ADMIN removed; read access is self OR SCM/ADMIN.
DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR has_role('SCM', 'ADMIN'));

-- profiles_update_self: is_super_admin() replaced with explicit has_role('ADMIN').
-- (The is_super_admin() rewrite in Step 5 would also fix this, but we recreate
-- it explicitly for clarity and to remove the indirect dependency.)
DROP POLICY IF EXISTS profiles_update_self ON profiles;
CREATE POLICY profiles_update_self ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR has_role('ADMIN'));

-- profiles_admin_all: is_super_admin() → has_role('ADMIN').
DROP POLICY IF EXISTS profiles_admin_all ON profiles;
CREATE POLICY profiles_admin_all ON profiles FOR ALL TO authenticated
  USING (has_role('ADMIN'))
  WITH CHECK (has_role('ADMIN'));

-- ----------------------------------------------------------
-- product_categories (from 0001)
-- ----------------------------------------------------------

-- pc_write: SUPER_ADMIN removed.
DROP POLICY IF EXISTS pc_write ON product_categories;
CREATE POLICY pc_write ON product_categories FOR ALL TO authenticated
  USING (has_role('ADMIN', 'SCM'))
  WITH CHECK (has_role('ADMIN', 'SCM'));

-- ----------------------------------------------------------
-- products (from 0001)
-- ----------------------------------------------------------

-- products_read: SUPER_ADMIN/GENERAL/LOGISTICS/WAREHOUSE/SUPPLIER branches removed.
-- ACCOUNTS added — accounts staff need to see products when working on POs.
DROP POLICY IF EXISTS products_read ON products;
CREATE POLICY products_read ON products FOR SELECT TO authenticated
  USING (has_role('SCM', 'ACCOUNTS', 'FINANCE', 'ADMIN'));

-- products_write: SUPER_ADMIN removed.
DROP POLICY IF EXISTS products_write ON products;
CREATE POLICY products_write ON products FOR ALL TO authenticated
  USING (has_role('ADMIN', 'SCM'))
  WITH CHECK (has_role('ADMIN', 'SCM'));

-- ----------------------------------------------------------
-- sku_mappings (from 0001)
-- ----------------------------------------------------------

-- skum_write: SUPER_ADMIN removed.
DROP POLICY IF EXISTS skum_write ON sku_mappings;
CREATE POLICY skum_write ON sku_mappings FOR ALL TO authenticated
  USING (has_role('ADMIN', 'SCM'))
  WITH CHECK (has_role('ADMIN', 'SCM'));

-- ----------------------------------------------------------
-- monthly_sales (from 0001; further updated in 0003)
-- ----------------------------------------------------------

-- sales_read: SUPER_ADMIN/GENERAL removed. (0003 already set this to TRUE;
-- reset here to the role-gated version to match the four-role model.)
DROP POLICY IF EXISTS sales_read ON monthly_sales;
CREATE POLICY sales_read ON monthly_sales FOR SELECT TO authenticated
  USING (has_role('SCM', 'ACCOUNTS', 'FINANCE', 'ADMIN'));

-- sales_write: SUPER_ADMIN removed.
DROP POLICY IF EXISTS sales_write ON monthly_sales;
CREATE POLICY sales_write ON monthly_sales FOR ALL TO authenticated
  USING (has_role('SCM'))
  WITH CHECK (has_role('SCM'));

-- ----------------------------------------------------------
-- stock_snapshots (from 0001; overridden in 0003)
-- ----------------------------------------------------------

-- stock_read: SUPER_ADMIN/GENERAL/LOGISTICS/WAREHOUSE removed. (0003 opened to TRUE;
-- reset here to role-gated access for the four-role model.)
DROP POLICY IF EXISTS stock_read ON stock_snapshots;
CREATE POLICY stock_read ON stock_snapshots FOR SELECT TO authenticated
  USING (has_role('SCM', 'ACCOUNTS', 'FINANCE', 'ADMIN'));

-- stock_write: SUPER_ADMIN removed.
DROP POLICY IF EXISTS stock_write ON stock_snapshots;
CREATE POLICY stock_write ON stock_snapshots FOR ALL TO authenticated
  USING (has_role('SCM', 'ADMIN'))
  WITH CHECK (has_role('SCM', 'ADMIN'));

-- ----------------------------------------------------------
-- purchase_orders (from 0001, overridden in 0008)
-- ----------------------------------------------------------

-- po_read: SUPER_ADMIN/LOGISTICS/WAREHOUSE/SUPPLIER/GENERAL branches removed.
-- ACCOUNTS added per Open Question #3 (ACCOUNTS needs to read POs in Phase 4).
DROP POLICY IF EXISTS po_read ON purchase_orders;
CREATE POLICY po_read ON purchase_orders FOR SELECT TO authenticated
  USING (has_role('SCM', 'ACCOUNTS', 'FINANCE', 'ADMIN'));

-- po_write: SUPER_ADMIN/LOGISTICS/SUPPLIER branches removed.
-- Base is the 0008 policy (FINANCE added). LOGISTICS and SUPPLIER branches dropped.
-- ACCOUNTS added per Open Question #3 (ACCOUNTS signs/numbers POs in Phase 4).
DROP POLICY IF EXISTS po_write ON purchase_orders;
CREATE POLICY po_write ON purchase_orders FOR ALL TO authenticated
  USING (has_role('SCM', 'ACCOUNTS', 'ADMIN', 'FINANCE'))
  WITH CHECK (has_role('SCM', 'ACCOUNTS', 'ADMIN', 'FINANCE'));

-- ----------------------------------------------------------
-- po_line_items (from 0001)
-- ----------------------------------------------------------

-- poli_read: SUPER_ADMIN/LOGISTICS/WAREHOUSE/GENERAL/SUPPLIER branches removed.
DROP POLICY IF EXISTS poli_read ON po_line_items;
CREATE POLICY poli_read ON po_line_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM purchase_orders po
      WHERE po.id = po_line_items.po_id
        AND has_role('SCM', 'ACCOUNTS', 'FINANCE', 'ADMIN')
    )
  );

-- poli_write: SUPER_ADMIN removed.
DROP POLICY IF EXISTS poli_write ON po_line_items;
CREATE POLICY poli_write ON po_line_items FOR ALL TO authenticated
  USING (has_role('SCM', 'ADMIN'))
  WITH CHECK (has_role('SCM', 'ADMIN'));

-- ----------------------------------------------------------
-- shipments (from 0001)
-- ----------------------------------------------------------

-- ship_read: SUPER_ADMIN/LOGISTICS/WAREHOUSE/GENERAL/SUPPLIER branches removed.
DROP POLICY IF EXISTS ship_read ON shipments;
CREATE POLICY ship_read ON shipments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM purchase_orders po
      WHERE po.id = shipments.po_id
        AND has_role('SCM', 'ACCOUNTS', 'FINANCE', 'ADMIN')
    )
  );

-- ship_write: SUPER_ADMIN/LOGISTICS removed. SCM+ADMIN manage shipments.
DROP POLICY IF EXISTS ship_write ON shipments;
CREATE POLICY ship_write ON shipments FOR ALL TO authenticated
  USING (has_role('SCM', 'ADMIN'))
  WITH CHECK (has_role('SCM', 'ADMIN'));

-- ----------------------------------------------------------
-- po_documents (from 0001, overridden in 0008)
-- ----------------------------------------------------------

-- pod_read: SUPER_ADMIN/LOGISTICS/WAREHOUSE/SUPPLIER branches removed.
-- ACCOUNTS added — accounts staff read PO PDFs in Phase 4.
DROP POLICY IF EXISTS pod_read ON po_documents;
CREATE POLICY pod_read ON po_documents FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM purchase_orders po
      WHERE po.id = po_documents.po_id
        AND has_role('SCM', 'ACCOUNTS', 'FINANCE', 'ADMIN')
    )
  );

-- pod_write: SUPER_ADMIN/LOGISTICS/SUPPLIER branches removed.
-- Base is the 0008 policy (FINANCE already present). ACCOUNTS added per
-- Open Question #3 (ACCOUNTS uploads signed PO PDF + bank slip in Phase 4).
DROP POLICY IF EXISTS pod_write ON po_documents;
CREATE POLICY pod_write ON po_documents FOR ALL TO authenticated
  USING (has_role('SCM', 'ACCOUNTS', 'ADMIN', 'FINANCE'))
  WITH CHECK (has_role('SCM', 'ACCOUNTS', 'ADMIN', 'FINANCE'));

-- ----------------------------------------------------------
-- payments (from 0001)
-- ----------------------------------------------------------

-- pay_read: SUPER_ADMIN/LOGISTICS/SUPPLIER branches removed.
DROP POLICY IF EXISTS pay_read ON payments;
CREATE POLICY pay_read ON payments FOR SELECT TO authenticated
  USING (has_role('SCM', 'ACCOUNTS', 'FINANCE', 'ADMIN'));

-- pay_write: SUPER_ADMIN removed. Finance is the sole write actor.
DROP POLICY IF EXISTS pay_write ON payments;
CREATE POLICY pay_write ON payments FOR ALL TO authenticated
  USING (has_role('FINANCE'))
  WITH CHECK (has_role('FINANCE'));

-- ----------------------------------------------------------
-- shipment_receipts (from 0001)
-- ----------------------------------------------------------

-- sr_read: SUPER_ADMIN/WAREHOUSE/LOGISTICS/GENERAL/SUPPLIER branches removed.
DROP POLICY IF EXISTS sr_read ON shipment_receipts;
CREATE POLICY sr_read ON shipment_receipts FOR SELECT TO authenticated
  USING (has_role('SCM', 'ADMIN', 'FINANCE'));

-- sr_write: SUPER_ADMIN/WAREHOUSE removed. SCM+ADMIN record receipts.
DROP POLICY IF EXISTS sr_write ON shipment_receipts;
CREATE POLICY sr_write ON shipment_receipts FOR ALL TO authenticated
  USING (has_role('SCM', 'ADMIN'))
  WITH CHECK (has_role('SCM', 'ADMIN'));

-- ----------------------------------------------------------
-- receipt_photos (from 0001)
-- ----------------------------------------------------------

-- rp_read: SUPER_ADMIN/WAREHOUSE/LOGISTICS/GENERAL/SUPPLIER branches removed.
DROP POLICY IF EXISTS rp_read ON receipt_photos;
CREATE POLICY rp_read ON receipt_photos FOR SELECT TO authenticated
  USING (has_role('SCM', 'ADMIN', 'FINANCE'));

-- rp_write: SUPER_ADMIN/WAREHOUSE removed.
DROP POLICY IF EXISTS rp_write ON receipt_photos;
CREATE POLICY rp_write ON receipt_photos FOR ALL TO authenticated
  USING (has_role('SCM', 'ADMIN'))
  WITH CHECK (has_role('SCM', 'ADMIN'));

-- ----------------------------------------------------------
-- audit_log (from 0001)
-- ----------------------------------------------------------

-- audit_read: SUPER_ADMIN/SCM → ADMIN only (audit trail is an admin tool).
DROP POLICY IF EXISTS audit_read ON audit_log;
CREATE POLICY audit_read ON audit_log FOR SELECT TO authenticated
  USING (has_role('ADMIN'));

-- ----------------------------------------------------------
-- notifications (from 0001)
-- ----------------------------------------------------------

-- notif_read: is_super_admin() → has_role('ADMIN').
DROP POLICY IF EXISTS notif_read ON notifications;
CREATE POLICY notif_read ON notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR has_role('ADMIN'));

-- notif_update: is_super_admin() → has_role('ADMIN').
DROP POLICY IF EXISTS notif_update ON notifications;
CREATE POLICY notif_update ON notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR has_role('ADMIN'));

-- ----------------------------------------------------------
-- storage.objects (from 0001)
-- ----------------------------------------------------------

-- storage_delete: is_super_admin() → has_role('ADMIN').
DROP POLICY IF EXISTS storage_delete ON storage.objects;
CREATE POLICY storage_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id IN ('po-pdfs', 'invoices', 'shipping-docs', 'payment-slips', 'receipt-photos')
    AND has_role('ADMIN')
  );

-- ----------------------------------------------------------
-- product_suppliers (from 0002)
-- ----------------------------------------------------------

-- ps_read: SUPER_ADMIN/GENERAL/LOGISTICS/WAREHOUSE/SUPPLIER branches removed.
-- ACCOUNTS added — accounts staff need product-supplier cost visibility for PO work.
DROP POLICY IF EXISTS ps_read ON product_suppliers;
CREATE POLICY ps_read ON product_suppliers FOR SELECT TO authenticated
  USING (has_role('SCM', 'ACCOUNTS', 'FINANCE', 'ADMIN'));

-- ps_write: SUPER_ADMIN removed.
DROP POLICY IF EXISTS ps_write ON product_suppliers;
CREATE POLICY ps_write ON product_suppliers FOR ALL TO authenticated
  USING (has_role('SCM', 'ADMIN'))
  WITH CHECK (has_role('SCM', 'ADMIN'));

-- ----------------------------------------------------------
-- unknown_skus (from 0002)
-- ----------------------------------------------------------

-- us_read: SUPER_ADMIN removed.
DROP POLICY IF EXISTS us_read ON unknown_skus;
CREATE POLICY us_read ON unknown_skus FOR SELECT TO authenticated
  USING (has_role('SCM', 'ADMIN'));

-- us_write: SUPER_ADMIN removed.
DROP POLICY IF EXISTS us_write ON unknown_skus;
CREATE POLICY us_write ON unknown_skus FOR ALL TO authenticated
  USING (has_role('SCM', 'ADMIN'))
  WITH CHECK (has_role('SCM', 'ADMIN'));

-- ----------------------------------------------------------
-- incoming_stock (from 0003)
-- ----------------------------------------------------------

-- inc_write: SUPER_ADMIN/LOGISTICS removed.
DROP POLICY IF EXISTS inc_write ON incoming_stock;
CREATE POLICY inc_write ON incoming_stock FOR ALL TO authenticated
  USING (has_role('SCM', 'ADMIN'))
  WITH CHECK (has_role('SCM', 'ADMIN'));

-- ----------------------------------------------------------
-- sales_uploads (from 0003)
-- ----------------------------------------------------------

-- su_write: SUPER_ADMIN removed.
DROP POLICY IF EXISTS su_write ON sales_uploads;
CREATE POLICY su_write ON sales_uploads FOR ALL TO authenticated
  USING (has_role('SCM', 'ADMIN'))
  WITH CHECK (has_role('SCM', 'ADMIN'));

-- ----------------------------------------------------------
-- fx_rates (from 0005)
-- ----------------------------------------------------------

-- fx_write: SUPER_ADMIN removed.
DROP POLICY IF EXISTS fx_write ON fx_rates;
CREATE POLICY fx_write ON fx_rates FOR ALL TO authenticated
  USING (has_role('SCM', 'ADMIN', 'FINANCE'))
  WITH CHECK (has_role('SCM', 'ADMIN', 'FINANCE'));

-- ----------------------------------------------------------
-- product_groups (from 0007)
-- ----------------------------------------------------------

-- pg_write: SUPER_ADMIN removed.
DROP POLICY IF EXISTS pg_write ON product_groups;
CREATE POLICY pg_write ON product_groups FOR ALL TO authenticated
  USING (has_role('SCM', 'ADMIN'))
  WITH CHECK (has_role('SCM', 'ADMIN'));

-- ============================================================
-- Done
-- ============================================================
-- Verify after applying:
--   SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
--     WHERE t.typname = 'user_role' AND e.enumlabel = 'ACCOUNTS';
--   -- should return 1 row
--
--   SELECT count(*) FROM public.profiles
--     WHERE role IN ('SUPER_ADMIN','GENERAL','LOGISTICS','WAREHOUSE','SUPPLIER');
--   -- should return 0
