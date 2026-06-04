-- Migration: Persist computed system size (kW) on quotations
-- Date: 2026-05-30
-- Description: Admin Overview / dealers-by-revenue can read system_kw without joining products

ALTER TABLE quotations
ADD COLUMN IF NOT EXISTS system_kw NUMERIC(10, 2) NULL;

COMMENT ON COLUMN quotations.system_kw IS 'Installed system size in kW (from panel config); set on product save and approve';
