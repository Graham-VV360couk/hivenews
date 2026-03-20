-- NewsHive — Initial Schema
-- Implements the full schema from .claude/DATABASE.md
--
-- Note on FK approach: clusters is defined before signals here to allow the
-- cluster_id FK to be declared inline on signals, avoiding the ALTER TABLE
-- workaround in DATABASE.md (which used the reverse order). Functionally identical.

-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Sources
CREATE TABLE IF NOT EXISTS sources (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  handle          TEXT,
  url             TEXT,
  platform        TEXT NOT NULL,
  domain_tags     TEXT[] DEFAULT '{}',
  tier            INTEGER DEFAULT 3,
  is_active       BOOLEAN DEFAULT TRUE,
  first_seen      TIMESTAMPTZ DEFAULT NOW(),
  last_ingested   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS source_reputation (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id             UUID REFERENCES sources(id) ON DELETE CASCADE,
  total_signals         INTEGER DEFAULT 0,
  confirmed_correct     INTEGER DEFAULT 0,
  confirmed_wrong       INTEGER DEFAULT 0,
  partially_correct     INTEGER DEFAULT 0,
  still_developing      INTEGER DEFAULT 0,
  accuracy_rate         DECIMAL(5,4),
  lead_time_avg_days    DECIMAL(6,2),
  lead_time_best_days   DECIMAL(6,2),
  magnitude_accuracy    DECIMAL(5,4),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_id)
);

