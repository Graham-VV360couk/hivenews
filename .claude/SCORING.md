# NewsHive — Scoring Systems

---

## 1. Importance Scoring

Every signal is scored across four axes. This determines whether it becomes an alert candidate.

### The Four Axes

```
MAGNITUDE (0-10)
How significant is the change from the previous state?
0-2   Incremental update, minor release, routine announcement
3-4   Meaningful development, notable but expected
5-6   Significant shift, affects practitioners
7-8   Major development, affects entire domain
9-10  Fundamental change, resets the baseline

IRREVERSIBILITY (0-10)
Can this be undone, or does it permanently shift the landscape?
0-2   Easily reversed, trial/beta, announcement only
3-4   Reversible with effort, significant switching cost
5-6   Difficult to reverse, ecosystem momentum builds
7-8   Practically irreversible, network effects lock in
9-10  Permanent — legal, physical, or market reality changed

BLAST RADIUS (0-10)
How many adjacent domains and people does this affect?
0-2   Niche only, single tool or company
3-4   One domain, significant subset of practitioners
5-6   Multiple domains, affects many practitioners
7-8   Cross-domain, affects adjacent industries
9-10  Platform-level, affects everyone in tech landscape

VELOCITY (0-10)
How fast is this moving? How quickly must people adapt?
0-2   Slow burn, years to play out
3-4   Months to meaningful impact
5-6   Weeks to impact, practitioners should prepare
7-8   Days to impact, immediate attention warranted
9-10  Now — happening in real time, act immediately
```

### Composite Score Calculation

```python
def calculate_importance_composite(magnitude, irreversibility, blast_radius, velocity):
    # Weighted composite
    composite = (
        magnitude       * 0.35 +
        irreversibility * 0.25 +
        blast_radius    * 0.25 +
        velocity        * 0.15
    )
    return round(composite, 1)

# Thresholds
ALERT_CANDIDATE_THRESHOLD = 8.0   # composite must exceed this
WATCH_THRESHOLD           = 6.0   # added to cluster watch list
STANDARD_THRESHOLD        = 0.0   # everything below alert goes to cluster
```

### Scoring is performed by Claude

Pass the signal title, content, domain context, and current cluster state to Claude with this prompt structure:

```
You are scoring a technology signal for NewsHive, an intelligence platform
covering AI, VR/AR, Vibe Coding, and SEO.

Score this signal on four axes from 0-10:

MAGNITUDE: How significant is the change from the previous state?
IRREVERSIBILITY: Can this be undone, or does it permanently shift the landscape?
BLAST RADIUS: How many adjacent domains and people does this affect?
VELOCITY: How fast is this moving? How quickly must people adapt?

Signal:
Title: {title}
Content: {content}
Source: {source_name} (Tier {source_tier})
Domain: {domain_tags}

Return JSON only:
{"magnitude": X, "irreversibility": X, "blast_radius": X, "velocity": X, "reasoning": "brief explanation"}
```

---

## 2. Reality Check Pipeline

Runs on every alert candidate (composite > 8.0).

```python
def reality_check(signal, cluster, recent_signals):

    checks = {}

    # Check 1: Source credibility
    checks['source_tier'] = signal.source.tier
    checks['source_tier_passed'] = signal.source.tier <= 2

    # Check 2: Corroboration
    related = find_corroborating_signals(signal, recent_signals, hours=24)
    checks['corroboration_count'] = len(related)
    checks['corroboration_passed'] = len(related) >= 2

    # Check 3: Too good to be true
    checks['too_good_to_be_true'] = (
        signal.magnitude_score > 9.5 and
        len(related) < 2 and
        signal.source.tier > 1
    )

    # Check 4: Plausibility (Claude assessment)
    checks['plausibility'] = assess_plausibility(signal)  # Claude call
    checks['plausibility_passed'] = checks['plausibility']['score'] > 0.6

    # Check 5: Recency
    checks['is_fresh'] = signal.published_at > (now() - hours(48))

    # Overall
    passed = (
        not checks['too_good_to_be_true'] and
        checks['plausibility_passed'] and
        checks['is_fresh'] and
        (checks['source_tier_passed'] or checks['corroboration_count'] >= 3)
    )

    return passed, checks
```

### Plausibility Assessment (Claude)

```
You are a senior technology analyst assessing whether a signal is plausible.

Signal: {title} — {content}
Source tier: {tier}
Domain: {domain}

Does this signal:
1. Contradict established physical, legal, or market reality?
2. Require capabilities that do not currently exist?
3. Claim something so extreme it would require massive independent corroboration?
4. Appear to be satire, fiction, or deliberate misinformation?

Return JSON only:
{"plausible": true/false, "score": 0.0-1.0, "concerns": ["list any concerns"]}
```

---

## 3. Alert Tier Classification

```python
def classify_alert_tier(composite, reality_check_passed, corroboration_count, source_tier):

    if not reality_check_passed:
        return None  # Not an alert

    if composite >= 9.0 and corroboration_count >= 3 and source_tier <= 2:
        return 'breaking'

    if composite >= 8.5 and corroboration_count >= 2:
        return 'significant'

    if composite >= 8.0:
        return 'watch'

    return None
```

### Alert Confidence Routing

