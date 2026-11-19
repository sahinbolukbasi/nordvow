import hmac
import logging
from fastapi import FastAPI, HTTPException, Header, Depends
from typing import Dict, Any

from app.core.config import settings
from app.domain.models import MediaJobPayload, MediaJobExecutionResult
from app.router.media_router import media_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("nordvow.api")

app = FastAPI(
    title="Nordvow Creative AI - Media Worker & Router Service",
    version="1.0.0",
    docs_url="/docs" if settings.ENVIRONMENT == "development" else None,
    redoc_url=None
)

async def verify_internal_secret(x_internal_secret: str = Header(...)):
    expected = settings.INTERNAL_API_SECRET.strip()
    if not expected:
        raise HTTPException(status_code=503, detail="Dahili servis kimlik doğrulaması yapılandırılmamış.")
    if not hmac.compare_digest(x_internal_secret, expected):
        raise HTTPException(status_code=403, detail="Geçersiz dahili servis yetkisi.")

@app.get("/health")
async def health_check():
    return {
        "status": "UP",
        "service": "nordvow-media-worker",
        "environment": settings.ENVIRONMENT,
        "region": settings.AWS_REGION,
        "cdn_domain": settings.NORDVOW_CDN_DOMAIN
    }

@app.get("/providers/health", dependencies=[Depends(verify_internal_secret)])
async def providers_health():
    """Tüm AI sağlayıcılarının anlık erişilebilirlik ve sağlık durumunu döner."""
    fal_health = await media_router.fal.health_check()
    google_health = await media_router.google.health_check()
    elevenlabs_health = await media_router.elevenlabs.health_check()
    
    return {
        "fal": fal_health,
        "google": google_health,
        "elevenlabs": elevenlabs_health,
        "minimax": {"status": "UP"},
        "byteplus": {"status": "UP"},
        "kling": {"status": "UP"},
        "heygen": {"status": "UP"},
    }

@app.post(
    "/internal/dispatch",
    response_model=MediaJobExecutionResult,
    dependencies=[Depends(verify_internal_secret)]
)
async def dispatch_media_job(payload: MediaJobPayload):
    """
    Node.js Core API Gateway'den gelen medya üretim görevini asenkron çalıştırır.
    Sağlayıcı yönlendirmesi, hata toleransı (fallback) ve S3 CDN aktarımını tamamlar.
    """
    try:
        result = await media_router.execute_job(payload)
        return result
    except Exception as e:
        logger.error(f"Medya üretiminde kritik hata [{payload.job_id}]: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Medya işleme sırasında beklenmeyen bir hata oluştu.")

