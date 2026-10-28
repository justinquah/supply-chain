-- ============================================================
-- Migration 0051 — Draft/cancelled POs stop counting as incoming;
--                  atomic product-range rename
-- ============================================================
-- 1. Every reader of in-transit stock (dashboard, insights, KPI, the
--    product_dashboard views/functions) counts incoming_stock rows with
--    status = 'EXPECTED'. A PO moved back to DRAFT, or CANCELLED, kept its lines
--    EXPECTED, so its quantity still showed. These triggers park such lines as
--    'ON_HOLD' and restore them to 'EXPECTED' when the PO re-enters the workflow,
--    whichever code path changed the status. SECURITY DEFINER because the status
--    change can come from FINANCE/ACCOUNTS (e.g. creating a PO from a draft),
--    whose RLS can't write incoming_stock.
-- 2. rename_product_range(): renames a range across products, product_groups and
--    purchase_orders in one transaction.
-- ============================================================

CREATE OR REPLACE FUNCTION po_sync_incoming_hold() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('DRAFT', 'CANCELLED') AND OLD.status NOT IN ('DRAFT', 'CANCELLED') THEN
    UPDATE incoming_stock SET status = 'ON_HOLD'
     WHERE po_id = NEW.id AND status = 'EXPECTED';
  ELSIF OLD.status IN ('DRAFT', 'CANCELLED') AND NEW.status NOT IN ('DRAFT', 'CANCELLED') THEN
    UPDATE incoming_stock SET status = 'EXPECTED'
     WHERE po_id = NEW.id AND status = 'ON_HOLD';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_po_sync_incoming_hold ON purchase_orders;
CREATE TRIGGER trg_po_sync_incoming_hold
  AFTER UPDATE OF status ON purchase_orders
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION po_sync_incoming_hold();

-- Lines written (or flipped back to EXPECTED) while their PO is DRAFT/CANCELLED
-- are parked immediately — covers draft creation and any app path that resets
-- line statuses.
CREATE OR REPLACE FUNCTION incoming_hold_if_po_inactive() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'EXPECTED' AND NEW.po_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM purchase_orders po
        WHERE po.id = NEW.po_id AND po.status IN ('DRAFT', 'CANCELLED')
     ) THEN
    NEW.status := 'ON_HOLD';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_incoming_hold_if_po_inactive ON incoming_stock;
CREATE TRIGGER trg_incoming_hold_if_po_inactive
  BEFORE INSERT OR UPDATE OF status, po_id ON incoming_stock
  FOR EACH ROW EXECUTE FUNCTION incoming_hold_if_po_inactive();

-- Trigger functions aren't meant to be called directly.
REVOKE ALL ON FUNCTION po_sync_incoming_hold() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION incoming_hold_if_po_inactive() FROM PUBLIC, anon, authenticated;

-- Backfill: park lines of POs that are already DRAFT/CANCELLED.
UPDATE incoming_stock i SET status = 'ON_HOLD'
  FROM purchase_orders po
 WHERE po.id = i.po_id AND i.status = 'EXPECTED' AND po.status IN ('DRAFT', 'CANCELLED');

-- ------------------------------------------------------------
-- Range rename (SECURITY INVOKER — runs under the caller's RLS: products,
-- product_groups and purchase_orders writes are SCM/ADMIN).
-- Also rewrites products.name where it follows "<range> - <variation>".
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION rename_product_range(p_old TEXT, p_new TEXT) RETURNS INT
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_new TEXT := btrim(p_new);
  v_count INT;
BEGIN
  IF v_new IS NULL OR v_new = '' THEN
    RAISE EXCEPTION 'New range name is required';
  END IF;
  IF v_new = p_old THEN
    RETURN 0;
  END IF;
  IF EXISTS (SELECT 1 FROM products WHERE product_family = v_new)
     OR EXISTS (SELECT 1 FROM product_groups WHERE name = v_new) THEN
    RAISE EXCEPTION 'A range called "%" already exists', v_new;
  END IF;

  UPDATE products
     SET name = CASE
                  WHEN left(name, length(p_old) + 3) = p_old || ' - '
                    THEN v_new || substr(name, length(p_old) + 1)
                  WHEN name = p_old THEN v_new
                  ELSE name
                END,
         product_family = v_new
   WHERE product_family = p_old;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'No products found in range "%" (or no permission to edit them)', p_old;
  END IF;

  UPDATE product_groups SET name = v_new WHERE name = p_old;
  UPDATE purchase_orders SET product_group = v_new WHERE product_group = p_old;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION rename_product_range(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION rename_product_range(TEXT, TEXT) TO authenticated;
