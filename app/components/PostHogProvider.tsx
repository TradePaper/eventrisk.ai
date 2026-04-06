"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { initPostHog, capturePageview } from "@/lib/analytics";

export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const initialized = useRef(false);
  const prevPath = useRef<string | null>(null);

  useEffect(() => {
    if (!initialized.current) {
      initPostHog();
      initialized.current = true;
    }
  }, []);

  useEffect(() => {
    if (prevPath.current !== pathname) {
      capturePageview();
      prevPath.current = pathname;
    }
  }, [pathname]);

  return <>{children}</>;
}