-- Clusters (defined before signals to allow inline FK)
CREATE TABLE IF NOT EXISTS clusters (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  TEXT,
  domain_tags           TEXT[] DEFAULT '{}',
  centroid_embedding    vector(1536),
  signal_count          INTEGER DEFAULT 0,
  first_signal_at       TIMESTAMPTZ,
  last_signal_at        TIMESTAMPTZ,
  readiness_score       DECIMAL(5,2) DEFAULT 0,
  signal_volume_score   DECIMAL(5,2) DEFAULT 0,
  signal_diversity_score DECIMAL(5,2) DEFAULT 0,
  novelty_score         DECIMAL(5,2) DEFAULT 0,
  trajectory_shift_score DECIMAL(5,2) DEFAULT 0,
  cross_domain_score    DECIMAL(5,2) DEFAULT 0,
  last_readiness_calc   TIMESTAMPTZ,
  readiness_threshold   DECIMAL(5,2) DEFAULT 75.0,
  last_pack_triggered   TIMESTAMPTZ,
  days_since_last_pack  INTEGER,
  is_active             BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ivfflat indexes require lists tuning; 100 is appropriate for initial scale.
-- PostgreSQL will warn on empty table — this is expected and harmless.
CREATE INDEX IF NOT EXISTS clusters_centroid_idx
  ON clusters USING ivfflat (centroid_embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS clusters_readiness_idx ON clusters(readiness_score DESC);
CREATE INDEX IF NOT EXISTS clusters_domain_idx ON clusters USING GIN(domain_tags);

-- Signals
CREATE TABLE IF NOT EXISTS signals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id       UUID REFERENCES sources(id),
  title           TEXT,
  content         TEXT,
  url             TEXT,
  published_at    TIMESTAMPTZ,
  ingested_at     TIMESTAMPTZ DEFAULT NOW(),
  domain_tags     TEXT[] DEFAULT '{}',
  source_type     TEXT NOT NULL,
  is_public       BOOLEAN DEFAULT TRUE,
  provenance_url  TEXT,
  magnitude_score       DECIMAL(3,1),
  irreversibility_score DECIMAL(3,1),
  blast_radius_score    DECIMAL(3,1),
  velocity_score        DECIMAL(3,1),
  importance_composite  DECIMAL(3,1),
  reality_check_passed  BOOLEAN,
  corroboration_count   INTEGER DEFAULT 0,
  is_alert_candidate    BOOLEAN DEFAULT FALSE,
  alert_tier            TEXT,
  confidence_level      TEXT DEFAULT 'unassessed',
  cluster_id      UUID REFERENCES clusters(id),
  embedding       vector(1536),
  processed       BOOLEAN DEFAULT FALSE,
  processing_error TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS signals_embedding_idx
  ON signals USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS signals_ingested_at_idx  ON signals(ingested_at DESC);
CREATE INDEX IF NOT EXISTS signals_published_at_idx ON signals(published_at DESC);
CREATE INDEX IF NOT EXISTS signals_domain_tags_idx  ON signals USING GIN(domain_tags);
CREATE INDEX IF NOT EXISTS signals_importance_idx   ON signals(importance_composite DESC);
CREATE INDEX IF NOT EXISTS signals_cluster_idx      ON signals(cluster_id);
CREATE INDEX IF NOT EXISTS signals_confidence_idx   ON signals(confidence_level);
CREATE INDEX IF NOT EXISTS signals_is_alert_idx     ON signals(is_alert_candidate)
  WHERE is_alert_candidate = TRUE;

-- Alert Candidates
CREATE TABLE IF NOT EXISTS alert_candidates (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  signal_ids              UUID[] NOT NULL,
  cluster_id              UUID REFERENCES clusters(id),
  magnitude_score         DECIMAL(3,1),
  irreversibility_score   DECIMAL(3,1),
  blast_radius_score      DECIMAL(3,1),
  velocity_score          DECIMAL(3,1),
  composite_score         DECIMAL(3,1),
  reality_check_passed    BOOLEAN DEFAULT FALSE,
  source_tier_min         INTEGER,
  corroboration_count     INTEGER DEFAULT 0,
  too_good_to_be_true     BOOLEAN DEFAULT FALSE,
  alert_tier              TEXT,
  confidence_level        TEXT,
  fired_at                TIMESTAMPTZ,
  content_pack_id         UUID,
  outcome_notes           TEXT,
  outcome_accurate        BOOLEAN,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Source Tokens (Honeypot — no identifying information ever stored)
CREATE TABLE IF NOT EXISTS source_tokens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token           TEXT UNIQUE NOT NULL,
  token_prefix    TEXT NOT NULL,
  initial_verdict TEXT NOT NULL,
  verdict_at      TIMESTAMPTZ DEFAULT NOW(),
  submission_count        INTEGER DEFAULT 0,
  confirmed_correct       INTEGER DEFAULT 0,
  confirmed_wrong         INTEGER DEFAULT 0,
  partially_correct       INTEGER DEFAULT 0,
  still_developing        INTEGER DEFAULT 0,
  accuracy_rate           DECIMAL(5,4),
  lead_time_avg_days      DECIMAL(6,2),
  current_tier            INTEGER DEFAULT 0,
  tier_updated_at         TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  last_submission_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS source_tokens_tier_idx ON source_tokens(current_tier);

CREATE TABLE IF NOT EXISTS honeypot_submissions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_id        UUID REFERENCES source_tokens(id),
  content_encrypted TEXT NOT NULL,
  instant_corroboration   BOOLEAN DEFAULT FALSE,
  corroboration_signal_id UUID REFERENCES signals(id),
  corroboration_window    TEXT,
  confidence_level        TEXT DEFAULT 'pinch_of_salt',
  entered_queue           TEXT,
  outcome                 TEXT,
  outcome_at              TIMESTAMPTZ,
  outcome_notes           TEXT,
  days_to_confirmation    INTEGER,
  content_pack_id         UUID,
  published_post_ids      UUID[],
  submitted_at            TIMESTAMPTZ DEFAULT NOW(),
  submission_sequence     INTEGER
);

-- Trajectories
CREATE TABLE IF NOT EXISTS trajectories (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  domain_tags     TEXT[] DEFAULT '{}',
  description     TEXT,
  status          TEXT DEFAULT 'active',
  confidence_score DECIMAL(3,1),
  confidence_direction TEXT,
  most_likely_path    TEXT,
  accelerated_scenario TEXT,
  disruption_scenario TEXT,
  stagnation_scenario TEXT,
  supporting_signal_ids UUID[],
  contradicting_signal_ids UUID[],
  first_published_at  TIMESTAMPTZ,
  last_updated_at     TIMESTAMPTZ,
  outcome             TEXT,
  outcome_at          TIMESTAMPTZ,
  outcome_notes       TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS trajectories_status_idx ON trajectories(status);

CREATE TABLE IF NOT EXISTS trajectory_versions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trajectory_id   UUID REFERENCES trajectories(id) ON DELETE CASCADE,
  version_number  INTEGER NOT NULL,
  confidence_score DECIMAL(3,1),
  description     TEXT,
  reason_for_change TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Content Packs
CREATE TABLE IF NOT EXISTS content_packs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cluster_id      UUID REFERENCES clusters(id),
  alert_candidate_id UUID REFERENCES alert_candidates(id),
  pack_type       TEXT NOT NULL,
  triggered_at    TIMESTAMPTZ DEFAULT NOW(),
  trigger_reason  TEXT,
  readiness_score DECIMAL(5,2),
  signal_ids      UUID[],
  status          TEXT DEFAULT 'drafting',
  operator_notes  TEXT,
  approved_at     TIMESTAMPTZ,
  hivecast_script TEXT,
  hivecast_video_url TEXT,
  hivecast_video_status TEXT,
  hivecast_type   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  published_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS content_packs_status_idx ON content_packs(status);

CREATE TABLE IF NOT EXISTS content_drafts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pack_id         UUID REFERENCES content_packs(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL,
  draft_text      TEXT,
  suggested_visuals TEXT,
  hashtags        TEXT[],
  confidence_label TEXT,
  approved        BOOLEAN DEFAULT FALSE,
  operator_edits  TEXT,
  final_text      TEXT,
  published_at    TIMESTAMPTZ,
  published_url   TEXT,
  platform_post_id TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS content_drafts_approved_idx ON content_drafts(approved);

-- Monthly Snapshots
CREATE TABLE IF NOT EXISTS monthly_snapshots (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_year           INTEGER NOT NULL,
  period_month          INTEGER NOT NULL,
  signals_ingested      INTEGER DEFAULT 0,
  alerts_fired          INTEGER DEFAULT 0,
  alerts_confirmed      INTEGER DEFAULT 0,
  pinch_of_salt_issued  INTEGER DEFAULT 0,
  pinch_of_salt_confirmed INTEGER DEFAULT 0,
  pinch_of_salt_wrong   INTEGER DEFAULT 0,
  pinch_of_salt_developing INTEGER DEFAULT 0,
  content_packs_published INTEGER DEFAULT 0,
  overall_accuracy_rate DECIMAL(5,4),
  avg_lead_time_days    DECIMAL(6,2),
  trajectory_calls_made INTEGER DEFAULT 0,
  trajectory_correct    INTEGER DEFAULT 0,
  trajectory_wrong      INTEGER DEFAULT 0,
  trajectory_partial    INTEGER DEFAULT 0,
  domain_activity       JSONB,
  signal_of_month_id    UUID REFERENCES signals(id),
  signal_of_month_notes TEXT,
  watching_items        JSONB,
  draft_generated_at    TIMESTAMPTZ,
  operator_reviewed     BOOLEAN DEFAULT FALSE,
  published_at          TIMESTAMPTZ,
  blog_post_url         TEXT,
  hivecast_url          TEXT,
  UNIQUE(period_year, period_month),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Pinch of Salt Watch
CREATE TABLE IF NOT EXISTS pinch_of_salt_watch (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  signal_id             UUID REFERENCES signals(id),
  honeypot_submission_id UUID REFERENCES honeypot_submissions(id),
  source_token_id       UUID REFERENCES source_tokens(id),
  summary               TEXT NOT NULL,
  domain_tags           TEXT[] DEFAULT '{}',
  magnitude_score       DECIMAL(3,1),
  source_verdict_at_time TEXT,
  source_tier_at_time   INTEGER,
  source_accuracy_at_time DECIMAL(5,4),
  status                TEXT DEFAULT 'watching',
  published_at          TIMESTAMPTZ,
  published_post_ids    UUID[],
  outcome               TEXT,
  outcome_at            TIMESTAMPTZ,
  confirming_source_id  UUID REFERENCES sources(id),
  confirming_signal_id  UUID REFERENCES signals(id),
  days_to_confirmation  INTEGER,
  lead_time_vs_mainstream INTEGER,
  stale_after_days      INTEGER DEFAULT 90,
  marked_stale_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pinch_watch_status_idx  ON pinch_of_salt_watch(status);
CREATE INDEX IF NOT EXISTS pinch_watch_outcome_idx ON pinch_of_salt_watch(outcome);

-- API Subscribers
CREATE TABLE IF NOT EXISTS api_subscribers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           TEXT NOT NULL,
  api_key         TEXT UNIQUE NOT NULL,
  tier            TEXT DEFAULT 'free',
  domain_filters  TEXT[] DEFAULT '{}',
  feed_filters    TEXT[] DEFAULT '{}',
  webhook_url     TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  last_used_at    TIMESTAMPTZ
);
