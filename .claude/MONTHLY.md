# NewsHive — Monthly HiveReport

---

## Overview

The HiveReport is NewsHive's flagship content piece. Released on the 1st of every month at 08:00 GMT. It is where the database pays its biggest dividend — 30 days of signals, outcomes, trajectories, and published takes, synthesised into the most comprehensive intelligence briefing available in the covered domains.

It is not a summary of the news. It is an audit of the landscape, an honest reckoning with our own calls, and a forward look at where things are heading.

---

## Release Schedule

```
28th of month   DB query runs — pulls all data for the month
29th of month   Claude synthesis generates full draft
30th of month   Operator review day (longer than usual — this deserves it)
31st of month   Production day — HiveCast video, social teasers, staging
1st at 08:00    Simultaneous release across all channels
```

---

## Report Structure

### Section 1 — The Month in Numbers

```
Signals ingested this month:      [N]
HiveAlerts fired:                 [N] confirmed / [N] developing / [N] pinch of salt
Pinch of Salt issued:             [N]
  → Confirmed true:               [N] ([%])
  → Did not materialise:          [N] ([%])
  → Still developing:             [N] ([%])
Content packs published:          [N]
HiveCasts produced:               [N]
New anonymous sources:            [N]
Sources upgraded in tier:         [N]

Running all-time accuracy:        [%] confirmed from [N] resolved signals
All-time average lead time:       [N] days ahead of mainstream confirmation
```

### Section 2 — Domain by Domain

One section per active domain. Structure for each:

```
[DOMAIN NAME]

Activity level this month: HIGH / MEDIUM / LOW / QUIET

What moved:
[2-3 paragraphs on the significant developments,
written in the NewsHive voice — not a list of headlines
but a coherent narrative of what shifted and why it matters]

What didn't move (and why that's interesting):
[What people expected that didn't happen.
Silence is sometimes a signal.]

Surprise of the month:
[One thing that was unexpected. What it tells us.]
```

### Section 3 — The Calls We Made

The honest scorecard. This section is non-negotiable. Misses appear alongside hits.

```
[MONTH] TRAJECTORY CALLS — OUTCOME

✅ CORRECT
  We said: [exact claim, with date]
  What happened: [what actually occurred, with date]
  Days ahead of mainstream press: [N]
  Notes: [brief reflection — what we read correctly]

❌ WRONG
  We said: [exact claim, with date]
  What happened: [what actually occurred]
  Notes: [honest assessment of what we misread]
  What we're revising: [how this changes our model]

⚠️ PARTIALLY CORRECT
  We said: [exact claim]
  What happened: [closer to X than Y]
  Notes: [directionally right, specifically wrong — what we got right, what we missed]

⏳ STILL DEVELOPING
  We said: [exact claim, with date]
  Status: [current state of play]
  Still watching: [what would confirm or kill this]

Running accuracy this month: [N]% ([N] correct / [N] wrong / [N] partial)
Running accuracy all-time:   [N]% across [N] resolved trajectory calls
```

### Section 4 — Trajectory Updates

Each active named theory — a status report.

```
TRAJECTORY: [Name]
First published: [date]
Current confidence: [score]/10 ([direction]: rising/falling/stable)
Status: [ACTIVE / CONFIRMED / ABANDONED / SUPERSEDED]

This month's update:
[1-2 paragraphs on what happened this month that bears on this theory.
Was the direction confirmed? Complicated? Contradicted?]

Revised outlook:
[If confidence changed — why. If unchanged — why.]

What would confirm this:
[Specific observable event]

What would kill this:
[Specific contradicting event]
```

### Section 5 — Signal of the Month

The single most significant development. Full treatment.

```
[Title]

[3-5 paragraphs. Full analysis. Your strongest take.
This is the piece of the report that gets shared, quoted, cited.
Pull no punches. Have an actual view.
Cross-reference to historical signals in the DB.
Where does this fit in the longer arc?]

Historical context: [pull from DB — related signals over past months]
Trajectory impact: [which named theories does this affect and how]
What to watch next: [2-3 specific follow-on signals]
```

