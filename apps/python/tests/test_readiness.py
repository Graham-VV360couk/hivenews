from unittest.mock import AsyncMock, patch


async def test_readiness_score_components_sum_correctly():
    from services.readiness import calculate_readiness_score
    score = calculate_readiness_score(
        signal_count=20, unique_sources=10,
        novelty_score=15.0, trajectory_shift_score=10.0, cross_domain_score=5.0
    )
    # volume: min(20/20*25, 25) = 25
    # diversity: min(10/10*25, 25) = 25
    # novelty: 15.0, trajectory: 10.0, cross_domain: 5.0
    assert score == 80.0


async def test_readiness_caps_components_at_max():
    from services.readiness import calculate_readiness_score
    score = calculate_readiness_score(
        signal_count=100, unique_sources=50,
        novelty_score=20.0, trajectory_shift_score=20.0, cross_domain_score=10.0
    )
    assert score == 100.0


async def test_readiness_below_threshold_does_not_trigger():
    from services.readiness import should_trigger_content_pack
    assert should_trigger_content_pack(readiness_score=70.0, days_since_last_pack=2) is False


async def test_readiness_above_threshold_triggers():
    from services.readiness import should_trigger_content_pack
    assert should_trigger_content_pack(readiness_score=76.0, days_since_last_pack=2) is True


async def test_hard_cap_triggers_regardless_of_score():
    """If 5+ days since last pack, trigger regardless of readiness score."""
    from services.readiness import should_trigger_content_pack
    assert should_trigger_content_pack(readiness_score=30.0, days_since_last_pack=5) is True


async def test_no_previous_pack_treated_as_hard_cap():
    """days_since_last_pack=None (never published) → always trigger after threshold."""
    from services.readiness import should_trigger_content_pack
    assert should_trigger_content_pack(readiness_score=76.0, days_since_last_pack=None) is True
