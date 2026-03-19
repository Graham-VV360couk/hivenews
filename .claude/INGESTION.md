# NewsHive — Ingestion Layer

---

## Source Tiers

```
TIER 1 — Major Publications
Reuters, BBC, Financial Times, Wall Street Journal,
Washington Post, The Guardian, Bloomberg, AP News

TIER 2 — Established Tech Media
TechCrunch, Wired, The Verge, Ars Technica, MIT Technology Review,
VentureBeat, Search Engine Journal, Search Engine Land,
IEEE Spectrum, New Scientist

TIER 3 — Niche / Community
Blogs, Reddit, Hacker News, X/Twitter, Discord leaks,
arXiv preprints, GitHub trending, independent researchers
```

---

## RSS Sources (No Auth Required)

### AI / LLM

```
https://openai.com/news/rss.xml
https://anthropic.com/news/rss                    -- check current URL
https://deepmind.google/blog/rss/
https://ai.meta.com/blog/rss/
https://blog.google/technology/ai/rss/
https://www.microsoft.com/en-us/research/blog/feed/
https://huggingface.co/blog/feed.xml
https://stability.ai/blog/rss.xml
https://mistral.ai/news/rss/                      -- check current URL
https://www.fast.ai/atom.xml
https://bair.berkeley.edu/blog/feed.xml
https://ai.googleblog.com/feeds/posts/default
```

### VR / AR / Spatial Computing

```
https://www.roadtovr.com/feed/
https://uploadvr.com/feed/
https://www.xrtoday.com/feed/
https://mixed-news.com/en/feed/
https://skarredghost.com/feed/
https://developer.apple.com/news/rss/news.rss     -- developer signals
```

### SEO / Search

```
https://searchengineland.com/feed
https://searchenginejournal.com/feed
https://www.seroundtable.com/feed
https://moz.com/blog/feed
https://ahrefs.com/blog/rss/
https://developers.google.com/search/blog/rss.xml -- official Google search blog
```

### Vibe Coding / Dev Tools

```
https://github.blog/feed/
https://code.visualstudio.com/feed.xml
https://blog.langchain.dev/rss/
https://ollama.ai/blog/rss                        -- check current URL
https://www.cursor.com/blog/rss                   -- check current URL
```

### General Tech (Cross-domain)

```
https://techcrunch.com/feed/
https://www.theverge.com/rss/index.xml
https://arstechnica.com/feed/
https://wired.com/feed/rss
https://thenextweb.com/feed/
https://venturebeat.com/feed/
https://news.ycombinator.com/rss              -- Hacker News top stories
```

### Academic / Research

```
https://arxiv.org/rss/cs.AI
https://arxiv.org/rss/cs.CV
https://arxiv.org/rss/cs.HC
https://arxiv.org/rss/cs.LG
https://arxiv.org/rss/cs.CL
```

### Patents

```
https://patents.google.com/rss?q=artificial+intelligence&assignee=Google
https://patents.google.com/rss?q=spatial+computing&assignee=Apple
https://patents.google.com/rss?q=augmented+reality&assignee=Meta
https://patents.google.com/rss?q=artificial+intelligence&assignee=Microsoft
https://patents.google.com/rss?q=artificial+intelligence&assignee=NVIDIA
```

### YouTube (via RSS — no auth)

```
Format: https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID

Channels to include:
- Andrej Karpathy
- Yannic Kilcher
- Two Minute Papers
- AI Explained
- Fireship (dev tools / vibe coding)
- Sebastian Raschka
- Jeremy Howard / fast.ai
```

---

## Live / Real-Time Sources

### Hacker News (Firebase API — no auth)

```
Polling endpoint: https://hacker-news.firebaseio.com/v0/newstories.json
Item detail:      https://hacker-news.firebaseio.com/v0/item/{id}.json
Algolia search:   https://hn.algolia.com/api/v1/search?query={keyword}&tags=story

Keywords to track:
ai, llm, gpt, claude, gemini, openai, anthropic, mistral,
spatial computing, vision pro, ar glasses, vr headset,
cursor ai, copilot, vibe coding, agentic,
google search, seo, algorithm update, core update

Poll frequency: every 5 minutes
```

### Reddit (PRAW — requires Reddit API account)

```
Subreddits:
r/artificial
r/MachineLearning
r/LocalLLaMA
r/ChatGPT
r/singularity
r/virtualreality
r/augmentedreality
r/OculusQuest
r/SEO
r/bigseo
r/learnmachinelearning
r/vibecoding                     -- may not exist yet, monitor for emergence

Streaming: PRAW stream() on new submissions
Filter: minimum score threshold configurable (default: 50 upvotes before processing)
```

### X / Twitter (Filtered Stream API — requires developer account)

```
Track keywords:
"AI announcement", "LLM release", "model launch",
"spatial computing", "AR glasses", "vision pro",
"vibe coding", "cursor update", "copilot",
"google algorithm", "core update", "SEO",
"openai", "anthropic", "google deepmind",
"nvidia announcement", "microsoft AI"

Track accounts (user lookup, not streaming):
@sama, @OpenAI, @AnthropicAI, @GoogleDeepMind,
@nvidia, @MSFTResearch, @AIatMeta,
@karpathy, @ylecun, @GaryMarcus,
@searchliaison (Google Search official)

Poll accounts: every 10 minutes
Filtered stream: continuous
```

### GitHub (Public API — rate limited without auth, better with token)

