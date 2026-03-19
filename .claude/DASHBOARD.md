# NewsHive — HiveDeck (Operator Dashboard)

---

## Overview

HiveDeck is the internal control interface for the NewsHive operator. It is the single place where human judgement enters the system. Everything else is automated. HiveDeck is where you review, approve, edit, and publish.

Authentication: Single operator. Password + TOTP (two-factor). No public registration.

---

## Dashboard Sections

### 1. Home — Live Overview

```
┌─────────────────────────────────────────────────────────────┐
│  NEWSHIVE HIVEDECK                          19 March 2026   │
├─────────────────────────────────────────────────────────────┤
│  PENDING ATTENTION                                          │
│  ⚡ 1 ALERT CANDIDATE — Breaking, AI domain               │
│  📦 2 CONTENT PACKS — Ready for review                    │
│  🧂 1 HONEYPOT SUBMISSION — New, SCOUT-7734               │
│  📊 Monthly report due in 13 days                          │
├─────────────────────────────────────────────────────────────┤
│  TODAY'S ACTIVITY                                           │
│  Signals ingested:    247                                   │
│  Clusters active:     12                                    │
│  Alerts fired:        0                                     │
│  Posts published:     3                                     │
├─────────────────────────────────────────────────────────────┤
│  PLATFORM ACCURACY (all-time)                               │
│  Pinch of Salt confirmed: 71% from 89 resolved             │
│  Avg lead time:           17 days                          │
│  Trajectory calls right:  68% from 47 resolved             │
├─────────────────────────────────────────────────────────────┤
│  CLUSTER READINESS                                          │
│  AI + Search convergence     ████████░░  82/100  READY     │
│  Spatial computing           ██████░░░░  61/100            │
│  Vibe coding tools           ████░░░░░░  43/100            │
│  EU AI regulation            ███░░░░░░░  31/100            │
└─────────────────────────────────────────────────────────────┘
```

---

### 2. Content Packs — Review Queue

The core workflow. One content pack contains all platform drafts.

```
┌─────────────────────────────────────────────────────────────┐
│  CONTENT PACK — AI + Search Convergence                     │
│  Type: Standard    Confidence: DEVELOPING    Domains: AI/SEO│
│  Triggered: readiness threshold (82/100)                    │
│  Signals: 23 signals across 8 sources                       │
│  Pack age: 2 hours                                          │
├──────────────┬──────────────────────────────────────────────┤
│  PLATFORMS   │  DRAFTS                                      │
├──────────────┼──────────────────────────────────────────────┤
│  ✓ Blog      │  [REVIEW DRAFT]  [EDIT]  [APPROVE]          │
│  ✓ LinkedIn  │  [REVIEW DRAFT]  [EDIT]  [APPROVE]          │
│  ✓ Instagram │  [REVIEW DRAFT]  [EDIT]  [APPROVE]          │
│  ✓ Facebook  │  [REVIEW DRAFT]  [EDIT]  [APPROVE]          │
│  ✓ X/Twitter │  [REVIEW DRAFT]  [EDIT]  [APPROVE]          │
│  ✓ HiveCast  │  [REVIEW SCRIPT] [EDIT]  [APPROVE]          │
├──────────────┴──────────────────────────────────────────────┤
│  [APPROVE ALL]  [REQUEST REDRAFT]  [DISCARD PACK]           │
└─────────────────────────────────────────────────────────────┘
```

#### Draft Review View

When operator clicks [REVIEW DRAFT] for a platform:

```
┌─────────────────────────────────────────────────────────────┐
│  LINKEDIN DRAFT — AI + Search Convergence                   │
│  Confidence: DEVELOPING    Word count: 487                  │
├─────────────────────────────────────────────────────────────┤
│  [Draft text displayed here — full, formatted]              │
│                                                             │
│  There's a shift underway in how AI and search are          │
│  converging that most practitioners haven't fully           │
│  absorbed yet...                                            │
│                                                             │
│  [continues...]                                             │
├─────────────────────────────────────────────────────────────┤
│  SIGNALS THAT FED THIS DRAFT                                │
│  • TechCrunch: "Google's AI Mode expands..." (Tier 2)      │
│  • arXiv: "RAG architectures in search..." (Tier 2)        │
│  • HN: "I've noticed my SEO traffic..." (Tier 3, 847 pts)  │
│  • [+ 20 more signals]                                      │
├─────────────────────────────────────────────────────────────┤
│  RELATED TRAJECTORIES                                       │
│  • "Search becomes AI-mediated" — Confidence 7.2/10 ↑     │
├─────────────────────────────────────────────────────────────┤
│  [APPROVE AS-IS]  [EDIT AND APPROVE]  [REDRAFT]  [SKIP]    │
└─────────────────────────────────────────────────────────────┘
```

