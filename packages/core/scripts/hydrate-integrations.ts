/**
 * Konteyner girişinde çağrılır. Dolan anahtarları kabuk dosyasına yazar; değerleri loglamaz.
 *   npx tsx packages/core/scripts/hydrate-integrations.ts --write /tmp/nv-integrations.env
 */
import { writeFileSync } from "node:fs";
import { hydrateIntegrations, shellAssign } from "../src/secrets/integrations";

const fileIdx = process.argv.indexOf("--write");
const target = fileIdx >= 0 ? process.argv[fileIdx + 1] : "";

const result = await hydrateIntegrations();
if (target) {
  const lines = result.filledKeys.map((key) => shellAssign(key, process.env[key] ?? ""));
  writeFileSync(target, lines.length ? `${lines.join("\n")}\n` : "", { mode: 0o600 });
}
if (result.skipped) console.log(`integrations sirri atlandi (${result.reason ?? "bilinmiyor"})`);
else console.log(`integrations sirri: ${result.filledKeys.length} anahtar ortama alindi`);
