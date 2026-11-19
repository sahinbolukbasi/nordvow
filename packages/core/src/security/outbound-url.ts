import { lookup } from "node:dns/promises";
import net from "node:net";

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const lower = ip.toLowerCase();
  return (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80") ||
    lower.startsWith("::ffff:127.") ||
    lower.startsWith("::ffff:10.") ||
    lower.startsWith("::ffff:169.254.") ||
    lower.startsWith("::ffff:192.168.")
  );
}

/**
 * SSRF koruması: Yalnızca HTTPS (veya izinli şema) ve genel (public) IP adreslerine
 * çözümlenen dış URL'lere izin verir; loopback, RFC1918 ve AWS IMDS (169.254.169.254) engellenir.
 */
export async function assertSafeOutboundUrl(rawUrl: string): Promise<URL> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:") {
    throw new Error("Yalnızca HTTPS harici adreslerine izin verilir.");
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Dahili alan adlarına istek yasaktır.");
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("Özel IP adreslerine istek yasaktır.");
    return parsed;
  }
  const records = await lookup(host, { all: true });
  if (!records.length || records.some((r) => isPrivateIp(r.address))) {
    throw new Error("Özel veya dahili ağ adreslerine istek yasaktır.");
  }
  return parsed;
}
