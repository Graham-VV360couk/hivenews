from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    redis_url: str
    openai_api_key: str
    anthropic_api_key: str
    google_ai_api_key: str = ""
    perplexity_api_key: str = ""
    elevenlabs_api_key: str = ""
    heygen_api_key: str = ""
    heygen_avatar_id: str = ""
    heygen_voice_id: str = ""
    honeypot_encryption_key: str = ""

    # Social / distribution
    x_api_key: str = ""
    x_api_secret: str = ""
    x_access_token: str = ""
    x_access_secret: str = ""
    linkedin_access_token: str = ""
    linkedin_org_id: str = ""          # Company page numeric ID (preferred)
    linkedin_person_id: str = ""       # Personal profile URN (fallback)
    facebook_page_access_token: str = ""
    facebook_page_id: str = ""
    instagram_user_id: str = ""        # Instagram Business Account ID (same app as Facebook)


settings = Settings()
