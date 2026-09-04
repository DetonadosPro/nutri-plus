ALTER TABLE nutrition_goals
ADD COLUMN IF NOT EXISTS carbohydrate_percent DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS protein_percent DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS fat_percent DOUBLE PRECISION;

UPDATE nutrition_goals AS goals
SET carbohydrate_percent = CASE
      WHEN patients.diet_type = 'carnivore' THEN 10
      ELSE 50
    END,
    protein_percent = 20,
    fat_percent = CASE
      WHEN patients.diet_type = 'carnivore' THEN 70
      ELSE 30
    END
FROM patients
WHERE patients.id = goals.patient_id
  AND (
    goals.carbohydrate_percent IS NULL
    OR goals.protein_percent IS NULL
    OR goals.fat_percent IS NULL
  );

ALTER TABLE nutrition_goals
ALTER COLUMN carbohydrate_percent SET DEFAULT 50,
ALTER COLUMN protein_percent SET DEFAULT 20,
ALTER COLUMN fat_percent SET DEFAULT 30;

ALTER TABLE nutrition_goals
ADD CONSTRAINT nutrition_goals_carbohydrate_percent_range
  CHECK (carbohydrate_percent BETWEEN 0 AND 100),
ADD CONSTRAINT nutrition_goals_protein_percent_range
  CHECK (protein_percent BETWEEN 0 AND 100),
ADD CONSTRAINT nutrition_goals_fat_percent_range
  CHECK (fat_percent BETWEEN 0 AND 100),
ADD CONSTRAINT nutrition_goals_macro_percent_total
  CHECK (
    carbohydrate_percent IS NULL
    OR protein_percent IS NULL
    OR fat_percent IS NULL
    OR ABS(carbohydrate_percent + protein_percent + fat_percent - 100) < 0.001
  );
