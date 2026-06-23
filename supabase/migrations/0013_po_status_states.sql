-- ============================================================
-- Migration 0013 — Phase 4: add the brief's PO lifecycle states
-- ============================================================
-- The brief's PO workflow is: DRAFT → PO_APPROVED → INVOICE_RECEIVED → SHIPPED → RECEIVED.
-- The original enum (PROPOSED/APPROVED/ISSUED/ACCEPTED/READY/IN_TRANSIT/CLEARING/DELIVERED/
-- CANCELLED) is shipment-oriented. Postgres cannot DROP enum values, so we ADD the 5 brief
-- states additively; the app uses only these going forward. CANCELLED is retained as a valid
-- terminal state.
--
-- IMPORTANT: ALTER TYPE … ADD VALUE must be applied in its OWN transaction and the new value
-- cannot be USED (e.g. as a column default) until that transaction commits. This file ONLY
-- adds the values; migration 0014 (separate transaction) sets the DRAFT default and uses them.
-- ============================================================

ALTER TYPE po_status ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE po_status ADD VALUE IF NOT EXISTS 'PO_APPROVED';
ALTER TYPE po_status ADD VALUE IF NOT EXISTS 'INVOICE_RECEIVED';
ALTER TYPE po_status ADD VALUE IF NOT EXISTS 'SHIPPED';
ALTER TYPE po_status ADD VALUE IF NOT EXISTS 'RECEIVED';
