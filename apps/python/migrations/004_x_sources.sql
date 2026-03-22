-- Migration 004: X / Twitter sources
-- Polled via RSSHub — requires RSSHUB_BASE_URL to be configured.
-- handle is stored without @; poll_x_sources() constructs the feed URL.
-- Idempotent: skips if handle already exists for platform = 'x'.

-- AI
INSERT INTO sources (name, handle, platform, domain_tags, tier)
SELECT 'X: OpenAI', 'OpenAI', 'x', ARRAY['ai'], 1
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE platform = 'x' AND handle = 'OpenAI');

INSERT INTO sources (name, handle, platform, domain_tags, tier)
SELECT 'X: Anthropic', 'AnthropicAI', 'x', ARRAY['ai'], 1
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE platform = 'x' AND handle = 'AnthropicAI');

INSERT INTO sources (name, handle, platform, domain_tags, tier)
SELECT 'X: Google DeepMind', 'GoogleDeepMind', 'x', ARRAY['ai'], 1
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE platform = 'x' AND handle = 'GoogleDeepMind');

INSERT INTO sources (name, handle, platform, domain_tags, tier)
SELECT 'X: Hugging Face', 'huggingface', 'x', ARRAY['ai'], 1
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE platform = 'x' AND handle = 'huggingface');

INSERT INTO sources (name, handle, platform, domain_tags, tier)
SELECT 'X: Andrej Karpathy', 'karpathy', 'x', ARRAY['ai'], 2
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE platform = 'x' AND handle = 'karpathy');

INSERT INTO sources (name, handle, platform, domain_tags, tier)
SELECT 'X: Sam Altman', 'sama', 'x', ARRAY['ai'], 2
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE platform = 'x' AND handle = 'sama');

-- VR / AR
INSERT INTO sources (name, handle, platform, domain_tags, tier)
SELECT 'X: Meta Quest', 'MetaQuestVR', 'x', ARRAY['vr'], 1
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE platform = 'x' AND handle = 'MetaQuestVR');

INSERT INTO sources (name, handle, platform, domain_tags, tier)
SELECT 'X: Steam VR', 'SteamVR', 'x', ARRAY['vr'], 1
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE platform = 'x' AND handle = 'SteamVR');

INSERT INTO sources (name, handle, platform, domain_tags, tier)
SELECT 'X: John Carmack', 'ID_AA_Carmack', 'x', ARRAY['vr', 'ai'], 2
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE platform = 'x' AND handle = 'ID_AA_Carmack');

-- SEO
INSERT INTO sources (name, handle, platform, domain_tags, tier)
SELECT 'X: Barry Schwartz', 'rustybrick', 'x', ARRAY['seo'], 2
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE platform = 'x' AND handle = 'rustybrick');

INSERT INTO sources (name, handle, platform, domain_tags, tier)
SELECT 'X: Gary Illyes (Google)', 'methode', 'x', ARRAY['seo'], 1
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE platform = 'x' AND handle = 'methode');

-- Vibe Coding
INSERT INTO sources (name, handle, platform, domain_tags, tier)
SELECT 'X: Cursor', 'cursor_ai', 'x', ARRAY['vibe_coding'], 1
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE platform = 'x' AND handle = 'cursor_ai');

INSERT INTO sources (name, handle, platform, domain_tags, tier)
SELECT 'X: GitHub', 'github', 'x', ARRAY['vibe_coding', 'cross'], 1
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE platform = 'x' AND handle = 'github');

INSERT INTO sources (name, handle, platform, domain_tags, tier)
SELECT 'X: Vercel', 'vercel', 'x', ARRAY['vibe_coding'], 1
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE platform = 'x' AND handle = 'vercel');
