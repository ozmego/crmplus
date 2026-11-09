"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Arka plan işi sürerken sayfayı belirli aralıkla yeniler. */
export function AutoRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const h = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(h);
  }, [router, seconds]);
  return null;
}
