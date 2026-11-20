import logging
import time
from typing import Dict, Any, Optional
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
import httpx

from app.domain.models import (
    ModelAlias,
    MediaJobPayload,
    MediaJobExecutionResult,
    ProviderMediaResult,
)
from app.domain.interfaces import (
    ImageProvider,
    VideoProvider,
    AudioProvider,
    AvatarProvider,
    MediaEnhancerProvider,
)
from app.infrastructure.storage import media_storage
from app.infrastructure.providers.fal_adapter import FalAdapter
from app.infrastructure.providers.google_adapter import GoogleDirectAdapter
from app.infrastructure.providers.byteplus_adapter import BytePlusAdapter
from app.infrastructure.providers.minimax_adapter import MiniMaxAdapter
from app.infrastructure.providers.elevenlabs_adapter import ElevenLabsAdapter
from app.infrastructure.providers.kling_adapter import KlingAdapter
from app.infrastructure.providers.heygen_adapter import HeyGenAdapter
from app.infrastructure.providers.recraft_ideogram_adapter import RecraftIdeogramAdapter
from app.infrastructure.providers.replicate_adapter import ReplicateAdapter

logger = logging.getLogger("nordvow.router")

class TransientProviderError(Exception):
    """429 Rate Limit veya 5xx sunucu hataları için yeniden denenebilir hata sınıfı."""
    pass