```
breaking   + corroboration_count >= 3 + tier 1 source   → CONFIRMED
breaking   + corroboration_count >= 2                    → DEVELOPING
significant + corroboration_count >= 2                   → DEVELOPING
significant + corroboration_count < 2                    → PINCH OF SALT
watch      + any                                         → PINCH OF SALT

too_good_to_be_true = TRUE regardless of tier            → PINCH OF SALT
                                                           (never CONFIRMED or DEVELOPING)
```

### Alert Rate Limiting

```
Maximum alerts per domain per week: 2
If 3+ candidates compete: only highest composite score fires as alert
Others drop to standard buffer

If alert volume for a domain exceeds 3 per month:
  → Flag for operator review
  → Recommend raising threshold for that domain
```

---

## 4. Cluster Readiness Scoring

Determines when a cluster has enough signal to warrant a content pack.

```python
def calculate_readiness_score(cluster, signals_since_last_pack, all_cluster_signals):

    # Component 1: Signal volume (0-25 points)
    volume_score = min(len(signals_since_last_pack) / 20 * 25, 25)

    # Component 2: Signal diversity (0-25 points)
    # How many different sources contributed?
    unique_sources = len(set(s.source_id for s in signals_since_last_pack))
    diversity_score = min(unique_sources / 10 * 25, 25)

    # Component 3: Novelty (0-20 points)
    # How different is this from the last content pack topic?
    novelty_score = calculate_novelty(cluster, all_cluster_signals)  # embedding distance

    # Component 4: Trajectory shift (0-20 points)
    # Has something meaningfully changed direction?
    trajectory_score = detect_trajectory_shift(cluster, signals_since_last_pack)

    # Component 5: Cross-domain spark (0-10 points)
    # Are two+ domains intersecting interestingly?
    cross_domain_score = detect_cross_domain_intersection(signals_since_last_pack)

    total = volume_score + diversity_score + novelty_score + trajectory_score + cross_domain_score

    return round(total, 2)

# Threshold: content pack triggered when readiness_score >= 75.0
# Hard cap: even if score not met, trigger if days_since_last_pack >= 5
READINESS_THRESHOLD = 75.0
HARD_CAP_DAYS = 5
```

---

## 5. Source Token Tier Movement

Automatic tier progression based on track record alone.

```python
def recalculate_source_tier(token):
    resolved = token.confirmed_correct + token.confirmed_wrong + token.partially_correct

    if resolved < 2:
        return 0  # Too early to assess

    accuracy = (token.confirmed_correct + token.partially_correct * 0.5) / resolved

    # Tier assignment
    if resolved >= 10 and accuracy >= 0.80:
        return 4  # Exemplary

    if resolved >= 7 and accuracy >= 0.70:
        return 3  # Reliable

    if resolved >= 4 and accuracy >= 0.60:
        return 2  # Credible

    if resolved >= 2 and accuracy >= 0.40:
        return 1  # Emerging

    return 0  # New / unproven

# Upgrade triggers
UPGRADE_TRIGGERS = [
    {'consecutive_correct': 3, 'tier_change': +1},
    {'accuracy_at_submissions': 5, 'min_accuracy': 0.70, 'action': 'review'},
    {'initial_verdict': 'illegitimate', 'confirmed_correct': 4, 'action': 'flag_for_review'},
]

# Downgrade triggers
DOWNGRADE_TRIGGERS = [
    {'consecutive_wrong': 3, 'tier_change': -1},
    {'accuracy_rolling_10': 0.40, 'action': 'review'},
]

# Protection: no source ever removed, no permanent penalisation
```

---

## 6. Pinch of Salt Staleness

```python
STALE_AFTER_DAYS = 90

def check_staleness(pos_watch_item):
    if pos_watch_item.status in ('confirmed', 'wrong'):
        return  # Already resolved

    days_open = (now() - pos_watch_item.created_at).days

    if days_open >= STALE_AFTER_DAYS:
        # Mark stale — but only if still plausible
        # If the domain has moved on and this is clearly dead → mark wrong
        # If still theoretically possible → mark stale, keep open, review monthly
        pos_watch_item.status = 'stale'
        pos_watch_item.marked_stale_at = now()

    # Stale items reviewed at monthly report generation
    # Operator decides: close as wrong, extend, or keep watching
```

---

## 7. Running Accuracy Metrics

Recalculated on every outcome event and cached in monthly_snapshots.

```python
def calculate_platform_accuracy():
    # All-time Pinch of Salt accuracy
    total_pos = count(pinch_of_salt_watch where status != 'watching')
    confirmed = count(pinch_of_salt_watch where outcome = 'confirmed')
    wrong = count(pinch_of_salt_watch where outcome = 'wrong')
    partial = count(pinch_of_salt_watch where outcome = 'partial')

    accuracy_rate = (confirmed + partial * 0.5) / total_pos

    # Average lead time (confirmed only)
    avg_lead_time = avg(days_to_confirmation) where outcome = 'confirmed'

    # These metrics are published on the platform homepage and in every HiveReport
    return {
        'accuracy_rate': accuracy_rate,
        'avg_lead_time_days': avg_lead_time,
        'total_resolved': total_pos,
        'sample_size_note': 'meaningful above 30 resolved signals'
    }
```