---

### 3. Alert Queue

High-priority — appears as banner notification and dedicated section.

```
┌─────────────────────────────────────────────────────────────┐
│  ⚡ ALERT CANDIDATE — ACTION REQUIRED                       │
│                                                             │
│  Title:      Google confirms deprecation enforcement        │
│  Domain:     SEO, advertising                               │
│  Alert tier: BREAKING                                       │
│  Confidence: CONFIRMED                                      │
│                                                             │
│  SCORING                                                    │
│  Magnitude:       9.0    Irreversibility: 8.5              │
│  Blast radius:    8.0    Velocity:        9.5              │
│  Composite:       8.8    Reality check:  ✅ PASSED          │
│                                                             │
│  CORROBORATION                                              │
│  Sources: 5 independent    Tier 1: 2 (Reuters, BBC)        │
│  Too good to be true: NO                                    │
│                                                             │
│  DRAFT READY                                                │
│  All platform drafts generated. Audiogram ready.           │
│  HiveCast script ready. Full video can queue immediately.  │
│                                                             │
│  [REVIEW DRAFTS AND APPROVE]  [DOWNGRADE TO SIGNIFICANT]   │
│  [DOWNGRADE TO PINCH OF SALT]  [DISMISS]                   │
└─────────────────────────────────────────────────────────────┘
```

---

### 4. Honeypot Submissions

```
┌─────────────────────────────────────────────────────────────┐
│  HONEYPOT SUBMISSIONS                          3 pending    │
├─────────────────────────────────────────────────────────────┤
│  [NEW] SCOUT-7734                                           │
│  Received: 19 Mar 2026 14:23    ◕ CREDIBLE (tier 2)        │
│  Initial verdict: reliable      Submissions: 6, 80% acc    │
│  Corroboration: loose (1 signal, 3 days gap)               │
│  Routing rec: 🧂 PINCH OF SALT                              │
│  [REVIEW CONTENT] [APPROVE → POS] [HOLD] [DISCARD]        │
├─────────────────────────────────────────────────────────────┤
│  [NEW] DRONE-0182                                           │
│  Received: 19 Mar 2026 11:47    ◯ NEW SOURCE               │
│  Initial verdict: indefinite    Submissions: 1, no history │
│  Corroboration: none                                        │
│  Routing rec: 🧂 PINCH OF SALT (low confidence framing)    │
│  [REVIEW CONTENT] [APPROVE → POS] [HOLD] [DISCARD]        │
├─────────────────────────────────────────────────────────────┤
│  [HELD] SCOUT-3341                                          │
│  Received: 17 Mar 2026 09:12    ◯ NEW SOURCE               │
│  Initial verdict: illegitimate  Monitoring: no dev yet     │
│  [REVIEW CONTENT] [RELEASE TO POS] [CLOSE]                 │
└─────────────────────────────────────────────────────────────┘
```

#### Content Review View (Honeypot)

```
┌─────────────────────────────────────────────────────────────┐
│  SUBMISSION — SCOUT-7734                                    │
│  ⚠️  Content decrypted for this session only               │
├─────────────────────────────────────────────────────────────┤
│  SUBMISSION CONTENT                                         │
│  [Decrypted content displayed here]                         │
│                                                             │
│  "I work adjacent to the semiconductor supply chain.        │
│   There is significant movement around..."                  │
├─────────────────────────────────────────────────────────────┤
│  SOURCE HISTORY                                             │
│  Submission 1: Pinch of Salt → ✅ CONFIRMED (21 days)      │
│  Submission 2: Pinch of Salt → ✅ CONFIRMED (14 days)      │
│  Submission 3: Pinch of Salt → ✅ CONFIRMED (31 days)      │
│  Submission 4: Pinch of Salt → ❌ WRONG                    │
│  Submission 5: Pinch of Salt → ✅ CONFIRMED (18 days)      │
│  Submission 6: THIS SUBMISSION                              │
├─────────────────────────────────────────────────────────────┤
│  CORROBORATING SIGNAL (loose window)                        │
│  Source: TechCrunch (Tier 2)                               │
│  Title: "Supply chain shifts signal..."                     │
│  Published: 3 days before this submission                   │
├─────────────────────────────────────────────────────────────┤
│  [APPROVE → PINCH OF SALT]  [APPROVE → DEVELOPING]         │
│  [HOLD INTERNALLY]          [DISCARD]                       │
│  [PURGE CONTENT AFTER PROCESSING]  ☐                       │
└─────────────────────────────────────────────────────────────┘
```

---

### 5. Pinch of Salt Watch

Overview of all outstanding unverified signals.

