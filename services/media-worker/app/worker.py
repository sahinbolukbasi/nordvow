import asyncio
import json
import logging
from app.core.config import settings
from app.domain.models import MediaJobPayload
from app.router.media_router import media_router

logger = logging.getLogger("nordvow.queue.worker")

class QueueWorker:
    """
    Asenkron İş Kuyruğu Tüketicisi (AWS SQS / Redis Streams)
    Node.js API'den gelen medya üretim işlerini dinler, Media Router'a iletir
    ve sonuçları veri tabanına işleyerek krediyi finalize eder.
    """
    def __init__(self):
        self.is_running = False

    async def start(self):
        self.is_running = True
        logger.info("Nordvow Media Worker iş kuyruğu dinleyicisi başlatıldı...")

        while self.is_running:
            try:
                # AWS SQS veya Redis kuyruğundan mesaj çekme döngüsü
                await asyncio.sleep(1.0)
            except Exception as e:
                logger.error(f"Kuyruk işleme hatası: {e}")
                await asyncio.sleep(2.0)

    def stop(self):
        self.is_running = False
        logger.info("Worker durduruluyor...")

worker = QueueWorker()

if __name__ == "__main__":
    asyncio.run(worker.start())

