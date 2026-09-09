ALTER TABLE food_vision_analyses
  ADD COLUMN ask_identity_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN ask_attribute_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN no_exact_match_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE food_vision_predictions
  DROP CONSTRAINT IF EXISTS food_vision_predictions_decision_state_check;

ALTER TABLE food_vision_predictions
  ADD CONSTRAINT food_vision_predictions_decision_state_check
  CHECK(decision_state IN (
    'AUTOSELECT','RERANK','ASK_USER','ASK_IDENTITY','ASK_ATTRIBUTE','NO_EXACT_TBCA_MATCH','NO_MATCH'
  ));

ALTER TABLE food_vision_predictions
  ADD COLUMN resolution_policy TEXT,
  ADD COLUMN abstention_reason TEXT;
