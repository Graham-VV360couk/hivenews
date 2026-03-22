-- Migration 005: Cybersecurity threat intelligence RSS sources
-- Adds trusted security feeds for phishing, malware, hacks, and vulnerability alerts.
-- All use standard RSS/Atom feeds — no auth required.
-- Idempotent: skips if URL already exists.

-- Tier 1 — government / official security bodies
INSERT INTO sources (name, url, platform, domain_tags, tier)
SELECT 'CISA Alerts', 'https://www.cisa.gov/uscert/ncas/alerts.xml', 'rss', ARRAY['security'], 1
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url = 'https://www.cisa.gov/uscert/ncas/alerts.xml');

INSERT INTO sources (name, url, platform, domain_tags, tier)
SELECT 'NCSC UK', 'https://www.ncsc.gov.uk/api/1/services/v1/all-rss-feed.xml', 'rss', ARRAY['security'], 1
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url = 'https://www.ncsc.gov.uk/api/1/services/v1/all-rss-feed.xml');

INSERT INTO sources (name, url, platform, domain_tags, tier)
SELECT 'Cisco Talos Intelligence', 'https://blog.talosintelligence.com/feeds/posts/default', 'rss', ARRAY['security'], 1
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url = 'https://blog.talosintelligence.com/feeds/posts/default');

-- Tier 2 — high-quality security news and research
INSERT INTO sources (name, url, platform, domain_tags, tier)
SELECT 'BleepingComputer', 'https://www.bleepingcomputer.com/feed/', 'rss', ARRAY['security'], 2
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url = 'https://www.bleepingcomputer.com/feed/');

INSERT INTO sources (name, url, platform, domain_tags, tier)
SELECT 'The Hacker News', 'https://feeds.feedburner.com/TheHackersNews', 'rss', ARRAY['security'], 2
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url = 'https://feeds.feedburner.com/TheHackersNews');

INSERT INTO sources (name, url, platform, domain_tags, tier)
SELECT 'Krebs on Security', 'https://krebsonsecurity.com/feed/', 'rss', ARRAY['security'], 2
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url = 'https://krebsonsecurity.com/feed/');

INSERT INTO sources (name, url, platform, domain_tags, tier)
SELECT 'SANS Internet Storm Center', 'https://isc.sans.edu/rssfeed.xml', 'rss', ARRAY['security'], 2
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url = 'https://isc.sans.edu/rssfeed.xml');

INSERT INTO sources (name, url, platform, domain_tags, tier)
SELECT 'Malwarebytes Labs', 'https://www.malwarebytes.com/blog/feed/', 'rss', ARRAY['security'], 2
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url = 'https://www.malwarebytes.com/blog/feed/');

INSERT INTO sources (name, url, platform, domain_tags, tier)
SELECT 'Sophos Naked Security', 'https://nakedsecurity.sophos.com/feed/', 'rss', ARRAY['security'], 2
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url = 'https://nakedsecurity.sophos.com/feed/');
