UPDATE foods
SET active = false, updated_at = CURRENT_TIMESTAMP
WHERE source = 'TBCA' AND source_code = 'BRC0056G';
