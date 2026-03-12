/**
 * tests/test_phase3_reliability.mjs
 * Targeted reliability tests for API retry semantics and fallback state recovery.
 * Run with: node tests/test_phase3_reliability.mjs
 */

import { createApiClient, ApiError, resolveApiBaseUrls } from "../static/scripts/api-client.mjs";
import { applyViewState } from "../static/scripts/view-state.mjs";

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${label}`);
    failed += 1;
    failures.push(label);
  }
}

function suite(name, fn) {
  return async () => {
    console.log(`\n${name}`);
    await fn();
  };
}

function createView() {
  const detail = { textContent: "" };
  return {
    skeleton: { hidden: false },
    plot: { hidden: true },
    error: {
      hidden: true,
      querySelector(selector) {
        return selector === ".chart-error-detail" ? detail : null;
      },
    },
    detail,
  };
}

const suites = [
  suite("resolveApiBaseUrls prefers same-origin and keeps one fallback", async () => {
    const urls = resolveApiBaseUrls({
      locationOrigin: "https://eventrisk.ai",
      fallbackBaseUrl: "https://market-hedge-simulator.replit.app",
    });
    assert(urls.length === 2, "bounded to one retry candidate");
    assert(urls[0] === "https://eventrisk.ai", "same-origin chosen as primary");
    assert(urls[1] === "https://market-hedge-simulator.replit.app", "fallback kept as retry");
  }),

  suite("transport failure retries once and then succeeds", async () => {
    const calls = [];
    const client = createApiClient({
      locationOrigin: "https://eventrisk.ai",
      fallbackBaseUrl: "https://market-hedge-simulator.replit.app",
      fetchImpl: async (url) => {
        calls.push(url);
        if (calls.length === 1) {
          throw new Error("socket hang up");
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const payload = await client.fetchJson("/api/example");
    assert(payload.ok === true, "retry returns successful payload");
    assert(calls.length === 2, "one retry performed");
    assert(calls[0] === "https://eventrisk.ai/api/example", "primary attempt used same-origin");
    assert(calls[1] === "https://market-hedge-simulator.replit.app/api/example", "retry used fallback host");
  }),

  suite("validation errors do not retry", async () => {
    let callCount = 0;
    const client = createApiClient({
      locationOrigin: "https://eventrisk.ai",
      fallbackBaseUrl: "https://market-hedge-simulator.replit.app",
      fetchImpl: async () => {
        callCount += 1;
        return new Response(JSON.stringify({ detail: "invalid payload" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        });
      },
    });

    let caught = null;
    try {
      await client.fetchJson("/api/example", { method: "POST", body: JSON.stringify({}) });
    } catch (error) {
      caught = error;
    }

    assert(caught instanceof ApiError, "throws ApiError");
    assert(caught?.kind === "validation", "4xx classified as validation");
    assert(callCount === 1, "validation failure is not retried");
  }),

  suite("view-state transitions clear fallback on success", async () => {
    const view = createView();

    applyViewState(view, "loading");
    assert(view.skeleton.hidden === false, "loading shows skeleton");
    assert(view.error.hidden === true, "loading hides error");
    assert(view.plot.hidden === true, "loading hides plot");

    applyViewState(view, "error", "backend down");
    assert(view.skeleton.hidden === true, "error hides skeleton");
    assert(view.error.hidden === false, "error shows message");
    assert(view.detail.textContent === "backend down", "error detail rendered");

    applyViewState(view, "ready");
    assert(view.skeleton.hidden === true, "success keeps skeleton hidden");
    assert(view.error.hidden === true, "success clears error state");
    assert(view.plot.hidden === false, "success reveals plot");
    assert(view.detail.textContent === "", "success clears stale error detail");
  }),
];

console.log("=== test_phase3_reliability.mjs ===");
for (const run of suites) {
  await run();
}

console.log(`\n${"=".repeat(42)}`);
if (failed === 0) {
  console.log(`PASSED  ${passed}/${passed + failed} assertions`);
} else {
  console.log(`FAILED  ${failed} / ${passed + failed} assertions`);
  failures.forEach((failure) => console.log(`  ✗ ${failure}`));
  process.exit(1);
}
