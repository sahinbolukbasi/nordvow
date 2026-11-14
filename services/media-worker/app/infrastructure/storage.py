import uuid
import logging
from typing import List
import httpx
import boto3
from botocore.exceptions import ClientError
from app.core.config import settings

logger = logging.getLogger("nordvow.storage")

class MediaStorageService:
    """
    Kısa Ömürlü URL Koruma & CDN İletim Servisi
    Sağlayıcıların geçici URL'lerini istemciye iletmeden anında S3'e indirir
    ve Nordvow CloudFront CDN URL'i oluşturur.
    """
    def __init__(self):
        self.s3_client = boto3.client(
            "s3",
            region_name=settings.AWS_REGION
        )
        self.bucket = settings.AWS_S3_MEDIA_BUCKET
        self.cdn_domain = settings.NORDVOW_CDN_DOMAIN

    async def ingest_temporary_urls(
        self,
        temp_urls: List[str],
        tenant_id: str,
        job_id: str,
        media_type: str = "images"
    ) -> List[str]:
        cdn_urls = []
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            for index, url in enumerate(temp_urls):
                try:
                    logger.info(f"Geçici sağlayıcı medyası indiriliyor ({index + 1}/{len(temp_urls)})...")
                    response = await client.get(url)
                    response.raise_for_status()

                    content_type = response.headers.get("content-type", "application/octet-stream")
                    ext = self._guess_extension(content_type, url)

                    # Güvenli ve izole S3 anahtarı oluştur: tenants/{tenant_id}/{media_type}/{job_id}_{uuid}.{ext}
                    file_uuid = uuid.uuid4().hex[:8]
                    s3_key = f"tenants/{tenant_id}/{media_type}/{job_id}_{file_uuid}.{ext}"

                    logger.info(f"Medya AWS S3'e aktarılıyor: s3://{self.bucket}/{s3_key}")
                    self.s3_client.put_object(
                        Bucket=self.bucket,
                        Key=s3_key,
                        Body=response.content,
                        ContentType=content_type,
                        ServerSideEncryption="AES256",
                        Metadata={
                            "tenant-id": tenant_id,
                            "job-id": job_id,
                            "ingested-by": "nordvow-media-worker",
                        }
                    )

                    cdn_url = f"https://{self.cdn_domain}/{s3_key}"
                    cdn_urls.append(cdn_url)
                    logger.info(f"Nordvow CDN URL oluşturuldu: {cdn_url}")

                except Exception as e:
                    logger.error(f"Medya aktarımında hata oluştu ({url}): {e}")
                    raise RuntimeError(f"Failed to ingest temporary media to Nordvow S3: {e}")

        return cdn_urls

    def _guess_extension(self, content_type: str, url: str) -> str:
        if "image/png" in content_type:
            return "png"
        if "image/jpeg" in content_type:
            return "jpg"
        if "image/webp" in content_type:
            return "webp"
        if "video/mp4" in content_type:
            return "mp4"
        if "audio/mpeg" in content_type or "audio/mp3" in content_type:
            return "mp3"
        if "audio/wav" in content_type:
            return "wav"
        
        # URL uzantısından tahmin et
        path = url.split("?")[0]
        if "." in path:
            return path.split(".")[-1].lower()
            
        return "bin"

media_storage = MediaStorageService()