```
┌─────────────────────────────────────────────────────────────┐
│  PINCH OF SALT WATCH                      12 active signals │
├────────────┬────────────────┬───────────┬───────────────────┤
│ Domain     │ Summary        │ Age       │ Status            │
├────────────┼────────────────┼───────────┼───────────────────┤
│ AI         │ Major model... │ 8 days    │ 🟡 DEVELOPING     │
│ VR/AR      │ Spatial OS ... │ 23 days   │ 👁 WATCHING       │
│ SEO        │ Algorithm ...  │ 41 days   │ 👁 WATCHING       │
│ AI         │ Merger rumour  │ 67 days   │ ⚠️ AGEING         │
│ VIBE       │ Tool acquis... │ 89 days   │ 🔴 STALE SOON     │
└────────────┴────────────────┴───────────┴───────────────────┘
│ [UPDATE OUTCOMES] [MARK CONFIRMED] [MARK WRONG] [EXTEND]    │
└─────────────────────────────────────────────────────────────┘
```

---

### 6. Trajectories

```
┌─────────────────────────────────────────────────────────────┐
│  ACTIVE TRAJECTORIES                                        │
├─────────────────────────────────────────────────────────────┤
│  "Search becomes AI-mediated"                               │
│  Confidence: 7.2/10 ↑    Domain: AI/SEO    Status: ACTIVE  │
│  Last updated: 14 Mar 2026                                  │
│  [VIEW FULL] [UPDATE CONFIDENCE] [ADD EVIDENCE] [CLOSE]    │
├─────────────────────────────────────────────────────────────┤
│  "AR adoption before VR at enterprise scale"                │
│  Confidence: 6.1/10 →    Domain: VR/AR     Status: ACTIVE  │
│  Last updated: 1 Mar 2026 (monthly update)                  │
│  [VIEW FULL] [UPDATE CONFIDENCE] [ADD EVIDENCE] [CLOSE]    │
├─────────────────────────────────────────────────────────────┤
│  [+ ADD NEW TRAJECTORY]                                     │
└─────────────────────────────────────────────────────────────┘
```

---

### 7. Source Tokens

Read-only overview of anonymous source track records.

```
┌─────────────────────────────────────────────────────────────┐
│  ANONYMOUS SOURCES                    14 tokens registered  │
├──────────────┬───────┬──────────┬──────────┬───────────────┤
│ Token        │ Tier  │ Accuracy │ Subs     │ Last          │
├──────────────┼───────┼──────────┼──────────┼───────────────┤
│ SCOUT-7734   │ ◕ 2   │ 80%      │ 6 (5 res)│ Today         │
│ DRONE-3341   │ ● 3   │ 87%      │ 12(11 r) │ 2 weeks ago   │
│ SCOUT-0182   │ ◑ 1   │ 50%      │ 4 (2 res)│ 1 month ago   │
│ DRONE-9047   │ ◯ 0   │ —        │ 1 (0 res)│ 3 months ago  │
└──────────────┴───────┴──────────┴──────────┴───────────────┘
```

No ability to view submission content from this screen — only outcomes and tier data.

---

### 8. Monthly Report — Prep View

Available from the 28th of each month.

```
┌─────────────────────────────────────────────────────────────┐
│  HIVEREPORT — MARCH 2026                                    │
│  Release: Tuesday 1 April 2026 at 08:00 GMT                 │
│  Status: DRAFT GENERATED — PENDING REVIEW                   │
├─────────────────────────────────────────────────────────────┤
│  MONTH STATISTICS (auto-populated)                          │
│  Signals ingested:        4,847                             │
│  Content packs published: 23                                │
│  Alerts:  3 confirmed / 2 pinch of salt                     │
│  POS issued: 14  →  confirmed: 9  wrong: 2  developing: 3   │
│  Accuracy this month: 81%   All-time: 71%                   │
├─────────────────────────────────────────────────────────────┤
│  REVIEW SECTIONS                                            │
│  ✓ Section 1: Numbers           [REVIEW]                    │
│  ✗ Section 2: Domain roundup    [REVIEW]  ← needs attention │
│  ✗ Section 3: Honest scorecard  [REVIEW]  ← needs attention │
│  ✓ Section 4: Trajectories      [REVIEW]                    │
│  ✓ Section 5: Signal of month   [REVIEW]                    │
│  ✗ Section 6: What to watch     [REVIEW]                    │
│  ✓ Section 7: POS watch         [REVIEW]                    │
│  ○ HiveCast script              [REVIEW] ← not yet approved │
├─────────────────────────────────────────────────────────────┤
│  [GENERATE HIVECAST VIDEO]  [SCHEDULE RELEASE]              │
│  [PREVIEW BLOG POST]        [PREVIEW NEWSLETTER]            │
└─────────────────────────────────────────────────────────────┘
```
