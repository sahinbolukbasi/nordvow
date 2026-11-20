import time
import logging
from typing import Dict, Any, List
import httpx
from app.core.secrets import secrets_manager
from app.domain.interfaces import ImageProvider, VideoProvider, MediaEnhancerProvider
from app.domain.models import ProviderMediaResult, MediaJobPayload

logger = logging.getLogger("nordvow.providers.fal")

class FalAdapter(ImageProvider, VideoProvider, MediaEnhancerProvider):
    provider_id = "fal"

    def _get_api_key(self) -> str:
        return secrets_manager.get_provider_secret("FAL_KEY")

    async def health_check(self) -> Dict[str, Any]:
        start = time.time()
        headers = {"Authorization": f"Key {self._get_api_key()}"}
        async with httpx.AsyncClient(timeout=5.0) as client:
            try:
                # Hafif bir ping çağrısı
                res = await client.get("https://rest.alpha.fal.ai/health", headers=headers)
                latency = int((time.time() - start) * 1000)
                return {"status": "UP" if res.status_code == 200 else "DEGRADED", "latency_ms": latency}
            except Exception as e:
                return {"status": "DOWN", "error": str(e)}

    async def generate_image(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        """fal.ai üzerinden FLUX.1 schnell veya görsel modellerini çalıştırır."""
        start = time.time()
        api_key = self._get_api_key()
        endpoint = f"https://queue.fal.run/{model_id}"
        headers = {
            "Authorization": f"Key {api_key}",
            "Content-Type": "application/json"
        }

        body = {
            "prompt": payload.prompt,
            "image_size": payload.parameters.get("aspectRatio", "landscape_4_3"),
            "num_images": 1,
            "enable_safety_checker": True,
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            logger.info(f"fal.ai modeline istek iletiliyor: {model_id}")
            response = await client.post(endpoint, json=body, headers=headers)
            
            if response.status_code in (429, 502, 503, 504):
                response.raise_for_status()

            data = response.json()
            images = data.get("images", [])
            temp_urls = [img["url"] for img in images if "url" in img]

            inference_ms = int((time.time() - start) * 1000)
            # FLUX.1 schnell maliyeti ~$0.003
            official_cost = 0.003 if "schnell" in model_id else 0.04

            return ProviderMediaResult(
                provider_id=self.provider_id,
                model_id=model_id,
                temporary_media_urls=temp_urls,
                raw_payload=data,
                inference_ms=inference_ms,
                official_cost_usd=official_cost,
                c2pa_manifest_id=data.get("c2pa_manifest_id")
            )

    async def edit_image(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        return await self.generate_image(payload, model_id)

    async def generate_video(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        """PixVerse V6 veya fal video üretimi."""
        start = time.time()
        api_key = self._get_api_key()
        endpoint = f"https://queue.fal.run/{model_id}"
        headers = {"Authorization": f"Key {api_key}", "Content-Type": "application/json"}

        duration = payload.parameters.get("durationSeconds", 5)
        body = {
            "prompt": payload.prompt,
            "duration": duration,
        }
        if payload.input_media_urls:
            body["image_url"] = payload.input_media_urls[0]

        async with httpx.AsyncClient(timeout=180.0) as client:
            response = await client.post(endpoint, json=body, headers=headers)
            response.raise_for_status()
            data = response.json()

            video_url = data.get("video", {}).get("url") or data.get("video_url")
            temp_urls = [video_url] if video_url else []

            inference_ms = int((time.time() - start) * 1000)
            # PixVerse V6 ~$0.005 / sn
            official_cost = duration * 0.005

            return ProviderMediaResult(
                provider_id=self.provider_id,
                model_id=model_id,
                temporary_media_urls=temp_urls,
                raw_payload=data,
                inference_ms=inference_ms,
                official_cost_usd=official_cost
            )

    async def edit_video(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        return await self.generate_video(payload, model_id)

    async def upscale(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        """SeedVR2 Çözünürlük Yükseltme."""
        start = time.time()
        api_key = self._get_api_key()
        endpoint = f"https://queue.fal.run/{model_id}"
        headers = {"Authorization": f"Key {api_key}", "Content-Type": "application/json"}

        body = {"image_url": payload.input_media_urls[0] if payload.input_media_urls else ""}

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(endpoint, json=body, headers=headers)
            response.raise_for_status()
            data = response.json()

            output_url = data.get("image", {}).get("url")
            inference_ms = int((time.time() - start) * 1000)

            return ProviderMediaResult(
                provider_id=self.provider_id,
                model_id=model_id,
                temporary_media_urls=[output_url] if output_url else [],
                raw_payload=data,
                inference_ms=inference_ms,
                official_cost_usd=0.02
            )

    async def remove_background(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        """Bria RMBG 2.0 veya VEED Video Background Removal."""
        start = time.time()
        api_key = self._get_api_key()
        endpoint = f"https://queue.fal.run/{model_id}"
        headers = {"Authorization": f"Key {api_key}", "Content-Type": "application/json"}

        is_video = "veed" in model_id.lower() or "video" in model_id.lower()
        input_url = payload.input_media_urls[0] if payload.input_media_urls else ""
        body = {"video_url" if is_video else "image_url": input_url}

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(endpoint, json=body, headers=headers)
            response.raise_for_status()
            data = response.json()

            output_url = data.get("image", {}).get("url") or data.get("video", {}).get("url")
            inference_ms = int((time.time() - start) * 1000)
            cost = 0.05 if is_video else 0.015

            return ProviderMediaResult(
                provider_id=self.provider_id,
                model_id=model_id,
                temporary_media_urls=[output_url] if output_url else [],
                raw_payload=data,
                inference_ms=inference_ms,
                official_cost_usd=cost
            )

