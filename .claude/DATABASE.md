# NewsHive — Database Schema

Database: PostgreSQL 16 with pgvector extension

---

## Setup

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

---

## Sources

Tracks every external source the system monitors.

```sql
CREATE TABLE sources (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  handle          TEXT,                          -- @handle or username
  url             TEXT,                          -- canonical URL
  platform        TEXT NOT NULL,                 -- rss/x/reddit/hn/github/arxiv/youtube/blog
  domain_tags     TEXT[] DEFAULT '{}',           -- ai/vr/ar/seo/vibe_coding
  tier            INTEGER DEFAULT 3,             -- 1=major publication 2=established 3=minor/unknown
  is_active       BOOLEAN DEFAULT TRUE,
  first_seen      TIMESTAMPTZ DEFAULT NOW(),
  last_ingested   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE source_reputation (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id             UUID REFERENCES sources(id) ON DELETE CASCADE,
  total_signals         INTEGER DEFAULT 0,
  confirmed_correct     INTEGER DEFAULT 0,
  confirmed_wrong       INTEGER DEFAULT 0,
  partially_correct     INTEGER DEFAULT 0,
  still_developing      INTEGER DEFAULT 0,
  accuracy_rate         DECIMAL(5,4),            -- recalculated on each outcome
  lead_time_avg_days    DECIMAL(6,2),
  lead_time_best_days   DECIMAL(6,2),
  magnitude_accuracy    DECIMAL(5,4),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_id)
);
```

---

## Signals

Every piece of ingested information.

```sql
CREATE TABLE signals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id       UUID REFERENCES sources(id),
  title           TEXT,
  content         TEXT,
  url             TEXT,
  published_at    TIMESTAMPTZ,
  ingested_at     TIMESTAMPTZ DEFAULT NOW(),

  -- Classification
  domain_tags     TEXT[] DEFAULT '{}',           -- ai/vr/ar/seo/vibe_coding/cross
  source_type     TEXT NOT NULL,                 -- rss_feed/public_forum/public_social/
                                                 -- news_publication/academic_paper/
                                                 -- patent_filing/github_public/
                                                 -- honeypot_submission
  is_public       BOOLEAN DEFAULT TRUE,
  provenance_url  TEXT,                          -- original public URL always stored

  -- Importance scoring
  magnitude_score       DECIMAL(3,1),            -- 0-10
  irreversibility_score DECIMAL(3,1),            -- 0-10
  blast_radius_score    DECIMAL(3,1),            -- 0-10
  velocity_score        DECIMAL(3,1),            -- 0-10
  importance_composite  DECIMAL(3,1),            -- weighted composite
  reality_check_passed  BOOLEAN,
  corroboration_count   INTEGER DEFAULT 0,

  -- Alert candidacy
  is_alert_candidate    BOOLEAN DEFAULT FALSE,
  alert_tier            TEXT,                    -- breaking/significant/watch

  -- Confidence
  confidence_level      TEXT DEFAULT 'unassessed', -- confirmed/developing/pinch_of_salt/watching

  -- Cluster assignment
  cluster_id      UUID,                          -- FK added after clusters table created

  -- Vector embedding
  embedding       vector(1536),

  -- Processing state
  processed       BOOLEAN DEFAULT FALSE,
  processing_error TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX signals_embedding_idx ON signals USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX signals_ingested_at_idx ON signals(ingested_at DESC);
CREATE INDEX signals_domain_tags_idx ON signals USING GIN(domain_tags);
CREATE INDEX signals_importance_idx ON signals(importance_composite DESC);
CREATE INDEX signals_cluster_idx ON signals(cluster_id);
```

---

## Clusters

Groups of semantically related signals forming a coherent topic.

