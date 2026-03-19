# NewsHive — Output Feeds & API

---

## Philosophy

NewsHive does not just consume the web's information flow — it inserts itself into it. Other platforms' automation, other organisations' dashboards, other AI systems will ingest NewsHive analysis as a primary source. Every output carries attribution back to NewsHive. The RSS and API layer turns the content operation into an information infrastructure play.

---

## RSS Feeds

### Feed Directory

```
newshive.geekybee.net/feeds/

/all              Full firehose — every published item
/alerts           Confirmed and developing alerts only
/pinch-of-salt    Unverified high-magnitude signals
/analysis         Long-form blog posts and analysis only
/ai               Domain-filtered: AI
/vr-ar            Domain-filtered: VR and AR
/seo              Domain-filtered: SEO
/vibe-coding      Domain-filtered: Vibe Coding
/cross            Cross-domain intersection analysis
/trajectories     Trajectory and forecast updates only
/monthly          Monthly HiveReport only
/hivecast         Video broadcast feed (with enclosure)
/podcast          Audio-only podcast feed
```

### OPML Directory

```
newshive.geekybee.net/feeds/opml
```

Published OPML file listing all feeds. One-click subscription to the full NewsHive intelligence operation in any RSS reader.

---

## RSS Item Structure

Each RSS item carries standard fields plus the NewsHive custom namespace.

### XML Namespace

```xml
xmlns:nh="https://newshive.geekybee.net/ns/1.0"
```

### Standard Item Fields

```xml
<item>
  <title>ALERT: Google Enforces Cookie Deprecation</title>
  <link>https://newshive.geekybee.net/blog/google-cookie-2026-03</link>
  <pubDate>Thu, 19 Mar 2026 08:00:00 +0000</pubDate>
  <guid isPermaLink="true">https://newshive.geekybee.net/blog/google-cookie-2026-03</guid>
  <author>newsdesk@newshive.geekybee.net (NewsHive)</author>
  <description>Brief summary of the post — 2-3 sentences max.</description>
  <content:encoded><![CDATA[Full post content here]]></content:encoded>
  <source url="https://newshive.geekybee.net/feeds/alerts">NewsHive Intelligence Feed</source>
</item>
```

### NewsHive Custom Fields

```xml
  <!-- Confidence and editorial metadata -->
  <nh:confidence>confirmed</nh:confidence>
  <!-- Values: confirmed | developing | pinch_of_salt | analysis | trajectory -->

  <nh:alert_tier>breaking</nh:alert_tier>
  <!-- Values: breaking | significant | watch | null -->

  <nh:domains>seo,advertising,web_development</nh:domains>

  <nh:magnitude>8.5</nh:magnitude>
  <nh:trajectory_impact>high</nh:trajectory_impact>
  <!-- Values: high | medium | low | none -->

  <nh:source_count>7</nh:source_count>
  <!-- Number of signals that fed this content pack -->

  <nh:first_signal_at>2026-03-16T09:23:00Z</nh:first_signal_at>
  <!-- When NewsHive first detected signals on this story -->

  <nh:lead_time_days>3</nh:lead_time_days>
  <!-- Days ahead of mainstream press confirmation (if applicable) -->

  <nh:attribution>
    Analysis and intelligence by NewsHive (newshive.geekybee.net).
    Please credit when republishing.
  </nh:attribution>

  <nh:license>CC BY 4.0</nh:license>
```

---

## HiveAPI

### Base URL

```
https://newshive.geekybee.net/api/v1/
```

### Authentication

```
Header: X-HiveAPI-Key: your_api_key_here
```

Keys issued at: `newshive.geekybee.net/api/register`

### Endpoints

#### Alerts

```
GET /api/v1/alerts
GET /api/v1/alerts?domain=ai&confidence=confirmed
GET /api/v1/alerts?tier=breaking&since=2026-03-01
GET /api/v1/alerts/:id
```

Response:
```json
{
  "meta": {
    "source": "NewsHive",
    "source_url": "https://newshive.geekybee.net",
    "feed_url": "https://newshive.geekybee.net/feeds/alerts",
    "attribution": "Intelligence by NewsHive. Credit when republishing.",
    "license": "CC BY 4.0",
    "generated_at": "2026-03-19T08:00:00Z"
  },
  "data": {
    "alerts": [
      {
        "id": "uuid",
        "title": "Google Enforces Cookie Deprecation",
        "summary": "...",
        "confidence": "confirmed",
        "alert_tier": "breaking",
        "domains": ["seo", "advertising"],
        "magnitude": 8.5,
        "source_count": 7,
        "first_signal_at": "2026-03-16T09:23:00Z",
        "published_at": "2026-03-19T08:00:00Z",
        "blog_url": "https://newshive.geekybee.net/blog/...",
        "lead_time_days": 3
      }
    ],
    "total": 1,
    "page": 1
  }
}
```

