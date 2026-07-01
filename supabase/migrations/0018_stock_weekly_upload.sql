-- Phase 2 (STK): distinguish file-uploaded weekly stock from manual key-in.
ALTER TYPE stock_source ADD VALUE IF NOT EXISTS 'WEEKLY_UPLOAD';
