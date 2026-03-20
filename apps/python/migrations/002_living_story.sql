-- Living story additions
ALTER TABLE clusters ADD COLUMN IF NOT EXISTS narrative TEXT;
ALTER TABLE clusters ADD COLUMN IF NOT EXISTS narrative_updated_at TIMESTAMPTZ;
ALTER TABLE clusters ADD COLUMN IF NOT EXISTS slug TEXT;

CREATE TABLE IF NOT EXISTS story_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cluster_id   UUID REFERENCES clusters(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,  -- 'narrative_updated', 'signal_added', 'confidence_changed'
  confidence_level TEXT,
  signal_id    UUID REFERENCES signals(id) ON DELETE SET NULL,
  summary      TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS story_events_cluster_idx
  ON story_events(cluster_id, created_at DESC);
