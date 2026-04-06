import posthog from "posthog-js";

const SITE_NAME = "eventrisk" as const;

// --- Event name constants ---

export const EventNames = {
  PAPER_CTA_CLICKED: "paper_cta_clicked",
  PAPER_PDF_OPENED: "paper_pdf_opened",
  EXTERNAL_LINK_CLICKED: "external_link_clicked",
  CONTACT_CTA_CLICKED: "contact_cta_clicked",
  SIMULATOR_LOADED: "simulator_loaded",
  PRESET_SELECTED: "preset_selected",
  PARAMETER_CHANGED: "parameter_changed",
  SIMULATION_RUN: "simulation_run",
  RESULTS_VIEWED: "results_viewed",
} as const;

type EventName = (typeof EventNames)[keyof typeof EventNames];

// --- Page type resolution ---

function getPageType(): string {
  const path = window.location.pathname;
  if (path === "/") return "simulator";
  return "other";
}

// --- UTM helpers ---

function getUtmParams(): Record<string, string> {
  const params = new URLSearchParams(window.location.search);
  const utm: Record<string, string> = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign"] as const) {
    const val = params.get(key);
    if (val) utm[key] = val;
  }
  return utm;
}

// --- Global property enrichment ---

function globalProps(extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    site_name: SITE_NAME,
    page_type: getPageType(),
    current_path: window.location.pathname,
    current_url: window.location.href,
    referrer: document.referrer || undefined,
    ...getUtmParams(),
    ...extra,
  };
}

// --- Init ---

let initialized = false;

export function initPostHog() {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
  if (!key || initialized) return;

  posthog.init(key, {
    api_host: host,
    capture_pageview: false, // we handle pageviews manually for Next.js App Router
    capture_pageleave: true,
    persistence: "localStorage+cookie",
  });
  initialized = true;
}

// --- Pageview (call on route change) ---

export function capturePageview() {
  if (!initialized) return;
  posthog.capture("$pageview", globalProps({ $current_url: window.location.href }));
}

// --- Generic custom event ---

export function captureEvent(name: EventName, props?: Record<string, unknown>) {
  if (!initialized) return;
  posthog.capture(name, globalProps(props));
}

// --- Debounce utility for noisy events ---

const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};

export function captureDebouncedEvent(
  name: EventName,
  props?: Record<string, unknown>,
  delayMs = 1000,
) {
  const key = `${name}_${JSON.stringify(props?.parameter_name ?? "")}`;
  clearTimeout(debounceTimers[key]);
  debounceTimers[key] = setTimeout(() => {
    captureEvent(name, props);
  }, delayMs);
}

// --- Typed helpers ---

export function captureSimulatorLoaded(props: {
  simulator_version: string;
}) {
  captureEvent(EventNames.SIMULATOR_LOADED, props);
}

export function capturePresetSelected(props: {
  preset_name: string;
  preset_category: string;
  simulator_version: string;
}) {
  captureEvent(EventNames.PRESET_SELECTED, props);
}

export function captureParameterChanged(props: {
  parameter_name: string;
  parameter_value: string | number;
  simulator_version: string;
}) {
  captureDebouncedEvent(EventNames.PARAMETER_CHANGED, props);
}

export function captureSimulationRun(props: {
  preset_name: string;
  simulator_version: string;
  parameter_snapshot: Record<string, unknown>;
}) {
  captureEvent(EventNames.SIMULATION_RUN, props);
}

export function captureResultsViewed(props: {
  result_type: string;
  preset_name: string;
  simulator_version: string;
}) {
  captureEvent(EventNames.RESULTS_VIEWED, props);
}

export function capturePaperCtaClicked(props: {
  destination_url: string;
  cta_label: string;
  cta_location: string;
}) {
  captureEvent(EventNames.PAPER_CTA_CLICKED, props);
}

export function capturePaperPdfOpened(props: {
  pdf_url: string;
  trigger_location: string;
}) {
  captureEvent(EventNames.PAPER_PDF_OPENED, props);
}

export function captureExternalLinkClicked(props: {
  destination_url: string;
  link_label: string;
  link_location: string;
}) {
  captureEvent(EventNames.EXTERNAL_LINK_CLICKED, props);
}

export function captureContactCtaClicked(props: {
  destination_url: string;
  cta_label: string;
  cta_location: string;
}) {
  captureEvent(EventNames.CONTACT_CTA_CLICKED, props);
}