```
Trending repositories: https://github.com/trending (scrape or use third-party API)
Release monitoring: Watch specific repos for new releases

Key repos to monitor:
- ollama/ollama
- langchain-ai/langchain
- microsoft/autogen
- openai/openai-python
- anthropics/anthropic-sdk-python
- meta-llama/llama-models
- huggingface/transformers

Stars velocity: sudden spike in stars = emerging signal
```

---

## N8N Workflow Structure

### Workflow 1: RSS Poller (scheduled)

```
Trigger: Schedule (every 15 minutes)
  │
  ├── For each active RSS source in sources table
  │     │
  │     ├── Fetch RSS feed
  │     ├── For each item:
  │     │     ├── Generate URL fingerprint
  │     │     ├── Check Redis dedup cache
  │     │     ├── If new: POST to Python /ingest endpoint
  │     │     └── Add to Redis cache (7-day TTL)
  │     └── Update sources.last_ingested
  └── Log run completion
```

### Workflow 2: HN Monitor (scheduled)

```
Trigger: Schedule (every 5 minutes)
  │
  ├── Fetch top 30 story IDs from Firebase API
  ├── For each story ID not in Redis cache:
  │     ├── Fetch story detail
  │     ├── Check title/URL against keyword list
  │     ├── If keyword match: POST to Python /ingest
  │     └── Add to Redis cache
  └── Log run
```

### Workflow 3: Reddit Monitor (webhook/polling)

```
Trigger: Schedule (every 10 minutes) or PRAW webhook
  │
  ├── For each monitored subreddit:
  │     ├── Fetch new posts since last check
  │     ├── Filter: score > threshold OR keyword match
  │     ├── For qualifying posts:
  │     │     ├── Check Redis dedup
  │     │     ├── POST to Python /ingest
  │     │     └── Cache URL
  │     └── Update last_checked timestamp
  └── Log run
```

### Workflow 4: Alert Monitor (triggered)

```
Trigger: Python service POSTs webhook when importance_composite > 8.0
  │
  ├── Receive alert candidate data
  ├── Run corroboration check (query signals table for related signals)
  ├── Update alert_candidates table
  ├── If reality_check_passed:
  │     ├── Create content pack (type: alert)
  │     └── Send dashboard notification
  └── Log alert event
```

### Workflow 5: Publishing (triggered on approval)

```
Trigger: Operator approves content pack in HiveDeck
  │
  ├── For each approved content_draft:
  │     ├── instagram  → Meta Graph API
  │     ├── facebook   → Meta Graph API
  │     ├── linkedin   → LinkedIn API
  │     ├── x          → Twitter API v2
  │     ├── blog       → Next.js API route (publishes to site)
  │     └── newsletter → (future: Resend / Mailchimp API)
  │
  ├── Call Python /hivecast endpoint with approved script
  │     └── Python calls HeyGen API → returns video URL async
  │
  ├── Update content_drafts.published_at and published_url
  ├── Update content_packs.published_at
  ├── Trigger RSS feed regeneration
  └── Send HiveAPI webhook notifications to subscribers
```

### Workflow 6: Monthly Report (scheduled)

```
Trigger: Schedule (1st of month, 04:00 GMT — gives time before 08:00 release)
  │
  ├── Query all signals, outcomes, pack stats for previous month
  ├── POST to Python /monthly-synthesis endpoint
  ├── Python runs extended Claude synthesis (full context)
  ├── Draft returned → staged in HiveDeck as monthly_report pack
  ├── Operator notification: "Monthly report ready for review"
  └── Operator reviews, approves, publishing workflow handles release at 08:00
```

---

## Accounts Required

```
MUST CREATE / CONFIGURE
□ Reddit API app (reddit.com/prefs/apps)
□ X/Twitter Developer account + Filtered Stream access
□ GitHub personal access token (for higher rate limits)
□ Meta Developer account
□ Facebook Page (for Meta Graph API publishing)
□ Instagram Business Account (linked to Facebook Page)
□ LinkedIn Company Page + API access application
□ YouTube channel + Google API credentials
□ NewsAPI.org account (free tier to start)

OPTIONAL BUT RECOMMENDED
□ Diffbot account (replaces many RSS feeds, ~$200/month)
□ Bluesky account (growing AI community, open AT Protocol API)
□ Google Alerts (email digest → N8N email receiver)
```

---

## Signal Deduplication Strategy

Not deduplication in the content sense — the platform intentionally combines multiple perspectives on the same story. Deduplication here means: **do not ingest the same URL twice**.

```
DEDUP LOGIC
1. Generate fingerprint: SHA256(normalised_url)
   Normalise: strip utm params, trailing slashes, www prefix
2. Check Redis SET: "dedup:{fingerprint}"
3. If exists → skip
4. If not → ingest + SET with 7-day TTL

SAME STORY, DIFFERENT SOURCES = BOTH INGESTED
This is intentional. Multiple sources on the same story:
- Increases corroboration count
- Enriches the cluster with different angles
- Improves importance scoring accuracy
- Feeds the cross-source synthesis
```

---

## Processing Queue (Redis / BullMQ)

```
Queues:
  ingest          Priority: normal, concurrency: 5
  embed           Priority: normal, concurrency: 3
  score           Priority: normal, concurrency: 3
  alert_check     Priority: high, concurrency: 1
  draft           Priority: normal, concurrency: 2
  publish         Priority: high, concurrency: 1
  hivecast        Priority: normal, concurrency: 1

Failed jobs: retry 3 times with exponential backoff
Dead letter: stored for manual inspection
```
