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


settings = Settings()
