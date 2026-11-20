from enum import Enum
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

class ModelAlias(str, Enum):
    DRAFT_IMAGE = "draft-image"
    MID_IMAGE = "mid-image"
    PRO_IMAGE = "pro-image"
    VECTOR_IMAGE = "vector-image"
    TYPOGRAPHY_IMAGE = "typography-image"
    DRAFT_VIDEO = "draft-video"
    MID_VIDEO = "mid-video"
    CINEMATIC_VIDEO = "cinematic-video"
    LIP_SYNC = "lip-sync"
    AVATAR_TALKING = "avatar-talking"
    UPSCALE_IMAGE = "upscale-image"
    REMOVE_BG_IMAGE = "remove-bg-image"
    REMOVE_BG_VIDEO = "remove-bg-video"
    FAST_TTS = "fast-tts"
    ULTRA_TTS = "ultra-tts"
    MUSIC_GEN = "music-gen"

class MediaCapability(str, Enum):
    IMAGE_GENERATION = "IMAGE_GENERATION"
    IMAGE_EDIT = "IMAGE_EDIT"
    VIDEO_GENERATION = "VIDEO_GENERATION"
    VIDEO_EDIT = "VIDEO_EDIT"
    TTS = "TTS"
    LIP_SYNC = "LIP_SYNC"
    AVATAR = "AVATAR"
    UPSCALE = "UPSCALE"
    REMOVE_BACKGROUND = "REMOVE_BACKGROUND"

class QualityTier(str, Enum):
    DRAFT = "draft"
    MID = "mid"
    PRO = "pro"

class MediaJobPayload(BaseModel):
    job_id: str
    tenant_id: str
    user_id: str
    alias: ModelAlias
    prompt: str
    negative_prompt: Optional[str] = None
    parameters: Dict[str, Any] = Field(default_factory=dict)
    input_media_urls: List[str] = Field(default_factory=list)
    quality_tier: QualityTier = QualityTier.MID
    max_cost_limit_usd: Optional[float] = None

class ProviderMediaResult(BaseModel):
    provider_id: str
    model_id: str
    temporary_media_urls: List[str]  # Ham sağlayıcı URL'leri (kesinlikle istemciye dönülmez!)
    raw_payload: Optional[Dict[str, Any]] = None
    inference_ms: int
    official_cost_usd: float
    c2pa_manifest_id: Optional[str] = None

class MediaJobExecutionResult(BaseModel):
    job_id: str
    status: str  # "SUCCEEDED" | "FAILED"
    alias: ModelAlias
    provider_used: str
    model_used: str
    output_cdn_urls: List[str]  # Yalnızca Nordvow CloudFront CDN URL'leri
    official_cost_usd: float
    loaded_cost_usd: float
    inference_ms: int
    c2pa_manifest_id: Optional[str] = None
    error_message: Optional[str] = None

