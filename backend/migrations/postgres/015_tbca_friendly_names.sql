ALTER TABLE foods ADD COLUMN display_name TEXT;
ALTER TABLE foods ADD COLUMN search_aliases TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE foods ADD COLUMN normalized_display_name TEXT;
ALTER TABLE foods ADD COLUMN normalized_search_aliases TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE foods ADD COLUMN normalized_search_text TEXT;

UPDATE foods
SET display_name = description,
    normalized_display_name = normalized_name,
    normalized_search_text = normalized_name
WHERE display_name IS NULL;

ALTER TABLE foods ADD CONSTRAINT foods_display_name_not_blank
CHECK (display_name IS NULL OR BTRIM(display_name) <> '');

CREATE INDEX idx_foods_display_name_trgm
ON foods USING GIN(normalized_display_name gin_trgm_ops) WHERE active;

CREATE INDEX idx_foods_search_text_trgm
ON foods USING GIN(normalized_search_text gin_trgm_ops) WHERE active;
