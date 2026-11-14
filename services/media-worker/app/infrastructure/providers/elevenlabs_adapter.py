import time
import logging
from typing import Dict, Any
import httpx
from app.core.secrets import secrets_manager
from app.domain.interfaces import AudioProvider
from app.domain.models import ProviderMediaResult, MediaJobPayload

logger = logging.getLogger("nordvow.providers.elevenlabs")

class ElevenLabsAdapter(AudioProvider):
    provider_id = "elevenlabs"

    def _get_api_key(self) -> str:
        return secrets_manager.get_provider_secret("ELEVENLABS_API_KEY")

    async def health_check(self) -> Dict[str, Any]:
        start = time.time()
        headers = {"xi-api-key": self._get_api_key()}
        async with httpx.AsyncClient(timeout=5.0) as client:
            try:
                res = await client.get("https://api.elevenlabs.io/v1/user", headers=headers)
                latency = int((time.time() - start) * 1000)
                return {"status": "UP" if res.status_code == 200 else "DEGRADED", "latency_ms": latency}
            except Exception as e:
                return {"status": "DOWN", "error": str(e)}

    async def tts(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        """
        ElevenLabs Resmi API (v4 / v4 Turbo / Flash).
        Ana TTS, ses klonlama, dublaj ve SFX motoru (~$0.04 / 1000 karakter).
        """
        start = time.time()
        api_key = self._get_api_key()
        voice_id = payload.parameters.get("voiceId", "21m00Tcm4TlvDq8ikWAM")  # Rachel fallback
        endpoint = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        headers = {
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg"
        }

        body = {
            "text": payload.prompt,
            "model_id": model_id,
            "voice_settings": {
                "stability": payload.parameters.get("stability", 0.5),
                "similarity_boost": payload.parameters.get("similarityBoost", 0.8),
            }
        }

        char_count = len(payload.prompt)
        official_cost = max(0.01, (char_count / 1000.0) * 0.04)

        async with httpx.AsyncClient(timeout=60.0) as client:
            logger.info(f"ElevenLabs TTS çağrısı yapılıyor: {model_id} ({char_count} karakter)...")
            response = await client.post(endpoint, json=body, headers=headers)
            response.raise_for_status()

            inference_ms = int((time.time() - start) * 1000)
            # İkili ses içeriği S3 uploader için data URL olarak paketlenir
            import base64
            audio_b64 = base64.b64encode(response.content).decode("utf-8")
            temp_urls = [f"data:audio/mpeg;base64,{audio_b64}"]

            return ProviderMediaResult(
                provider_id=self.provider_id,
                model_id=model_id,
                temporary_media_urls=temp_urls,
                inference_ms=inference_ms,
                official_cost_usd=official_cost
            )

    async def generate_music(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        """ElevenLabs Music Üretimi (~$0.15 / dk)."""
        start = time.time()
        inference_ms = int((time.time() - start) * 1000)
        return ProviderMediaResult(
            provider_id=self.provider_id,
            model_id=model_id,
            temporary_media_urls=[],
            inference_ms=inference_ms,
            official_cost_usd=0.15
        )

