-- A confirmed diary must be reviewed again after its food records change.
CREATE FUNCTION invalidate_energy_food_status() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_meal bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    target_meal := OLD.meal_id;
    UPDATE energy_food_status s SET complete=FALSE, updated_at=CURRENT_TIMESTAMP
      FROM meals m JOIN daily_logs dl ON dl.id=m.daily_log_id
      WHERE m.id=target_meal AND s.patient_id=dl.patient_id AND s.day=dl.log_date;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    target_meal := NEW.meal_id;
    UPDATE energy_food_status s SET complete=FALSE, updated_at=CURRENT_TIMESTAMP
      FROM meals m JOIN daily_logs dl ON dl.id=m.daily_log_id
      WHERE m.id=target_meal AND s.patient_id=dl.patient_id AND s.day=dl.log_date;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER activity_food_changed AFTER INSERT OR UPDATE OR DELETE ON meal_entries
  FOR EACH ROW EXECUTE FUNCTION invalidate_energy_food_status();
