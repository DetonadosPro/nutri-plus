ALTER TABLE food_vision_predictions
  ADD COLUMN detected_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN suggested_family TEXT CHECK(suggested_family IN ('chicken','pork','beef')),
  ADD COLUMN chosen_family TEXT CHECK(chosen_family IN ('chicken','pork','beef')),
  ADD COLUMN candidate_food_ids BIGINT[] NOT NULL DEFAULT '{}',
  ADD COLUMN manual_search BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_food_vision_feedback_family_cut
  ON food_vision_predictions(chosen_family,(detected_payload->'meatVisual'->>'cutStyle'))
  WHERE final_food_id IS NOT NULL;
