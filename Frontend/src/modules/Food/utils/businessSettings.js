/**
 * Business Settings Utility
 * Handles loading and updating business settings (favicon, title, logo)
 */

import { API_ENDPOINTS, API_BASE_URL } from "@food/api/config";
import { publicGetOnce } from "@food/api";
import {
  readScopedCachedValue,
  removeScopedValue,
  writeScopedCachedValue,
} from "./appStorage";

const SETTINGS_SCOPE = 'settings';
const DEFAULT_FAVICON_PATH = '/favicon.ico';
const SETTINGS_KEY = 'business';
const SETTINGS_TTL_MS = 6 * 60 * 60 * 1000;

const normalizeUrl = (url) => {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('http')) return url;

  let backendOrigin = '';
  if (API_BASE_URL && API_BASE_URL.startsWith('http')) {
    backendOrigin = API_BASE_URL.replace(/\/api(\/v\d+)?\/?$/i, '').replace(/\/+$/, '');
  } else if (typeof window !== 'undefined') {
    backendOrigin = window.location.origin;
  } else {
    backendOrigin = 'http://localhost:5000';
  }

  return `${backendOrigin}${url.startsWith('/') ? '' : '/'}${url}`;
};

export const normalizeSettingsUrls = (settings) => {
  if (!settings) return settings;
  const newSettings = { ...settings };
  if (newSettings.logo?.url) {
    newSettings.logo = { ...newSettings.logo, url: normalizeUrl(newSettings.logo.url) };
  }
  if (newSettings.favicon?.url) {
    newSettings.favicon = { ...newSettings.favicon, url: normalizeUrl(newSettings.favicon.url) };
  }
  if (newSettings.termsAndConditionsPdf?.url) {
    newSettings.termsAndConditionsPdf = { ...newSettings.termsAndConditionsPdf, url: normalizeUrl(newSettings.termsAndConditionsPdf.url) };
  }
  return newSettings;
};

const readLegacySettings = () => {
  try {
    const saved = localStorage.getItem('food_business_settings');
    return saved ? JSON.parse(saved) : null;
  } catch (_) {
    return null;
  }
};

const migrateLegacySettings = () => {
  const cached = readScopedCachedValue(SETTINGS_SCOPE, SETTINGS_KEY);
  if (cached) return cached;

  const legacy = readLegacySettings();
  if (!legacy) return null;

  const normalized = normalizeSettingsUrls(legacy);
  writeScopedCachedValue(SETTINGS_SCOPE, SETTINGS_KEY, normalized, { ttlMs: SETTINGS_TTL_MS });
  try {
    localStorage.removeItem('food_business_settings');
  } catch (_) {}
  return normalized;
};

let cachedSettings = migrateLegacySettings() || null;

if (cachedSettings) {
  setTimeout(() => {
    updateFavicon(cachedSettings.favicon?.url);
    updateTitle(cachedSettings.companyName);
  }, 0);
}

let inFlightSettingsPromise = null;

export const loadBusinessSettings = async () => {
  try {
    const endpoint = API_ENDPOINTS.ADMIN.BUSINESS_SETTINGS_PUBLIC;
    if (!endpoint || (typeof endpoint === 'string' && !endpoint.trim())) {
      return cachedSettings;
    }

    if (inFlightSettingsPromise) {
      return await inFlightSettingsPromise;
    }

    inFlightSettingsPromise = (async () => {
      const response = await publicGetOnce(endpoint, { noCache: true });
      const rawSettings = response?.data?.data || response?.data;

      if (rawSettings) {
        const settings = normalizeSettingsUrls(rawSettings);
        cachedSettings = settings;
        writeScopedCachedValue(SETTINGS_SCOPE, SETTINGS_KEY, settings, { ttlMs: SETTINGS_TTL_MS });

        updateFavicon(settings.favicon?.url);
        updateTitle(settings.companyName);
        return settings;
      }
      return cachedSettings;
    })();

    return await inFlightSettingsPromise;
  } catch (_) {
    return cachedSettings;
  } finally {
    inFlightSettingsPromise = null;
  }
};

export const updateFavicon = (url) => {
  if (typeof document === 'undefined') return;

  const resolvedUrl = typeof url === 'string' && url.trim() ? url.trim() : DEFAULT_FAVICON_PATH;
  const fallbackUrl = `${window.location.origin}${DEFAULT_FAVICON_PATH}`;

  const existingFavicons = document.querySelectorAll("link[rel*='icon']");
  existingFavicons.forEach((el) => el.remove());

  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/png';
  link.href = resolvedUrl;
  link.crossOrigin = 'anonymous';
  link.addEventListener('error', () => {
    if (link.href !== fallbackUrl) {
      link.href = fallbackUrl;
    }
  }, { once: true });
  document.head.appendChild(link);
};

export const updateTitle = (companyName) => {
  if (companyName && typeof document !== 'undefined') {
    document.title = companyName;
  }
};

export const setCachedSettings = (settings) => {
  if (settings) {
    const normalizedSettings = normalizeSettingsUrls(settings);
    cachedSettings = normalizedSettings;
    writeScopedCachedValue(SETTINGS_SCOPE, SETTINGS_KEY, normalizedSettings, { ttlMs: SETTINGS_TTL_MS });

    updateFavicon(normalizedSettings.favicon?.url);
    updateTitle(normalizedSettings.companyName);
  }
};

export const clearCache = () => {
  cachedSettings = null;
  removeScopedValue(SETTINGS_SCOPE, SETTINGS_KEY);
};

export const getCachedSettings = () => cachedSettings;

export const getCompanyName = () => {
  const settings = getCachedSettings();
  return settings?.companyName || 'Tuggo Food Delivery';
};

export const getCompanyNameAsync = async () => {
  try {
    const settings = await loadBusinessSettings();
    return settings?.companyName || 'Tuggo Food Delivery';
  } catch (_) {
    return 'Tuggo Food Delivery';
  }
};

