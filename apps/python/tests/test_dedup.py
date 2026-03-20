from unittest.mock import AsyncMock, patch


async def test_new_url_is_not_duplicate():
    mock_redis = AsyncMock()
    mock_redis.exists.return_value = 0
    with patch("services.dedup.get_redis", return_value=mock_redis):
        from services.dedup import is_duplicate
        result = await is_duplicate("https://example.com/article?utm_source=tw")
        assert result is False


async def test_seen_url_is_duplicate():
    mock_redis = AsyncMock()
    mock_redis.exists.return_value = 1
    with patch("services.dedup.get_redis", return_value=mock_redis):
        from services.dedup import is_duplicate
        result = await is_duplicate("https://example.com/article")
        assert result is True


async def test_mark_seen_sets_key_with_7_day_ttl():
    mock_redis = AsyncMock()
    with patch("services.dedup.get_redis", return_value=mock_redis):
        from services.dedup import mark_seen
        await mark_seen("https://example.com/article")
        mock_redis.setex.assert_called_once()
        _, ttl, _ = mock_redis.setex.call_args[0]
        assert ttl == 7 * 24 * 60 * 60


async def test_normalisation_strips_utm_params():
    from services.dedup import _normalise_url
    url_with_utm = "https://example.com/article?utm_source=twitter&utm_medium=social"
    url_clean = "https://example.com/article"
    assert _normalise_url(url_with_utm) == _normalise_url(url_clean)


async def test_normalisation_strips_www_prefix():
    from services.dedup import _normalise_url
    assert _normalise_url("https://www.example.com/a") == _normalise_url("https://example.com/a")
