import test from "node:test";
import assert from "node:assert/strict";

import { ApiError, createApiClient, resolveApiBaseUrl } from "../static/scripts/api-client.mjs";

test("resolveApiBaseUrl prefers explicit override, then runtime config, then same-origin", () => {
  assert.equal(
    resolveApiBaseUrl({
      baseUrl: "https://api.eventrisk.ai/",
      runtimeConfig: { apiBaseUrl: "https://ignored.example" },
      locationOrigin: "https://app.example",
    }),
    "https://api.eventrisk.ai",
  );
  assert.equal(
    resolveApiBaseUrl({
      runtimeConfig: { apiBaseUrl: "https://runtime.example/" },
      locationOrigin: "https://app.example",
    }),
    "https://runtime.example",
  );
  assert.equal(resolveApiBaseUrl({ locationOrigin: "https://app.example/" }), "https://app.example");
});

test("api client surfaces HTTP failures with status and detail", async () => {
  const client = createApiClient({
    baseUrl: "https://example.test",
    fetchImpl: async () =>
      new Response(JSON.stringify({ detail: "Bad request" }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
  });

  await assert.rejects(
    () => client.fetchDistribution({ liability: 1, liquidity: 1, hedgeFraction: 0.5 }),
    (error) => error instanceof ApiError && error.kind === "http" && error.status === 422 && error.message === "Bad request",
  );
});

test("api client maps aborted requests to a clean timeout error", async () => {
  const client = createApiClient({
    baseUrl: "https://example.test",
    timeoutMs: 5,
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
  });

  await assert.rejects(
    () => client.fetchInteractiveCurve({ liability: 5_000_000, liquidity: 2_000_000 }),
    (error) => error instanceof ApiError && error.kind === "timeout" && error.message.includes("15 seconds"),
  );
});

test("api client maps network failures to a clean network error", async () => {
  const client = createApiClient({
    baseUrl: "https://example.test",
    fetchImpl: async () => {
      throw new Error("connect ECONNREFUSED");
    },
  });

  await assert.rejects(
    () => client.fetchFrontier({ liability: 5_000_000, liquidity: 2_000_000, hedgeFraction: 0.4 }),
    (error) => error instanceof ApiError && error.kind === "network" && error.message === "Unable to reach the simulation API.",
  );
});
