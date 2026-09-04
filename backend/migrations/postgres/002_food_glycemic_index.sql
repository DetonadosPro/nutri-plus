ALTER TABLE foods
  ADD COLUMN IF NOT EXISTS glycemic_index SMALLINT
  CHECK (glycemic_index BETWEEN 0 AND 200 OR glycemic_index IS NULL);

