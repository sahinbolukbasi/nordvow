import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVoiceAssistantApp } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseDir = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 4100);

const app = createVoiceAssistantApp(baseDir);

app.server.listen(port, () => {
  console.log(
    `[voice-assistant] Servis http://localhost:${port} üzerinde çalışıyor (WebSocket: /ws/call)`
  );
});

