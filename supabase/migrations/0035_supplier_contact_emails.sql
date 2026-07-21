-- ============================================================
-- Migration 0035 — Supplier contact emails (2026-07-21)
-- ============================================================
-- profiles.email is the supplier's SIGN-IN address (currently a placeholder such as
-- dalian@suppliers.placeholder) and must not be repurposed. Correspondence goes to
-- one or more real contact addresses per supplier, so this is a separate array
-- column used as the recipient list when SCM/Finance email a supplier about a PO.
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS supplier_contact_emails TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.profiles.supplier_contact_emails IS
  'Recipient list for supplier correspondence (PO issued, ETA change, payment slip). Separate from profiles.email, which is the login address.';

-- Seed the six live suppliers. Matched on exact name; ON CONFLICT is not applicable
-- (UPDATE by name), and each statement is a no-op if the supplier is absent.
UPDATE public.profiles SET supplier_contact_emails = ARRAY['guoge@zkky.group']
  WHERE role = 'SUPPLIER' AND name = 'SHANDONG FANBEI PET FOOD CO. LTD';

UPDATE public.profiles SET supplier_contact_emails = ARRAY['ma@nuodepet.com']
  WHERE role = 'SUPPLIER' AND name = 'XINTAI NUODE PET PRODUCTS CO. LTD';

UPDATE public.profiles SET supplier_contact_emails = ARRAY['becky@jzyuan.com.cn']
  WHERE role = 'SUPPLIER' AND name = 'DALIAN JIU ZHOU YUAN TRADING CO. LTD';

UPDATE public.profiles SET supplier_contact_emails = ARRAY['bentonite@foxmail.com','peterlee3836@gmail.com']
  WHERE role = 'SUPPLIER' AND name = 'SANLIN INDUSTRIAL GROUP (HK) LIMITED';

UPDATE public.profiles SET supplier_contact_emails = ARRAY['nichchima@nutrix.co.th','somkiat@nutrix.co.th','peterlee3836@gmail.com']
  WHERE role = 'SUPPLIER' AND name = 'NUTRIX PUBLIC LIMITED COMPANY';

UPDATE public.profiles SET supplier_contact_emails = ARRAY['sift_pisit@sift.co.th','peterlee3836@gmail.com']
  WHERE role = 'SUPPLIER' AND name = 'SIAM INTERNATIONAL';