class MediaRouter:
    """
    Nordvow Media Router & Provider Abstraction Engine
    - İstemci sağlayıcıyı bilmez; yalnızca soyut alias ile çalışır.
    - Dinamik Yönlendirme: Maliyet, gecikme SLA'i ve sağlık skoruna göre en uygun rotayı belirler.
    - Fallback & Retry: 429/5xx hatalarında otomatik yeniden dener veya Replicate yedeğine düşer.
    - S3 Ingestion: Geçici sağlayıcı URL'lerini asla istemciye vermez; CloudFront CDN üzerinden sunar.
    """
    def __init__(self):
        # Sağlayıcı adaptör havuzu
        self.fal = FalAdapter()
        self.google = GoogleDirectAdapter()
        self.byteplus = BytePlusAdapter()
        self.minimax = MiniMaxAdapter()
        self.elevenlabs = ElevenLabsAdapter()
        self.kling = KlingAdapter()
        self.heygen = HeyGenAdapter()
        self.recraft_ideogram = RecraftIdeogramAdapter()
        self.replicate = ReplicateAdapter()

    async def execute_job(self, payload: MediaJobPayload) -> MediaJobExecutionResult:
        logger.info(f"İş Media Router tarafından işleniyor: {payload.job_id} [{payload.alias}]")

        # 1. Rota ve Sağlayıcı Haritasını Çözümle
        primary_provider, primary_model, fallback_provider, fallback_model = self._resolve_route(
            payload.alias
        )

        provider_result: Optional[ProviderMediaResult] = None
        provider_used = primary_provider
        model_used = primary_model

        # 2. Birincil Sağlayıcı ile Çalıştır (Yeniden Deneme ile)
        try:
            provider_result = await self._execute_with_retry(
                primary_provider, primary_model, payload
            )
        except Exception as primary_error:
            logger.warning(
                f"Birincil sağlayıcı ({primary_provider}) başarısız oldu: {primary_error}. Fallback devreye alınıyor..."
            )

            # 3. Otomatik Fallback (İkincil Sağlayıcı)
            if fallback_provider and fallback_model:
                try:
                    provider_used = fallback_provider
                    model_used = fallback_model
                    provider_result = await self._execute_with_retry(
                        fallback_provider, fallback_model, payload
                    )
                except Exception as fallback_error:
                    logger.error(f"Fallback sağlayıcı da başarısız oldu: {fallback_error}")
                    return MediaJobExecutionResult(
                        job_id=payload.job_id,
                        status="FAILED",
                        alias=payload.alias,
                        provider_used=provider_used,
                        model_used=model_used,
                        output_cdn_urls=[],
                        official_cost_usd=0.0,
                        loaded_cost_usd=0.0,
                        inference_ms=0,
                        error_message=f"Tüm sağlayıcılar tükendi. Birincil: {primary_error}, Yedek: {fallback_error}"
                    )
            else:
                return MediaJobExecutionResult(
                    job_id=payload.job_id,
                    status="FAILED",
                    alias=payload.alias,
                    provider_used=provider_used,
                    model_used=model_used,
                    output_cdn_urls=[],
                    official_cost_usd=0.0,
                    loaded_cost_usd=0.0,
                    inference_ms=0,
                    error_message=str(primary_error)
                )

        if not provider_result:
            raise RuntimeError("Sağlayıcı geçerli bir sonuç üretmedi.")

        # 4. S3 Ingestion & CloudFront CDN Aktarımı (Kısa Ömürlü URL Koruması)
        cdn_urls = []
        if provider_result.temporary_media_urls:
            is_video = "video" in payload.alias.value or "avatar" in payload.alias.value
            is_audio = "tts" in payload.alias.value or "music" in payload.alias.value
            folder = "videos" if is_video else ("audio" if is_audio else "images")

            cdn_urls = await media_storage.ingest_temporary_urls(
                temp_urls=provider_result.temporary_media_urls,
                tenant_id=payload.tenant_id,
                job_id=payload.job_id,
                media_type=folder
            )

        # 5. Yüklenmiş Maliyet (Loaded Cost) Hesabı:
        # Görüntü/Ses için × 1.15; Video/Avatar için × 1.30
        is_video_or_avatar = (
            "video" in payload.alias.value or
            "avatar" in payload.alias.value or
            "lip-sync" in payload.alias.value
        )
        loaded_multiplier = 1.30 if is_video_or_avatar else 1.15
        loaded_cost_usd = round(provider_result.official_cost_usd * loaded_multiplier, 6)

        return MediaJobExecutionResult(
            job_id=payload.job_id,
            status="SUCCEEDED",
            alias=payload.alias,
            provider_used=provider_used,
            model_used=model_used,
            output_cdn_urls=cdn_urls,
            official_cost_usd=provider_result.official_cost_usd,
            loaded_cost_usd=loaded_cost_usd,
            inference_ms=provider_result.inference_ms,
            c2pa_manifest_id=provider_result.c2pa_manifest_id
        )

    def _resolve_route(self, alias: ModelAlias) -> tuple[str, str, Optional[str], Optional[str]]:
        """
        Alias'ı birincil ve yedek sağlayıcı/model ikilisine eşler.
        Kullanımdan kalkan (deprecated) modeller kesinlikle dahil edilmez.
        """
        mapping = {
            # Görüntü
            ModelAlias.DRAFT_IMAGE: ("fal", "fal-ai/flux/schnell", "byteplus", "seedream-5-flash"),
            ModelAlias.MID_IMAGE: ("google", "google/nano-banana-2.1", "byteplus", "seedream-5-lite"),
            ModelAlias.PRO_IMAGE: ("google", "google/nano-banana-pro", "fal", "fal-ai/flux-pro/v1.1"),
            ModelAlias.VECTOR_IMAGE: ("recraft", "recraft-v4.1", "fal", "fal-ai/recraft/v3/text-to-image"),
            ModelAlias.TYPOGRAPHY_IMAGE: ("ideogram", "ideogram-v3", "fal", "fal-ai/ideogram/v3"),
            ModelAlias.REMOVE_BG_IMAGE: ("fal", "fal-ai/bria/rmbg-2.0", "replicate", "bria/rmbg"),
            ModelAlias.UPSCALE_IMAGE: ("fal", "fal-ai/seedvr2/upscaler", "replicate", "seedvr/upscaler"),
            # Video
            ModelAlias.DRAFT_VIDEO: ("fal", "fal-ai/pixverse/v6", "replicate", "pixverse-v6"),
            ModelAlias.MID_VIDEO: ("minimax", "minimax-h3-highspeed", "byteplus", "seedance-2-fast"),
            ModelAlias.CINEMATIC_VIDEO: ("kling", "kling-v4.0-pro", "kling", "kling-v3.0"),
            ModelAlias.LIP_SYNC: ("kling", "kling-lip-sync", "fal", "fal-ai/latentsync"),
            ModelAlias.AVATAR_TALKING: ("heygen", "heygen-avatar-v", "heygen", "heygen-avatar-iv"),
            ModelAlias.REMOVE_BG_VIDEO: ("fal", "fal-ai/veed/video-background-removal", "replicate", "veed/background-removal"),
            # Ses & Müzik
            ModelAlias.FAST_TTS: ("minimax", "speech-2.8", "elevenlabs", "eleven_flash_v2_5"),
            ModelAlias.ULTRA_TTS: ("elevenlabs", "eleven_turbo_v2_5", "elevenlabs", "eleven_multilingual_v2"),
            ModelAlias.MUSIC_GEN: ("elevenlabs", "eleven_music_v1", "google", "google/lyria-3.5"),
        }

        if alias not in mapping:
            raise ValueError(f"Bilinmeyen model alias: {alias}")

        return mapping[alias]

    async def _execute_with_retry(
        self,
        provider_name: str,
        model_id: str,
        payload: MediaJobPayload
    ) -> ProviderMediaResult:
        # Idempotent retry logic on transient HTTP errors (429, 502, 503, 504)
        for attempt in range(3):
            try:
                return await self._dispatch_to_adapter(provider_name, model_id, payload)
            except httpx.HTTPStatusError as e:
                status = e.response.status_code
                if status in (429, 502, 503, 504) and attempt < 2:
                    wait_sec = (2 ** attempt) * 1.5
                    logger.warning(
                        f"Sağlayıcı {provider_name} {status} döndü. {wait_sec} sn sonra tekrar deneniyor (Deneme {attempt + 1}/3)..."
                    )
                    time.sleep(wait_sec)
                    continue
                raise e
            except Exception as e:
                if attempt < 2:
                    time.sleep(1.0)
                    continue
                raise e

        raise RuntimeError(f"{provider_name} tüm denemelerde başarısız oldu.")

    async def _dispatch_to_adapter(
        self,
        provider_name: str,
        model_id: str,
        payload: MediaJobPayload
    ) -> ProviderMediaResult:
        if provider_name == "fal":
            if "pixverse" in model_id:
                return await self.fal.generate_video(payload, model_id)
            if "upscaler" in model_id:
                return await self.fal.upscale(payload, model_id)
            if "rmbg" in model_id or "veed" in model_id:
                return await self.fal.remove_background(payload, model_id)
            return await self.fal.generate_image(payload, model_id)

        elif provider_name == "google":
            if "omni" in model_id:
                return await self.google.generate_video(payload, model_id)
            if "lyria" in model_id:
                return await self.google.generate_music(payload, model_id)
            return await self.google.generate_image(payload, model_id)

        elif provider_name == "byteplus":
            if "seedance" in model_id:
                return await self.byteplus.generate_video(payload, model_id)
            return await self.byteplus.generate_image(payload, model_id)

        elif provider_name == "minimax":
            if "h3" in model_id:
                return await self.minimax.generate_video(payload, model_id)
            return await self.minimax.tts(payload, model_id)

        elif provider_name == "elevenlabs":
            if "music" in model_id:
                return await self.elevenlabs.generate_music(payload, model_id)
            return await self.elevenlabs.tts(payload, model_id)

        elif provider_name == "kling":
            if "lip-sync" in model_id:
                return await self.kling.lip_sync(payload, model_id)
            return await self.kling.generate_video(payload, model_id)

        elif provider_name == "heygen":
            return await self.heygen.generate_avatar(payload, model_id)

        elif provider_name in ("recraft", "ideogram"):
            return await self.recraft_ideogram.generate_image(payload, model_id)

        elif provider_name == "replicate":
            if "pixverse" in model_id or "video" in model_id:
                return await self.replicate.generate_video(payload, model_id)
            return await self.replicate.generate_image(payload, model_id)

        raise ValueError(f"Tanınmayan sağlayıcı adı: {provider_name}")

media_router = MediaRouter()

