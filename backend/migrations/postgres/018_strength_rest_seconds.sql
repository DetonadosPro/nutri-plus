ALTER TABLE activity_sessions
  ADD COLUMN rest_seconds INTEGER CHECK (rest_seconds BETWEEN 1 AND 1200);

