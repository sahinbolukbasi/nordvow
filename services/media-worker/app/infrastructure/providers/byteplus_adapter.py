import time
import logging
from typing import Dict, Any
from app.core.secrets import secrets_manager
from app.domain.interfaces import ImageProvider, VideoProvider
from app.domain.models import ProviderMediaResult, MediaJobPayload

logger = logging.getLogger("nordvow.providers.byteplus")

class BytePlusAdapter(ImageProvider, VideoProvider):
    provider_id = "byteplus"

    def _get_credentials(self) -> Dict[str, str]:
        return {
            "ak": secrets_manager.get_provider_secret("BYTEPLUS_AK"),
            "sk": secrets_manager.get_provider_secret("BYTEPLUS_SK"),
        }

    async def health_check(self) -> Dict[str, Any]:
        return {"status": "UP", "latency_ms": 120}

    async def generate_image(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        """Seedream 5.0 Flash (~$0.018) veya Seedream 5.0 Lite üretimi."""
        start = time.time()
        logger.info(f"BytePlus ModelArk Seedream çağrısı: {model_id}")
        
        # Simüle edilmiş doğrudan ModelArk API isteği
        inference_ms = int((time.time() - start) * 1000)
        official_cost = 0.018 if "flash" in model_id.lower() else 0.035

        return ProviderMediaResult(
            provider_id=self.provider_id,
            model_id=model_id,
            temporary_media_urls=[],
            inference_ms=inference_ms,
            official_cost_usd=official_cost
        )

    async def edit_image(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        return await self.generate_image(payload, model_id)

    async def generate_video(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        """
        Seedance 2.0 Fast (720p ~$0.12 / sn).
        Runway yerine doğrudan BytePlus entegrasyonu ile maliyet ve gecikme optimizasyonu.
        """
        start = time.time()
        duration = payload.parameters.get("durationSeconds", 5)
        inference_ms = int((time.time() - start) * 1000)
        official_cost = duration * 0.12

        logger.info(f"BytePlus Seedance 2.0 Fast video üretiliyor ({duration} sn)...")
        return ProviderMediaResult(
            provider_id=self.provider_id,
            model_id=model_id,
            temporary_media_urls=[],
            inference_ms=inference_ms,
            official_cost_usd=official_cost
        )

    async def edit_video(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        return await self.generate_video(payload, model_id)

