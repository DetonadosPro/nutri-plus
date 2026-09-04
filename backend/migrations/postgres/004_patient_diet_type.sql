ALTER TABLE patients
ADD COLUMN IF NOT EXISTS diet_type TEXT NOT NULL DEFAULT 'omnivore'
CHECK (diet_type IN ('omnivore', 'carnivore'));
