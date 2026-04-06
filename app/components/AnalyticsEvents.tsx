"use client";

import { useEffect, useRef } from "react";
import { captureSimulatorLoaded, captureResultsViewed } from "@/lib/analytics";

const SIMULATOR_VERSION = "1.0.0";

export default function AnalyticsEvents() {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    captureSimulatorLoaded({ simulator_version: SIMULATOR_VERSION });

    // Fire results_viewed when the probability table becomes visible
    const table = document.querySelector("[data-analytics='probability-table']");
    if (table) {
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            captureResultsViewed({
              result_type: "probability_comparison",
              preset_name: "default",
              simulator_version: SIMULATOR_VERSION,
            });
            observer.disconnect();
          }
        },
        { threshold: 0.3 },
      );
      observer.observe(table);
      return () => observer.disconnect();
    }
  }, []);

  return null;
}
