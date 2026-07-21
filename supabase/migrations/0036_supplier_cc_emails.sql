-- ============================================================
-- Migration 0036 — Supplier CC recipients (2026-07-21)
-- ============================================================
-- peterlee3836@gmail.com is the agent/broker for Sanlin, Nutrix and Siam. He is
-- copied on correspondence rather than addressed, so the supplier stays the
-- recipient. Split him out of supplier_contact_emails (the To list) into a CC list.
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS supplier_cc_emails TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.profiles.supplier_cc_emails IS
  'CC recipients for supplier correspondence (e.g. the agent/broker). To recipients live in supplier_contact_emails.';

-- Move the broker from To -> CC wherever he currently appears.
UPDATE public.profiles
   SET supplier_cc_emails = ARRAY['peterlee3836@gmail.com'],
       supplier_contact_emails = array_remove(supplier_contact_emails, 'peterlee3836@gmail.com')
 WHERE role = 'SUPPLIER'
   AND 'peterlee3836@gmail.com' = ANY (supplier_contact_emails);
