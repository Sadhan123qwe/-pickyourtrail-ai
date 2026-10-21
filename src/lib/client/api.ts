"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Fetch wrapper for our JSON API. The server is the source of truth for all persisted data. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = init.method ?? (init.body !== undefined ? "POST" : "GET");
  // Any write may change what GETs return: drop the short-lived read cache.
  if (method !== "GET") clearApiCache();
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: "same-origin",
      signal: init.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiClientError("Can't reach the server. Check your connection and try again.", 0, "network_error");
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const err = data?.error;
    const detail = Array.isArray(err?.details) && err.details[0]?.message ? `: ${err.details[0].message}` : "";
    throw new ApiClientError((err?.message ?? `Request failed (${res.status})`) + (err?.code === "validation_error" ? detail : ""), res.status, err?.code ?? "error", err?.details);
  }
  return data as T;
}

/* ---- Read de-duplication, bounded retry and a short in-memory cache ----
 * Per browser tab only (never persisted, cleared on sign-out and on any write),
 * so one customer's data is never served to another session. */

const inflight = new Map<string, Promise<unknown>>();
const cache = new Map<string, { at: number; data: unknown }>();
const CACHE_TTL_MS = 30_000;

export function clearApiCache() {
  cache.clear();
}

const TRANSIENT = new Set([0, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET with in-flight de-duplication and up to 2 retries (with backoff) for transient failures only. */
export function getJson<T>(path: string): Promise<T> {
  const existing = inflight.get(path);
  if (existing) return existing as Promise<T>;
  const p = (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const data = await api<T>(path);
        cache.set(path, { at: Date.now(), data });
        return data;
      } catch (e) {
        if (attempt >= 2 || !(e instanceof ApiClientError) || !TRANSIENT.has(e.status)) throw e;
        await sleep(300 * 3 ** attempt);
      }
    }
  })().finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

function cached<T>(path: string): T | undefined {
  const hit = cache.get(path);
  return hit && Date.now() - hit.at < CACHE_TTL_MS ? (hit.data as T) : undefined;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

/**
 * GET with loading / error / reload state. Shows recently fetched data instantly
 * (stale-while-revalidate), shares identical in-flight requests, and ignores
 * responses for a path that is no longer current.
 */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(() => (path ? (cached<T>(path) ?? null) : null));
  const [error, setError] = useState<ApiClientError | Error | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const [tick, setTick] = useState(0);
  const current = useRef<string | null>(null);

  useEffect(() => {
    if (!path) return;
    const key = `${path}#${tick}`;
    current.current = key;
    const stale = tick === 0 ? cached<T>(path) : undefined;
    // State resets happen in a microtask so the effect body itself doesn't set state synchronously.
    queueMicrotask(() => {
      if (current.current !== key) return;
      if (stale !== undefined) setData(stale);
      setLoading(stale === undefined);
      setError(null);
    });
    getJson<T>(path)
      .then((d) => {
        if (current.current === key) setData(d);
      })
      .catch((e) => {
        if (current.current === key && (e as Error).name !== "AbortError") setError(e);
      })
      .finally(() => {
        if (current.current === key) setLoading(false);
      });
    return () => {
      if (current.current === key) current.current = null;
    };
  }, [path, tick]);

  const reload = useCallback(() => {
    if (path) cache.delete(path);
    setTick((t) => t + 1);
  }, [path]);
  return { data, setData, error, loading, reload };
}

export function newClientId(prefix = "c"): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
