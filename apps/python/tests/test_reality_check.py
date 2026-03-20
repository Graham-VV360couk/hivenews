from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, timedelta
import json


async def test_passes_tier1_source_with_corroboration():
    from services.reality_check import run_reality_check
    signal = {
        "id": "sig-1", "title": "Big news", "content": "Details",
        "source_tier": 1, "domain_tags": ["ai"],
        "magnitude_score": 8.0, "published_at": datetime.now(timezone.utc),
    }
    with patch("services.reality_check._count_corroborating_signals", new_callable=AsyncMock, return_value=3), \
         patch("services.reality_check._assess_plausibility", new_callable=AsyncMock, return_value={"plausible": True, "score": 0.9, "concerns": []}):
        result = await run_reality_check(signal)
    assert result["passed"] is True


async def test_fails_too_good_to_be_true():
    """magnitude > 9.5 + corroboration < 2 + tier > 1 = too good to be true."""
    from services.reality_check import run_reality_check
    signal = {
        "id": "sig-2", "title": "Wild claim", "content": "Unbelievable",
        "source_tier": 3, "domain_tags": ["ai"],
        "magnitude_score": 9.8, "published_at": datetime.now(timezone.utc),
    }
    with patch("services.reality_check._count_corroborating_signals", new_callable=AsyncMock, return_value=0), \
         patch("services.reality_check._assess_plausibility", new_callable=AsyncMock, return_value={"plausible": True, "score": 0.8, "concerns": []}):
        result = await run_reality_check(signal)
    assert result["passed"] is False
    assert result["too_good_to_be_true"] is True


async def test_fails_stale_signal():
    """Signals older than 48h fail reality check."""
    from services.reality_check import run_reality_check
    signal = {
        "id": "sig-3", "title": "Old news", "content": "Details",
        "source_tier": 1, "domain_tags": ["ai"],
        "magnitude_score": 8.5,
        "published_at": datetime.now(timezone.utc) - timedelta(days=3),
    }
    with patch("services.reality_check._count_corroborating_signals", new_callable=AsyncMock, return_value=3), \
         patch("services.reality_check._assess_plausibility", new_callable=AsyncMock, return_value={"plausible": True, "score": 0.9, "concerns": []}):
        result = await run_reality_check(signal)
    assert result["passed"] is False


async def test_passes_tier3_with_high_corroboration():
    """Tier 3 source passes if corroboration >= 3."""
    from services.reality_check import run_reality_check
    signal = {
        "id": "sig-4", "title": "Community scoop", "content": "Details",
        "source_tier": 3, "domain_tags": ["ai"],
        "magnitude_score": 8.2, "published_at": datetime.now(timezone.utc),
    }
    with patch("services.reality_check._count_corroborating_signals", new_callable=AsyncMock, return_value=3), \
         patch("services.reality_check._assess_plausibility", new_callable=AsyncMock, return_value={"plausible": True, "score": 0.85, "concerns": []}):
        result = await run_reality_check(signal)
    assert result["passed"] is True
