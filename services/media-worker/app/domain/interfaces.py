from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional
from app.domain.models import ProviderMediaResult, MediaJobPayload

class BaseMediaProvider(ABC):
    """
    Tüm AI sağlayıcılarının arkasında soyutlandığı ana arayüz.
    """
    provider_id: str
    is_active: bool = True

    @abstractmethod
    async def health_check(self) -> Dict[str, Any]:
        """Sağlayıcının canlılık ve gecikme durumunu döner."""
        pass

class ImageProvider(BaseMediaProvider):
    @abstractmethod
    async def generate_image(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        """Metinden görsel üretimi (text-to-image)."""
        pass

    @abstractmethod
    async def edit_image(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        """Mevcut görseli düzenleme / inpainting / image-to-image."""
        pass

class VideoProvider(BaseMediaProvider):
    @abstractmethod
    async def generate_video(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        """Metinden veya görselden video üretimi (text/image-to-video)."""
        pass

    @abstractmethod
    async def edit_video(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        """Video düzenleme / yeniden biçimlendirme."""
        pass

class AudioProvider(BaseMediaProvider):
    @abstractmethod
    async def tts(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        """Metinden sese dönüştürme ve ses klonlama."""
        pass

    @abstractmethod
    async def generate_music(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        """Arka plan müziği veya jingle üretimi."""
        pass

class AvatarProvider(BaseMediaProvider):
    @abstractmethod
    async def lip_sync(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        """Görsel/video üzerine ses ile ağız senkronizasyonu."""
        pass

    @abstractmethod
    async def generate_avatar(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        """Konuşan dijital ikiz / tam gövde avatar videosu."""
        pass

class MediaEnhancerProvider(BaseMediaProvider):
    @abstractmethod
    async def upscale(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        """Görsel veya video çözünürlüğünü 2K/4K seviyesine yükseltme."""
        pass

    @abstractmethod
    async def remove_background(self, payload: MediaJobPayload, model_id: str) -> ProviderMediaResult:
        """Görsel veya videodan arka planı kaldırma."""
        pass

