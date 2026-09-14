ALTER TABLE meal_plan_meals ADD COLUMN meal_type TEXT;

UPDATE meal_plan_meals
SET meal_type = CASE lower(trim(name))
  WHEN 'café da manhã' THEN 'breakfast'
  WHEN 'cafe da manhã' THEN 'breakfast'
  WHEN 'cafe da manha' THEN 'breakfast'
  WHEN 'lanche da manhã' THEN 'morning_snack'
  WHEN 'lanche da manha' THEN 'morning_snack'
  WHEN 'almoço' THEN 'lunch'
  WHEN 'almoco' THEN 'lunch'
  WHEN 'lanche da tarde' THEN 'afternoon_snack'
  WHEN 'jantar' THEN 'dinner'
  WHEN 'ceia' THEN 'supper'
  WHEN 'outra refeição' THEN 'other'
  WHEN 'outra refeicao' THEN 'other'
  ELSE 'other'
END;

ALTER TABLE meal_plan_meals
  ALTER COLUMN meal_type SET NOT NULL,
  ADD CONSTRAINT meal_plan_meals_meal_type_check CHECK (
    meal_type IN (
      'breakfast',
      'morning_snack',
      'lunch',
      'afternoon_snack',
      'dinner',
      'supper',
      'other'
    )
  ),
  ADD CONSTRAINT meal_plan_meals_plan_type_key
    UNIQUE (meal_plan_id, meal_type) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE meal_plan_meals
  DROP COLUMN meal_time,
  DROP COLUMN name;