### Section 6 — What We're Watching in [Next Month]

Three to five specific, named, falsifiable things to monitor.

```
1. [SPECIFIC THING]
   Domain: [domain]
   Why: [why this matters, what it would tell us]
   If it happens: [implication]
   If it doesn't: [what absence means]
   Timeframe: [when we'd expect to see it if it's real]

[Repeat for each item]
```

### Section 7 — Pinch of Salt Watch

Status update on all outstanding unverified signals.

```
CONFIRMED THIS MONTH
  🧂→✅ [Summary of signal]
       Called: [date]
       Confirmed: [date and by whom]
       Days ahead: [N]
       Source tier at time: [tier]
       Source tier now: [tier — if upgraded]

STILL DEVELOPING
  🧂→⏳ [Summary of signal]
       Called: [date]
       Latest: [what has developed, if anything]
       Still watching: [what would resolve this]

DID NOT MATERIALISE (closing after 90 days)
  🧂→❌ [Summary of signal]
       Called: [date]
       Closing: no corroboration after [N] days
       Reflection: [brief — what generated the false signal]

NEW THIS MONTH
  🧂 [Summary of new pinch of salt signals issued this month]
```

---

## HiveCast — Monthly Version

The monthly HiveCast is longer and more formal than the daily/weekly.

```
FULL VERSION — 15-20 minutes
  YouTube Premiere (scheduled 48 hours ahead — builds anticipation)
  Chapters marked for each section
  Same structure as report, spoken word

HIGHLIGHT CUT — 3 minutes
  Signal of the Month + most significant trajectory update
  Instagram / LinkedIn / Reels
  "Full HiveReport linked below"

TEASER CLIP — 30-45 seconds
  One killer line from the report
  Posted 24 hours before release
  "Tomorrow. The March HiveReport."
```

---

## Distribution on Release Day

All of the following go live simultaneously at 08:00 GMT on the 1st:

```
Blog post          → newshive.geekybee.net/reports/[month]-[year]
YouTube            → Full HiveCast premieres
LinkedIn           → Long-form extract (Signal of the Month)
Instagram          → Teaser visual + highlight clip
Facebook           → Conversational summary + link
X                  → Thread: top 5 takeaways + link
Newsletter         → Full digest with links to all formats
HiveFeed RSS       → New entry: full report content
HiveAPI            → Webhook to all Pro/Enterprise subscribers
```

---

## Synthesis Prompt

Passed to Claude on the 29th of the month with full DB context.

```
You are generating the monthly HiveReport for NewsHive — our flagship
intelligence briefing released on the 1st of every month.

This report covers [MONTH] [YEAR].

You have access to:
- All signals ingested this month: {signal_count} signals
- All content packs published: {pack_summaries}
- All Pinch of Salt outcomes: {pos_outcomes}
- All trajectory updates: {trajectory_data}
- Previous month's HiveReport: {previous_report}
- All-time accuracy statistics: {accuracy_stats}

NewsHive voice guide applies throughout. This is our strongest content.
It should read as a genuine intelligence briefing — not a summary,
not a list, but a coherent analytical narrative with an honest scorecard
and clear forward-looking positions.

The honest scorecard (Section 3) must include every call made this month —
correct, wrong, and partial. Do not omit misses.

Generate the full report following the seven-section structure.
Length: 2500-3500 words.

Return as structured JSON with each section as a separate field,
content in markdown format ready for blog rendering.
```

---

## Operator Review Checklist

Before approving the monthly report for publication:

```
□ All trajectory calls accounted for — none omitted
□ Misses presented fairly — not buried or minimised
□ Signal of the Month is genuinely the most significant
□ Watching items are specific and falsifiable
□ Pinch of Salt watch is complete and up to date
□ Numbers in Section 1 match DB actuals
□ Voice is consistent throughout — feels authored, not generated
□ HiveCast script reviewed and sounds natural when read aloud
□ All social teasers reviewed and approved
□ YouTube premiere scheduled for 08:00 GMT on 1st
□ Newsletter reviewed
□ RSS entry prepared
```
