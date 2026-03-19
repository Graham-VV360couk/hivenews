# NewsHive — Source System & The Honeypot

---

## Philosophy

Nobody is turned away. Nobody is permanently dismissed. The track record is the only currency that matters. The truth has a way of proving itself over time — we build systems that let it do that.

---

## Source Token System

### Token Generation

Every Honeypot submitter receives a token on first submission. Tokens are:

- Generated randomly — no meaning in the identifier
- Shown once to the submitter at submission time
- Their responsibility to retain if they wish to submit again
- The only link between their submissions in our system

```
Token format: PREFIX-NNNN
Prefixes: SCOUT (assigned ~50% of time) or DRONE (assigned ~50%)
Number: random 4-digit, not sequential

Examples: SCOUT-7734, DRONE-3341, SCOUT-0182, DRONE-9047

Prefix assignment is random. It carries no meaning or signal.
This prevents any inference about submission order or volume.
```

### What Is Stored Against a Token

```
STORED
  token                 TEXT        e.g. SCOUT-7734
  initial_verdict       TEXT        reliable/indefinite/illegitimate
  verdict_at            TIMESTAMP   when verdict was made
  submission_count      INTEGER     how many times they've submitted
  confirmed_correct     INTEGER     outcomes only
  confirmed_wrong       INTEGER     outcomes only
  partially_correct     INTEGER     outcomes only
  still_developing      INTEGER     outcomes only
  accuracy_rate         DECIMAL     recalculated on each outcome
  lead_time_avg_days    DECIMAL     recalculated on each outcome
  current_tier          INTEGER     0-4, moves automatically
  tier_updated_at       TIMESTAMP
  created_at            TIMESTAMP
  last_submission_at    TIMESTAMP

NEVER STORED
  Questionnaire answers
  Sector or domain claimed
  Proximity claimed
  Confidence level stated
  Anything written about themselves
  IP address
  Browser fingerprint
  Timezone
  Any metadata that could identify them
```

---

## The One-Time Verdict

Claude assesses the contextual questionnaire answers once. After returning the verdict, the inputs are destroyed. The verdict is the only output retained.

### The Questionnaire

Presented on the Honeypot submission form. Framed as "help us understand the context of your submission" — sources are not told their answers are being assessed for a verdict.

```
Q1. How close are you to this information?
    □ I work directly in this area
    □ I work adjacent to this area  
    □ I heard this from someone who does
    □ I observed this indirectly

Q2. How have you come to know this?
    □ Direct professional involvement
    □ Internal communications I have seen
    □ Industry contacts I trust
    □ Pattern I have observed over time
    □ Document or data I have access to

Q3. How confident are you in this information?
    □ Certain — I was directly involved
    □ High — I witnessed it firsthand
    □ Medium — from a trusted colleague
    □ Low — a pattern I am reading

Q4. What broad sector are you in?
    □ Engineering or technical
    □ Business or commercial
    □ Research or academic
    □ Investment or financial
    □ Government or regulatory
    □ Media or analyst
    □ Other

Q5. Have you submitted to NewsHive before?
    □ Yes — my token is: [text input]
    □ No
```

### Claude Verdict Prompt

```
You are assessing the credibility of an anonymous source submitting to NewsHive,
a technology intelligence platform. You will read their contextual answers and
the content of their submission. You will return a single verdict.

You are assessing PLAUSIBILITY OF CONTEXT, not identity.
You will never know who this person is. That is intentional.

Assess:
1. Internal coherence — do their answers make sense together?
2. Plausible proximity — does their claimed closeness fit the submission content?
3. Submission quality — is the content coherent, specific, and plausible?
4. Red flags — signs of fabrication, testing, or manipulation?

Questionnaire answers:
{answers}

Submission content:
{content}

Return JSON only — no explanation, no preamble:
{"verdict": "reliable" | "indefinite" | "illegitimate"}

Verdict definitions:
reliable     Internal coherence strong, plausible proximity, quality content, no red flags
indefinite   Vague or ambiguous, could be genuine, insufficient to judge, treat with caution
illegitimate Incoherent, implausible, appears fabricated or adversarial

After returning this JSON, all questionnaire inputs will be deleted.
Your verdict is the only thing retained.
```

### After the Verdict

```python
def process_submission(questionnaire_answers, content, token_id):
    # Get Claude verdict
    verdict = claude_one_time_verdict(questionnaire_answers, content)

    # Store verdict against token
    update_token(token_id, initial_verdict=verdict)

    # IMMEDIATELY delete questionnaire answers
    del questionnaire_answers
    # Ensure nothing is logged, cached, or stored

    # Process content regardless of verdict
    route_submission(content, token_id, verdict)

def route_submission(content, token_id, verdict):
    # Run instant corroboration check
    corroboration = check_instant_corroboration(content)

    if corroboration['found'] and corroboration['window'] == 'tight':
        # Strong independent corroboration — elevate
        enter_queue(content, token_id, confidence='developing')
    elif corroboration['found']:
        # Weak corroboration — Pinch of Salt with note
        enter_queue(content, token_id, confidence='pinch_of_salt')
    else:
        # No corroboration — Pinch of Salt standard
        if content_is_coherent(content):
            enter_queue(content, token_id, confidence='pinch_of_salt')
        else:
            # Incoherent content — hold internally, never publish
            hold_internally(content, token_id)
            # Still monitor: does any part of this ever come true?
```

