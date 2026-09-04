ALTER TABLE patient_notes
  ADD COLUMN IF NOT EXISTS patient_read_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_notes_patient_unread
  ON patient_notes(patient_id, created_at DESC)
  WHERE visibility = 'patient' AND patient_read_at IS NULL;
