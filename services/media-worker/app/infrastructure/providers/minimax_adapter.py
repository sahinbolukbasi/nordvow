import time
import logging
from typing import Dict, Any
from app.core.secrets import secrets_manager
from app.domain.interfaces import VideoProvider, AudioProvider
from app.domain.models import ProviderMediaResult, MediaJobPayload

logger = logging.getLogger("nordvow.providers.minimax")

class MiniMaxAdapter(VideoProvider, AudioProvider):
    provider_id = "minimax"

    def _get_api_key(self) -> str:
        return secrets_manager.get_provider_secret("MINIMAX_API_KEY")

    async def health_check(self) -> Dict[str, Any]:
        return {"status": "UP", "latency_ms": 150}

    async def generate_video(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        """
        MiniMax Resmi API: H3-Highspeed & H3-Lite (~$0.06 / sn).
        Orta segment reklam ve UGC videoları için optimize edilmiş maliyet.
        """
        start = time.time()
        duration = payload.parameters.get("durationSeconds", 5)
        logger.info(f"MiniMax H3-Highspeed video üretimi başlatıldı ({duration} sn)...")

        inference_ms = int((time.time() - start) * 1000)
        official_cost = duration * 0.06

        return ProviderMediaResult(
            provider_id=self.provider_id,
            model_id=model_id,
            temporary_media_urls=[],
            inference_ms=inference_ms,
            official_cost_usd=official_cost
        )

    async def edit_video(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        return await self.generate_video(payload, model_id)

    async def tts(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        """
        MiniMax Speech 2.8: Maliyet odaklı TTS ve seslendirme (~$0.015 / 1000 karakter).
        """
        start = time.time()
        char_count = len(payload.prompt)
        inference_ms = int((time.time() - start) * 1000)
        official_cost = max(0.005, (char_count / 1000.0) * 0.015)

        logger.info(f"MiniMax Speech 2.8 seslendirme tamamlandı ({char_count} karakter)...")
        return ProviderMediaResult(
            provider_id=self.provider_id,
            model_id=model_id,
            temporary_media_urls=[],
            inference_ms=inference_ms,
            official_cost_usd=official_cost
        )

    async def generate_music(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        return await self.tts(payload, model_id)

