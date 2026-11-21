from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

class Settings(BaseSettings):
    ENVIRONMENT: str = "production"
    AWS_REGION: str = "eu-central-1"
    
    # AWS S3 & CloudFront
    AWS_S3_MEDIA_BUCKET: str = "nordvow-creative-media-prod"
    NORDVOW_CDN_DOMAIN: str = "cdn.nordvow.ai"
    
    # Secrets Manager
    SECRETS_MANAGER_SECRET_ID: str = "nordvow/creative-ai/providers"
    SECRETS_CACHE_TTL_SECONDS: int = 300  # 5 minutes in-memory cache
    
    # Job Queue / Redis
    REDIS_URL: str = "redis://localhost:6379/0"
    SQS_QUEUE_URL: Optional[str] = None
    SQS_DLQ_URL: Optional[str] = None
    
    # Database
    DATABASE_URL: Optional[str] = None
    
    # Security — ortam değişkeninden zorunlu gelir, kodda sabit anahtar tutulmaz
    INTERNAL_API_SECRET: str = ""
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()

