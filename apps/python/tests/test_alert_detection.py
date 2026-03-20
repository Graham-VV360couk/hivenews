from unittest.mock import AsyncMock, patch
from uuid import uuid4


async def test_breaking_alert_high_composite_tier1():
    from services.alert_detection import classify_alert_tier
    result = classify_alert_tier(composite=9.2, corroboration_count=4, source_tier=1)
    assert result == "breaking"


async def test_significant_alert():
    from services.alert_detection import classify_alert_tier
    result = classify_alert_tier(composite=8.7, corroboration_count=2, source_tier=2)
    assert result == "significant"


async def test_watch_alert_low_corroboration():
    from services.alert_detection import classify_alert_tier
    result = classify_alert_tier(composite=8.2, corroboration_count=1, source_tier=2)
    assert result == "watch"


async def test_no_alert_below_threshold():
    from services.alert_detection import classify_alert_tier
    result = classify_alert_tier(composite=7.5, corroboration_count=5, source_tier=1)
    assert result is None


async def test_confidence_routing_confirmed():
    from services.alert_detection import route_confidence
    result = route_confidence(alert_tier="breaking", corroboration_count=4, source_tier=1)
    assert result == "confirmed"


async def test_confidence_routing_pinch_of_salt():
    from services.alert_detection import route_confidence
    result = route_confidence(alert_tier="watch", corroboration_count=1, source_tier=3)
    assert result == "pinch_of_salt"


async def test_too_good_to_be_true_always_pinch_of_salt():
    from services.alert_detection import route_confidence
    result = route_confidence(
        alert_tier="breaking", corroboration_count=5, source_tier=1,
        too_good_to_be_true=True
    )
    assert result == "pinch_of_salt"


async def test_rate_limit_blocks_third_alert_same_domain():
    from services.alert_detection import check_rate_limit
    with patch("services.alert_detection._count_recent_domain_alerts",
               new_callable=AsyncMock, return_value=2):
        allowed = await check_rate_limit(["ai"])
    assert allowed is False


async def test_rate_limit_allows_first_two_alerts():
    from services.alert_detection import check_rate_limit
    with patch("services.alert_detection._count_recent_domain_alerts",
               new_callable=AsyncMock, return_value=1):
        allowed = await check_rate_limit(["ai"])
    assert allowed is True
