ALTER TABLE foods ADD COLUMN curation_priority TEXT;
ALTER TABLE foods ADD COLUMN curation_priority_rank SMALLINT;
ALTER TABLE foods ADD COLUMN curation_score INTEGER;
ALTER TABLE foods ADD COLUMN curation_category TEXT;
ALTER TABLE foods ADD COLUMN curation_details TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE foods ADD COLUMN curation_flags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE foods ADD COLUMN curation_confidence TEXT;
ALTER TABLE foods ADD COLUMN taco_reference_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE foods ADD COLUMN duplicate_group TEXT;
ALTER TABLE foods ADD COLUMN curation_version TEXT;

ALTER TABLE foods ADD CONSTRAINT foods_curation_priority_check
CHECK (curation_priority IS NULL OR curation_priority IN ('common','useful','specific'));
ALTER TABLE foods ADD CONSTRAINT foods_curation_priority_rank_check
CHECK (curation_priority_rank IS NULL OR curation_priority_rank BETWEEN 0 AND 2);
ALTER TABLE foods ADD CONSTRAINT foods_curation_score_check
CHECK (curation_score IS NULL OR curation_score BETWEEN 0 AND 1000);
ALTER TABLE foods ADD CONSTRAINT foods_curation_confidence_check
CHECK (curation_confidence IS NULL OR curation_confidence IN ('high','medium','low'));

CREATE INDEX idx_foods_curation_ranking
ON foods(curation_priority_rank,curation_score DESC,source_code)
WHERE active AND source='TBCA';

CREATE INDEX idx_foods_curation_category
ON foods(curation_category)
WHERE active AND source='TBCA';