---

## Source Tier Progression

```
TIER 0 — New / Unproven
No track record. All submissions enter Pinch of Salt.
Dashboard shows: ◯ NEW SOURCE

TIER 1 — Emerging  
2+ resolved submissions, accuracy >= 40%
Dashboard shows: ◑ EMERGING SOURCE

TIER 2 — Credible
4+ resolved submissions, accuracy >= 60%
Dashboard shows: ◕ CREDIBLE SOURCE
Submissions can influence alert scoring

TIER 3 — Reliable
7+ resolved submissions, accuracy >= 70%
Dashboard shows: ● RELIABLE SOURCE
Submissions weighted significantly in alert detection

TIER 4 — Exemplary
10+ resolved submissions, accuracy >= 80%
Dashboard shows: ★ EXEMPLARY SOURCE
"Source with verified track record" in published content
```

### Tier Movement Rules

```
Automatic upgrade review triggered by:
  - 3 consecutive confirmed submissions → +1 tier consideration
  - Accuracy crosses tier threshold at minimum submission count
  - Initial illegitimate verdict + 4 confirmed → flag for operator review

Automatic downgrade review triggered by:
  - 3 consecutive wrong submissions → -1 tier consideration
  - Accuracy drops >15% over rolling 90 days (minimum 5 resolved)

Protection:
  - No source ever removed from system
  - No source ever permanently penalised
  - Initial verdict becomes statistically irrelevant after 5 resolved submissions
  - Tier can always recover through accurate submissions
```

---

## Returning Submitter Flow

```
1. Source returns to Honeypot
2. Selects "Yes, I have submitted before"
3. Enters their token: SCOUT-7734
4. System retrieves track record:
   - Submission count
   - Confirmed / wrong / partial / developing
   - Current tier
   - Accuracy rate
5. NEW questionnaire answers assessed by Claude (same process)
6. New verdict generated (may differ from initial)
7. New verdict NOT stored — initial_verdict remains as historical record
   Track record speaks louder than any verdict
8. Submission processed as normal
9. Dashboard shows returning source with full track record
```

---

## Dashboard View Per Submission

```
┌─────────────────────────────────────────────────────┐
│  HONEYPOT SUBMISSION                                │
│                                                     │
│  Token:    SCOUT-7734           ◕ CREDIBLE SOURCE   │
│  Submitted: 19 March 2026 14:23                     │
│                                                     │
│  TRACK RECORD                                       │
│  Submissions:        6                              │
│  Resolved:           5                              │
│  Confirmed correct:  4    (80%)                     │
│  Wrong:              1    (20%)                     │
│  Developing:         1                              │
│  Avg lead time:      18 days                        │
│                                                     │
│  Initial verdict (historical): illegitimate         │
│  Current tier: 2 — CREDIBLE                         │
│                                                     │
│  CORROBORATION CHECK                                │
│  Related signals found: 1 (loose window — 3 days)   │
│  Corroborating source: TechCrunch (Tier 2)          │
│                                                     │
│  ROUTING RECOMMENDATION                             │
│  🧂 PINCH OF SALT                                   │
│  Elevate to DEVELOPING if 1+ more signals emerge    │
│                                                     │
│  SUBMISSION CONTENT                                 │
│  [decrypted content displayed here]                 │
│                                                     │
│  [APPROVE FOR PINCH OF SALT]  [HOLD INTERNALLY]    │
│  [ELEVATE TO DEVELOPING]      [DISCARD]             │
└─────────────────────────────────────────────────────┘
```

---

## Published Attribution Language

How submissions appear in published content, by tier:

```
TIER 0 (New):
"We are picking up an unverified signal that..."
"An early and unverified source suggests..."

TIER 1 (Emerging):
"A source with a developing track record suggests..."

TIER 2 (Credible):
"A source who has previously provided accurate intelligence suggests..."

TIER 3 (Reliable):
"A source with a strong accuracy track record in this domain suggests..."

TIER 4 (Exemplary):
"One of our most consistently accurate anonymous sources
 — with a track record we have observed over [timeframe] —
 suggests that..."

NEVER published:
- The token identifier
- The initial verdict
- Any contextual information about the source
- Any language that could narrow the field of who this might be
```

---

## The Honeypot — Technical Implementation

See `SECURE_SUBMISSION.md` for full technical specification.

Summary:
- Tor hidden service — source IP never reaches main server
- No server-side IP logging at any layer
- No cookies, no fingerprinting, no timing attacks
- Questionnaire served and answered over same anonymous channel
- Content encrypted at rest (AES-256) in submissions table
- Content can be purged after processing if operator chooses
- Token generated client-side, transmitted with submission, stored server-side
- Token shown once at confirmation screen — not stored in browser