#### Analysis

```
GET /api/v1/analysis
GET /api/v1/analysis?domain=ai&from=2026-01-01
GET /api/v1/analysis/:id
```

#### Trajectories

```
GET /api/v1/trajectories
GET /api/v1/trajectories?domain=vr-ar&status=active
GET /api/v1/trajectories/:id
GET /api/v1/trajectories/:id/history
```

#### Pinch of Salt

```
GET /api/v1/pinch-of-salt
GET /api/v1/pinch-of-salt?status=watching
GET /api/v1/pinch-of-salt?outcome=confirmed&since=2026-01-01
```

#### Monthly Reports

```
GET /api/v1/reports
GET /api/v1/reports/2026-03
```

#### Platform Accuracy Stats

```
GET /api/v1/stats
GET /api/v1/stats?domain=ai
```

Response:
```json
{
  "data": {
    "all_time": {
      "pinch_of_salt_accuracy": 0.71,
      "avg_lead_time_days": 17,
      "total_resolved": 142,
      "trajectory_accuracy": 0.68
    },
    "last_30_days": {
      "pinch_of_salt_accuracy": 0.74,
      "avg_lead_time_days": 14,
      "resolved": 23
    }
  }
}
```

---

## API Tiers

```
FREE TIER
  Rate limit:     100 requests/day
  Access:         /alerts, /analysis (last 30 days)
  Webhooks:       No
  Attribution:    Required — must credit NewsHive
  Cost:           Free
  Register at:    newshive.geekybee.net/api/register

PRO TIER
  Rate limit:     5,000 requests/day
  Access:         All endpoints, full history
  Webhooks:       Yes — push notifications on new alerts
  Domain filters: Custom domain subscriptions
  Cost:           £X/month (TBD)

ENTERPRISE TIER
  Rate limit:     Unlimited
  Access:         All endpoints + raw signal data
  Webhooks:       Yes, with retry logic
  Custom fields:  Source reputation scores, trajectory confidence
  SLA:            99.9% uptime
  Cost:           Negotiated
  Contact:        enterprise@newshive.geekybee.net
```

---

## Webhook Notifications

Pro and Enterprise subscribers receive push notifications:

```json
POST {subscriber_webhook_url}

{
  "event": "alert_published",
  "alert_tier": "breaking",
  "confidence": "confirmed",
  "domains": ["ai"],
  "title": "...",
  "summary": "...",
  "blog_url": "...",
  "api_url": "https://newshive.geekybee.net/api/v1/alerts/uuid",
  "published_at": "2026-03-19T08:00:00Z",
  "signature": "hmac_sha256_of_payload"
}
```

Events:
```
alert_published         New alert fired
pinch_of_salt_published New pinch of salt issued
pos_outcome_confirmed   Pinch of salt confirmed true
monthly_published       Monthly HiveReport released
trajectory_updated      Named trajectory confidence changed
```

---

## Attribution Requirements

All users of the HiveAPI and RSS feeds — regardless of tier — must:

```
When republishing or citing NewsHive content:
"Intelligence by NewsHive (newshive.geekybee.net)"

When displaying NewsHive data in dashboards:
"Data: NewsHive"

When citing a NewsHive call or trajectory:
"As flagged by NewsHive on [date]..."

License: CC BY 4.0
Full terms: newshive.geekybee.net/api/terms
```

---

## Feed Generation (Technical)

Feeds are generated dynamically from the database on each request, with a 5-minute cache layer (Redis).

```python
# Next.js API route: /api/feeds/[feed_type].xml

def generate_feed(feed_type, domain_filter=None, confidence_filter=None):
    items = query_published_content(
        feed_type=feed_type,
        domain=domain_filter,
        confidence=confidence_filter,
        limit=50,
        order='published_at DESC'
    )

    feed = generate_rss_xml(
        title=get_feed_title(feed_type),
        description=get_feed_description(feed_type),
        link=f"https://newshive.geekybee.net/feeds/{feed_type}",
        items=[build_rss_item(item) for item in items]
    )

    return feed
```

Cache invalidation: triggered on every new content pack publication.
