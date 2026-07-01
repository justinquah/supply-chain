-- Allow adding products without forcing a category (SCM product entry / bulk upload).
-- Category is used for optional grouping only; the dashboard groups by product_family.
ALTER TABLE public.products ALTER COLUMN category_id DROP NOT NULL;
