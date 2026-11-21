import { lookup } from "node:dns/promises";
import net from "node:net";

function isPrivateIpv4(ip: string): boolean {
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

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    return isPrivateIpv4(ip);
  }
  const lower = ip.toLowerCase();
  if (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80")
  ) {
    return true;
  }
  // IPv4-mapped IPv6 dotted form: ::ffff:127.0.0.1, ::ffff:172.16.0.1, etc.
  if (lower.startsWith("::ffff:")) {
    const tail = lower.slice("::ffff:".length);
    if (net.isIPv4(tail)) return isPrivateIpv4(tail);
    // Hex-encoded IPv4-mapped IPv6 form: ::ffff:7f00:1 -> 127.0.0.1
    const hexMatch = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
    if (hexMatch) {
      const hi = parseInt(hexMatch[1]!, 16);
      const lo = parseInt(hexMatch[2]!, 16);
      const mappedV4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isPrivateIpv4(mappedV4);
    }
    return true;
  }
  return false;
}

/**
 * SSRF koruması: Yalnızca izinli şema (varsayılan HTTPS; allowHttp ile HTTP/HTTPS) ve genel (public)
 * IP adreslerine çözümlenen dış URL'lere izin verir; loopback, RFC1918, IPv4-mapped IPv6 ve AWS IMDS engellenir.
 */
export async function assertSafeOutboundUrl(rawUrl: string, opts?: { allowHttp?: boolean }): Promise<URL> {
  const parsed = new URL(rawUrl);
  const allowedProtocols = opts?.allowHttp ? ["https:", "http:"] : ["https:"];
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(opts?.allowHttp ? "Yalnızca HTTP veya HTTPS adreslerine izin verilir." : "Yalnızca HTTPS harici adreslerine izin verilir.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URL içinde kullanıcı bilgisi bulunamaz.");
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  ) {
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
