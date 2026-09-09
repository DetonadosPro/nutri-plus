CREATE TABLE food_vision_analyses (
  id BIGSERIAL PRIMARY KEY,
  analysis_token UUID NOT NULL UNIQUE,
  model TEXT NOT NULL,
  reasoning_effort TEXT NOT NULL,
  first_latency_ms INTEGER NOT NULL CHECK(first_latency_ms>=0),
  rerank_latency_ms INTEGER NOT NULL DEFAULT 0 CHECK(rerank_latency_ms>=0),
  input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER, total_tokens INTEGER,
  detected_count INTEGER NOT NULL,
  autoselect_count INTEGER NOT NULL DEFAULT 0,
  rerank_count INTEGER NOT NULL DEFAULT 0,
  ask_user_count INTEGER NOT NULL DEFAULT 0,
  no_match_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE food_vision_predictions (
  id BIGSERIAL PRIMARY KEY,
  analysis_id BIGINT NOT NULL REFERENCES food_vision_analyses(id) ON DELETE CASCADE,
  item_token UUID NOT NULL,
  decision_state TEXT NOT NULL CHECK(decision_state IN ('AUTOSELECT','RERANK','ASK_USER','NO_MATCH')),
  predicted_food_id BIGINT REFERENCES foods(id) ON DELETE SET NULL,
  final_food_id BIGINT REFERENCES foods(id) ON DELETE SET NULL,
  top1_score DOUBLE PRECISION NOT NULL CHECK(top1_score BETWEEN 0 AND 1),
  top2_score DOUBLE PRECISION NOT NULL CHECK(top2_score BETWEEN 0 AND 1),
  margin DOUBLE PRECISION NOT NULL CHECK(margin BETWEEN -1 AND 1),
  visual_confidence DOUBLE PRECISION NOT NULL CHECK(visual_confidence BETWEEN 0 AND 1),
  changed BOOLEAN,
  UNIQUE(analysis_id,item_token)
);

CREATE INDEX idx_food_vision_analyses_created ON food_vision_analyses(created_at DESC);
