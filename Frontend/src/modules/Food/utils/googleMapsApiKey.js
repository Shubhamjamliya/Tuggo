/**
 * Google Maps API Key — build-time env + runtime public API (admin DB / backend .env).
 * Works in Vite web dev, production web, and mobile WebView shells.
 */

import { useEffect, useState } from "react";
let cachedApiKey = null;

function sanitizeApiKey(value) {
  if (!value) return "";
  return String(value).trim().replace(/^['"]|['"]$/g, "");
}

function getBuildTimeKey() {
  return sanitizeApiKey(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);
}

/**
 * Resolve Google Maps API key (cached).
 * Directly uses build-time Vite env (import.meta.env.VITE_GOOGLE_MAPS_API_KEY).
 */
export async function getGoogleMapsApiKey() {
  if (cachedApiKey) return cachedApiKey;

  const buildKey = getBuildTimeKey();
  cachedApiKey = buildKey || "";
  return cachedApiKey;
}

/** Sync peek — only returns build-time key; prefer async getGoogleMapsApiKey(). */
export function getGoogleMapsApiKeySync() {
  return cachedApiKey || getBuildTimeKey();
}

export function clearGoogleMapsApiKeyCache() {
  cachedApiKey = null;
  fetchPromise = null;
}

/** Whether maps can be enabled (build-time or after async fetch). */
export function isGoogleMapsConfigured() {
  return Boolean(getGoogleMapsApiKeySync());
}

/** React hook for @react-google-maps/api — resolves API key in web & mobile WebView. */
export function useGoogleMapsApiKey() {
  const [apiKey, setApiKey] = useState(() => getGoogleMapsApiKeySync());

  useEffect(() => {
    let cancelled = false;
    getGoogleMapsApiKey().then((key) => {
      if (!cancelled && key) setApiKey(key);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return apiKey;
}
