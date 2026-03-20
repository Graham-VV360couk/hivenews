# apps/python/tests/test_monthly_report.py
import uuid
from unittest.mock import AsyncMock, MagicMock, patch


async def test_compute_monthly_stats_returns_dict():
    """compute_monthly_stats fetches counts from DB and returns a stats dict."""
    mock_conn = AsyncMock()
    mock_conn.fetchval = AsyncMock(side_effect=[
        42,   # signals_ingested
        5,    # alerts_fired
        3,    # alerts_confirmed
        2,    # pinch_of_salt_issued
        8,    # content_packs_published
    ])
    mock_conn.execute = AsyncMock()

    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.monthly_report.get_conn", return_value=mock_ctx):
        from services.monthly_report import compute_monthly_stats
        result = await compute_monthly_stats(2026, 3)

    assert result["year"] == 2026
    assert result["month"] == 3
    assert result["month_name"] == "March"
    assert "signals_ingested" in result
    assert result["signals_ingested"] == 42


async def test_generate_monthly_report_creates_content_pack():
    """generate_monthly_report calls Claude and returns a pack_id."""
    pack_id = uuid.uuid4()

    mock_stats = {
        "year": 2026, "month": 3, "month_name": "March",
        "signals_ingested": 42, "alerts_fired": 5,
        "alerts_confirmed": 3, "pinch_of_salt_issued": 2,
        "content_packs_published": 8,
    }

    report_json = '{"title": "The March 2026 HiveReport", "meta_description": "Monthly intelligence.", "section1_numbers": "Numbers", "section2_domains": "Domains", "section3_scorecard": "Scorecard", "section4_trajectories": "Trajectories", "section5_signal": "Signal", "section6_watching": "Watching", "section7_pos": "PoS", "linkedin_extract": "LinkedIn text", "x_thread": ["Tweet 1", "Tweet 2"], "facebook_summary": "Facebook text", "hivecast_script": "Script"}'

    mock_claude_response = MagicMock()
    mock_claude_response.content = [MagicMock(text=report_json)]

    mock_conn = AsyncMock()
    mock_conn.fetch = AsyncMock(return_value=[])
    mock_conn.fetchval = AsyncMock(return_value=None)

    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_claude_response)

    with patch("services.monthly_report.compute_monthly_stats", return_value=mock_stats), \
         patch("services.monthly_report.get_conn", return_value=mock_ctx), \
         patch("services.monthly_report.anthropic.AsyncAnthropic", return_value=mock_client), \
         patch("services.monthly_report.create_content_pack", return_value=pack_id), \
         patch("services.monthly_report.store_drafts", return_value=True):

        from services.monthly_report import generate_monthly_report
        result = await generate_monthly_report(2026, 3)

    assert result is not None
    assert result["pack_id"] == str(pack_id)
    assert result["month"] == "March"
