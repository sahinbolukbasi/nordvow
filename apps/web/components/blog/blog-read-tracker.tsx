"use client";

import { useEffect, useRef } from "react";

/**
 * Blog yazısı görüntülendiğinde "view" olayını, kullanıcı yazının %60'ını kaydırdığında
 * veya 15 saniyeden uzun kaldığında okuma süresiyle birlikte "read" olayını kaydeder.
 */
export function BlogReadTracker({ slug }: { slug: string }) {
  const startedAtRef = useRef<number>(Date.now());
  const readSentRef = useRef(false);

  useEffect(() => {
    startedAtRef.current = Date.now();
    readSentRef.current = false;

    fetch(`/api/blog/${encodeURIComponent(slug)}/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "view" }),
      keepalive: true,
    }).catch(() => {});

    const sendRead = () => {
      if (readSentRef.current) return;
      readSentRef.current = true;
      const durationSeconds = Math.max(
        1,
        Math.round((Date.now() - startedAtRef.current) / 1000),
      );
      const payload = JSON.stringify({ event: "read", durationSeconds });
      const url = `/api/blog/${encodeURIComponent(slug)}/track`;
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
      } else {
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    };

    const timer = window.setTimeout(sendRead, 15_000);

    const onScroll = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      if (scrollable <= 0) return;
      const ratio = window.scrollY / scrollable;
      if (ratio >= 0.6) {
        sendRead();
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, [slug]);

  return null;
}

