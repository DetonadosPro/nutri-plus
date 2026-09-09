ALTER TABLE foods DROP CONSTRAINT IF EXISTS foods_source_check;
ALTER TABLE foods ADD CONSTRAINT foods_source_check CHECK (source IN ('TACO', 'TBCA'));

ALTER TABLE nutrition_import_runs DROP CONSTRAINT IF EXISTS nutrition_import_runs_source_check;
ALTER TABLE nutrition_import_runs ADD CONSTRAINT nutrition_import_runs_source_check CHECK (source IN ('TACO', 'TBCA'));
