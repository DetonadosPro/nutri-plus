-- A quick entry records a duration, not an invented start time.
ALTER TABLE activity_sessions ALTER COLUMN local_time DROP NOT NULL;
ALTER TABLE activity_sessions ADD COLUMN rest_period TEXT
  CHECK (rest_period IN ('under30','30to60','1to2','2to3','over3'));
