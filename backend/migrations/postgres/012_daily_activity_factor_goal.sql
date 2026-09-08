ALTER TABLE nutrition_goals
ADD COLUMN daily_activity_factor DOUBLE PRECISION NOT NULL DEFAULT 1.2;

ALTER TABLE nutrition_goals
ADD CONSTRAINT nutrition_goals_daily_activity_factor_range
CHECK (daily_activity_factor >= 1 AND daily_activity_factor <= 2.5);