```sql
CREATE TABLE clusters (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  TEXT,                    -- auto-generated descriptive name
  domain_tags           TEXT[] DEFAULT '{}',
  centroid_embedding    vector(1536),             -- mean of member embeddings
  signal_count          INTEGER DEFAULT 0,
  first_signal_at       TIMESTAMPTZ,
  last_signal_at        TIMESTAMPTZ,

  -- Readiness scoring
  readiness_score       DECIMAL(5,2) DEFAULT 0,
  signal_volume_score   DECIMAL(5,2) DEFAULT 0,
  signal_diversity_score DECIMAL(5,2) DEFAULT 0,
  novelty_score         DECIMAL(5,2) DEFAULT 0,
  trajectory_shift_score DECIMAL(5,2) DEFAULT 0,
  cross_domain_score    DECIMAL(5,2) DEFAULT 0,
  last_readiness_calc   TIMESTAMPTZ,

  -- Content pack trigger
  readiness_threshold   DECIMAL(5,2) DEFAULT 75.0, -- configurable per cluster
  last_pack_triggered   TIMESTAMPTZ,
  days_since_last_pack  INTEGER,                  -- computed, used in hard cap logic

  is_active             BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Add FK now both tables exist
ALTER TABLE signals ADD CONSTRAINT signals_cluster_fk
  FOREIGN KEY (cluster_id) REFERENCES clusters(id);

CREATE INDEX clusters_centroid_idx ON clusters USING ivfflat (centroid_embedding vector_cosine_ops);
CREATE INDEX clusters_readiness_idx ON clusters(readiness_score DESC);
CREATE INDEX clusters_domain_idx ON clusters USING GIN(domain_tags);
```

---

## Alert Candidates

High-importance signals that have passed the reality check pipeline.

```sql
CREATE TABLE alert_candidates (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  signal_ids              UUID[] NOT NULL,
  cluster_id              UUID REFERENCES clusters(id),

  -- Scoring
  magnitude_score         DECIMAL(3,1),
  irreversibility_score   DECIMAL(3,1),
  blast_radius_score      DECIMAL(3,1),
  velocity_score          DECIMAL(3,1),
  composite_score         DECIMAL(3,1),

  -- Reality check
  reality_check_passed    BOOLEAN DEFAULT FALSE,
  source_tier_min         INTEGER,               -- lowest tier among sources
  corroboration_count     INTEGER DEFAULT 0,
  too_good_to_be_true     BOOLEAN DEFAULT FALSE, -- magnitude >9.5 + low corroboration

  -- Alert classification
  alert_tier              TEXT,                  -- breaking/significant/watch
  confidence_level        TEXT,                  -- confirmed/developing/pinch_of_salt

  -- Lifecycle
  fired_at                TIMESTAMPTZ,
  content_pack_id         UUID,                  -- FK added after content_packs table
  outcome_notes           TEXT,                  -- filled retrospectively
  outcome_accurate        BOOLEAN,               -- filled retrospectively

  created_at              TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Source Tokens (Honeypot)

Anonymous source tracking. No identifying information ever stored.

```sql
CREATE TABLE source_tokens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token           TEXT UNIQUE NOT NULL,          -- e.g. SCOUT-7734, DRONE-3341
  token_prefix    TEXT NOT NULL,                 -- SCOUT or DRONE (random assignment)

  -- One-time verdict only — inputs to verdict are never stored
  initial_verdict TEXT NOT NULL,                 -- reliable/indefinite/illegitimate
  verdict_at      TIMESTAMPTZ DEFAULT NOW(),

  -- Track record (built over time from outcomes only)
  submission_count        INTEGER DEFAULT 0,
  confirmed_correct       INTEGER DEFAULT 0,
  confirmed_wrong         INTEGER DEFAULT 0,
  partially_correct       INTEGER DEFAULT 0,
  still_developing        INTEGER DEFAULT 0,
  accuracy_rate           DECIMAL(5,4),
  lead_time_avg_days      DECIMAL(6,2),

  -- Tier (moves automatically based on track record)
  current_tier            INTEGER DEFAULT 0,     -- 0=new 1=emerging 2=credible 3=reliable 4=exemplary
  tier_updated_at         TIMESTAMPTZ,

  -- No identifying information. Ever.
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  last_submission_at      TIMESTAMPTZ
);

