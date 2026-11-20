import json
import time
import logging
from typing import Dict, Any, Optional
import boto3
from botocore.exceptions import ClientError
from app.core.config import settings

logger = logging.getLogger("nordvow.secrets")

class SecretsManagerService:
    """
    AWS Secrets Manager Güvenlik Katmanı (Sıfır Tolerans Kuralı)
    - Hiçbir API anahtarı kaynak kodda, .env'de veya loglarda tutulmaz.
    - Çalışma zamanında (runtime) AWS IAM Rolü aracılığıyla okunur.
    - Bellekte TTL tabanlı önbelleklenir ve periyodik rotasyona izin verir.
    """
    _instance: Optional["SecretsManagerService"] = None
    _cached_secrets: Dict[str, Any] = {}
    _last_fetch_timestamp: float = 0

    def __init__(self):
        self.client = boto3.client(
            "secretsmanager",
            region_name=settings.AWS_REGION
        )

    @classmethod
    def get_instance(cls) -> "SecretsManagerService":
        if cls._instance is None:
            cls._instance = SecretsManagerService()
        return cls._instance

    def get_provider_secret(self, key: str) -> str:
        """
        Belirtilen AI sağlayıcı API anahtarını güvenli şekilde döner.
        Örnek anahtarlar: 'FAL_KEY', 'GEMINI_API_KEY', 'BYTEPLUS_AK', 'MINIMAX_API_KEY', 'ELEVENLABS_API_KEY'
        """
        now = time.time()
        # Önbellek geçerli mi kontrol et
        if (
            not self._cached_secrets
            or (now - self._last_fetch_timestamp) > settings.SECRETS_CACHE_TTL_SECONDS
        ):
            self._refresh_secrets()

        secret_value = self._cached_secrets.get(key)
        if not secret_value:
            # Önbellekte yoksa acil yenileme yap
            self._refresh_secrets()
            secret_value = self._cached_secrets.get(key)

        if not secret_value:
            logger.critical(
                f"[GÜVENLİK İHLALİ] AWS Secrets Manager'da '{key}' anahtarı bulunamadı! Sağlayıcı çağrısı engellendi."
            )
            raise ValueError(f"Secret key '{key}' is missing in AWS Secrets Manager.")

        return secret_value

    def _refresh_secrets(self) -> None:
        try:
            logger.info(
                f"AWS Secrets Manager'dan secret yükleniyor: {settings.SECRETS_MANAGER_SECRET_ID}"
            )
            response = self.client.get_secret_value(
                SecretId=settings.SECRETS_MANAGER_SECRET_ID
            )

            if "SecretString" in response:
                secret_dict = json.loads(response["SecretString"])
            else:
                logger.error("Secret ikili formatta, string formatı bekleniyordu.")
                secret_dict = {}

            self._cached_secrets = secret_dict
            self._last_fetch_timestamp = time.time()
            logger.info("AWS Secrets Manager anahtarları başarıyla önbelleklendi.")

        except ClientError as e:
            logger.error(f"AWS Secrets Manager erişim hatası (IAM Rolü kontrol edilmeli): {e}")
            if settings.ENVIRONMENT == "development":
                logger.warning("Geliştirme modunda yerel fallback kontrol ediliyor...")
            else:
                raise RuntimeError(
                    f"AWS Secrets Manager erişilemedi! IAM Least-Privilege politikasını kontrol edin: {e}"
                )

secrets_manager = SecretsManagerService.get_instance()