CREATE TABLE honeypot_submissions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_id        UUID REFERENCES source_tokens(id),

  -- Content (encrypted at rest)
  content_encrypted TEXT NOT NULL,

  -- Corroboration check result
  instant_corroboration   BOOLEAN DEFAULT FALSE,
  corroboration_signal_id UUID REFERENCES signals(id),
  corroboration_window    TEXT,                  -- tight/medium/loose/none

  -- Confidence routing
  confidence_level        TEXT DEFAULT 'pinch_of_salt',
  entered_queue           TEXT,                  -- pinch_of_salt/developing/confirmed/held

  -- Outcome tracking
  outcome                 TEXT,                  -- pending/confirmed/wrong/partial/unresolved
  outcome_at              TIMESTAMPTZ,
  outcome_notes           TEXT,
  days_to_confirmation    INTEGER,               -- calculated on outcome

  -- Links
  content_pack_id         UUID,
  published_post_ids      UUID[],

  submitted_at            TIMESTAMPTZ DEFAULT NOW(),

  -- Metadata stripped — no IP, no fingerprint, no timezone
  submission_sequence     INTEGER                -- 1st, 2nd, 3rd submission from this token
);
```

---

## Trajectories

Named theories about where a domain or technology is heading.

```sql
CREATE TABLE trajectories (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,                 -- "Spatial computing breakout before VR"
  domain_tags     TEXT[] DEFAULT '{}',
  description     TEXT,

  -- Current state
  status          TEXT DEFAULT 'active',         -- active/confirmed/abandoned/superseded
  confidence_score DECIMAL(3,1),                 -- 0-10, updated over time
  confidence_direction TEXT,                     -- rising/falling/stable

  -- Scenarios
  most_likely_path    TEXT,
  accelerated_scenario TEXT,
  disruption_scenario TEXT,
  stagnation_scenario TEXT,

  -- Evidence
  supporting_signal_ids UUID[],
  contradicting_signal_ids UUID[],

  -- Publication
  first_published_at  TIMESTAMPTZ,
  last_updated_at     TIMESTAMPTZ,

  -- Outcome (if resolved)
  outcome             TEXT,
  outcome_at          TIMESTAMPTZ,
  outcome_notes       TEXT,

  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE trajectory_versions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trajectory_id   UUID REFERENCES trajectories(id) ON DELETE CASCADE,
  version_number  INTEGER NOT NULL,
  confidence_score DECIMAL(3,1),
  description     TEXT,
  reason_for_change TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Content Packs

The unit of content production — one pack per trigger event, all platforms together.

```sql
CREATE TABLE content_packs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cluster_id      UUID REFERENCES clusters(id),
  alert_candidate_id UUID REFERENCES alert_candidates(id),
  pack_type       TEXT NOT NULL,                 -- standard/alert_breaking/alert_significant/
                                                 -- pinch_of_salt/weekly_brief/monthly_report

  -- Trigger metadata
  triggered_at    TIMESTAMPTZ DEFAULT NOW(),
  trigger_reason  TEXT,                          -- readiness_threshold/alert/schedule/manual
  readiness_score DECIMAL(5,2),
  signal_ids      UUID[],                        -- signals that fed this pack

  -- Approval state
  status          TEXT DEFAULT 'drafting',       -- drafting/pending_approval/approved/
                                                 -- partially_approved/published/rejected
  operator_notes  TEXT,
  approved_at     TIMESTAMPTZ,

  -- Broadcast
  hivecast_script TEXT,
  hivecast_video_url TEXT,
  hivecast_video_status TEXT,                    -- pending/generating/complete/failed
  hivecast_type   TEXT,                          -- full/highlight/teaser/audiogram

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  published_at    TIMESTAMPTZ
);

CREATE TABLE content_drafts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pack_id         UUID REFERENCES content_packs(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL,                 -- instagram/linkedin/facebook/x/threads/
                                                 -- youtube/blog/newsletter/rss
  draft_text      TEXT,
  suggested_visuals TEXT,                        -- description for image gen or asset selection
  hashtags        TEXT[],
  confidence_label TEXT,                         -- as it will appear in the post

  -- Approval
  approved        BOOLEAN DEFAULT FALSE,
  operator_edits  TEXT,                          -- what the operator changed
  final_text      TEXT,                          -- post-edit version

  -- Publishing
  published_at    TIMESTAMPTZ,
  published_url   TEXT,
  platform_post_id TEXT,                         -- platform-native ID for the published post

  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Monthly Snapshots

The data that powers the HiveReport.

```sql
CREATE TABLE monthly_snapshots (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_year           INTEGER NOT NULL,
  period_month          INTEGER NOT NULL,        -- 1-12

  -- Volume metrics
  signals_ingested      INTEGER DEFAULT 0,
  alerts_fired          INTEGER DEFAULT 0,
  alerts_confirmed      INTEGER DEFAULT 0,
  pinch_of_salt_issued  INTEGER DEFAULT 0,
  pinch_of_salt_confirmed INTEGER DEFAULT 0,
  pinch_of_salt_wrong   INTEGER DEFAULT 0,
  pinch_of_salt_developing INTEGER DEFAULT 0,
  content_packs_published INTEGER DEFAULT 0,

  -- Accuracy metrics
  overall_accuracy_rate DECIMAL(5,4),
  avg_lead_time_days    DECIMAL(6,2),
  trajectory_calls_made INTEGER DEFAULT 0,
  trajectory_correct    INTEGER DEFAULT 0,
  trajectory_wrong      INTEGER DEFAULT 0,
  trajectory_partial    INTEGER DEFAULT 0,

  -- Domain activity
  domain_activity       JSONB,                   -- {ai: high, vr: medium, seo: high, ...}

  -- Signal of the month
  signal_of_month_id    UUID REFERENCES signals(id),
  signal_of_month_notes TEXT,

  -- What to watch
  watching_items        JSONB,                   -- [{item, domain, if_happens_then}]

  -- Report content
  draft_generated_at    TIMESTAMPTZ,
  operator_reviewed     BOOLEAN DEFAULT FALSE,
  published_at          TIMESTAMPTZ,
  blog_post_url         TEXT,
  hivecast_url          TEXT,

  UNIQUE(period_year, period_month),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Pinch of Salt Watch

Tracks outstanding unconfirmed signals across their lifecycle.

```sql
CREATE TABLE pinch_of_salt_watch (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  signal_id             UUID REFERENCES signals(id),
  honeypot_submission_id UUID REFERENCES honeypot_submissions(id),
  source_token_id       UUID REFERENCES source_tokens(id),

  -- The claim
  summary               TEXT NOT NULL,
  domain_tags           TEXT[] DEFAULT '{}',
  magnitude_score       DECIMAL(3,1),

  -- Source context (no identifying info — just reputation at time of submission)
  source_verdict_at_time TEXT,                   -- reliable/indefinite/illegitimate
  source_tier_at_time   INTEGER,
  source_accuracy_at_time DECIMAL(5,4),

  -- Status
  status                TEXT DEFAULT 'watching', -- watching/developing/confirmed/wrong/stale
  published_at          TIMESTAMPTZ,
  published_post_ids    UUID[],

  -- Resolution
  outcome               TEXT,
  outcome_at            TIMESTAMPTZ,
  confirming_source_id  UUID REFERENCES sources(id),
  confirming_signal_id  UUID REFERENCES signals(id),
  days_to_confirmation  INTEGER,
  lead_time_vs_mainstream INTEGER,               -- days ahead of tier 1 confirmation

  -- Staleness
  stale_after_days      INTEGER DEFAULT 90,
  marked_stale_at       TIMESTAMPTZ,

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
```

---

## RSS / API Subscriptions

```sql
CREATE TABLE api_subscribers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           TEXT NOT NULL,
  api_key         TEXT UNIQUE NOT NULL,
  tier            TEXT DEFAULT 'free',           -- free/pro/enterprise
  domain_filters  TEXT[] DEFAULT '{}',           -- empty = all domains
  feed_filters    TEXT[] DEFAULT '{}',           -- empty = all feeds
  webhook_url     TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  last_used_at    TIMESTAMPTZ
);
```

---

## Indexes Summary

```sql
-- Performance indexes beyond those defined inline
CREATE INDEX signals_published_at_idx ON signals(published_at DESC);
CREATE INDEX signals_confidence_idx ON signals(confidence_level);
CREATE INDEX signals_is_alert_idx ON signals(is_alert_candidate) WHERE is_alert_candidate = TRUE;
CREATE INDEX pinch_watch_status_idx ON pinch_of_salt_watch(status);
CREATE INDEX pinch_watch_outcome_idx ON pinch_of_salt_watch(outcome);
CREATE INDEX content_packs_status_idx ON content_packs(status);
CREATE INDEX content_drafts_approved_idx ON content_drafts(approved);
CREATE INDEX source_tokens_tier_idx ON source_tokens(current_tier);
CREATE INDEX trajectories_status_idx ON trajectories(status);
```
