/**
 * Central API client for backend (auth and future APIs).
 * - baseURL from VITE_API_BASE_URL (e.g. http://localhost:5000/api/v1)
 * - Implements industry-standard specialized clients for User, Restaurant, Delivery, and Admin.
 */

import axios from "axios";
import { readStoredZoneContext } from "@food/utils/locationPersistence";
import { clearModuleAuth, getModuleRefreshToken, getModuleToken, setModuleAccessToken } from "@food/utils/auth";

// Prefer explicit env. If not set, default to /api/v1 so the Vite proxy can forward to backend.
const baseURL =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL
    ? String(import.meta.env.VITE_API_BASE_URL).replace(/\/$/, "")
    : "/api/v1";

/** 
 * Common Helpers 
 */

function getAccessToken(module) {
  try {
    const moduleToken = getModuleToken(module);
    if (moduleToken) return moduleToken;

    if (module === "user") {
      return localStorage.getItem("accessToken") || null;
    }
    return null;
  } catch {
    return null;
  }
}

function getRefreshToken(module) {
  try {
    const moduleRefreshToken = getModuleRefreshToken(module);
    if (moduleRefreshToken) return moduleRefreshToken;

    if (module === "user") {
      return localStorage.getItem("refreshToken") || null;
    }
    return null;
  } catch {
    return null;
  }
}

function clearStoredModuleAuth(module) {
  try {
    clearModuleAuth(module);
  } catch (_) {}
}

/**
 * Global Error Formatter
 * Converts raw technical errors (like 401, 500, AxiosError) into user-friendly messages.
 */
function formatApiError(err) {
  if (err?.response) {
    const status = err.response.status;
    const responseData = err.response.data;
    const backendMessage =
      responseData && typeof responseData === "object" && !Array.isArray(responseData)
        ? responseData.message
        : null;

    // Default to the message provided by backend when it is a structured JSON payload.
    let friendlyMessage = backendMessage || err.message;

    // Check if the backend message is generic or raw technical.
    const isGeneric =
      !backendMessage ||
      friendlyMessage.includes("AxiosError") ||
      friendlyMessage.includes("Request failed with status code") ||
      friendlyMessage.includes("Unexpected token") ||
      friendlyMessage.includes("<html");

    // Only override if the backend didn't provide a specific, useful message.
    if (isGeneric) {
      if (status === 400) friendlyMessage = "Invalid request. Please check your inputs.";
      else if (status === 401) friendlyMessage = "Unauthorized. Please login again.";
      else if (status === 403) friendlyMessage = "Access denied. You don't have permission.";
      else if (status === 404) friendlyMessage = "Requested data not found.";
      else if (status === 429) friendlyMessage = "Too many requests. Please wait a moment.";
      else if (status === 502) friendlyMessage = "Server is temporarily unavailable. Please try again in a moment.";
      else if (status >= 500) friendlyMessage = "Server error. Please try again later.";
      else friendlyMessage = "An unexpected error occurred.";
    }

    // Normalize response data so downstream UI code can always read .message safely.
    if (!responseData || typeof responseData !== "object" || Array.isArray(responseData)) {
      err.response.data = { message: friendlyMessage, raw: responseData };
    } else {
      err.response.data.message = friendlyMessage;
    }

    err.message = friendlyMessage;
  } else if (err?.request) {
    err.message = "Network error. Please check your internet connection.";
  } else {
    err.message = "An unexpected error occurred.";
  }
  return err;
}

/**
 * Factory to create role-specific API clients.
 * Benefit: Isolation of tokens, refresh logic, and error handling.
 */
function createModuleClient(moduleName) {
  const client = axios.create({
    baseURL: baseURL || undefined,
    timeout: 30000,
    headers: { "Content-Type": "application/json" },
  });

  let isRefreshing = false;
  let subscribers = [];

  const subscribeToRefresh = (cb) => subscribers.push(cb);
  const onRefreshed = (newToken) => {
    subscribers.forEach((cb) => cb(newToken));
    subscribers = [];
  };

  const onRefreshFailed = () => {
    clearStoredModuleAuth(moduleName);
    subscribers.forEach((cb) => cb(null));
    subscribers = [];
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("authRefreshFailed", { detail: { module: moduleName } }));
    }
  };

  // Request Interceptor
  client.interceptors.request.use(
    (config) => {
      config.contextModule = moduleName;
      
      // FormData handling
      if (config.data instanceof FormData) {
        if (config.headers && config.headers["Content-Type"]) {
          delete config.headers["Content-Type"];
        }
      }

      const token = getAccessToken(moduleName);
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      // Automatically inject Zone ID and Coordinates for user/public endpoints
      if (moduleName === "user" || moduleName === "public") {
        const { zoneId, latitude, longitude } = readStoredZoneContext();
        const lat = latitude != null ? String(latitude) : null;
        const lng = longitude != null ? String(longitude) : null;
        if (zoneId) {
          config.headers["X-Zone-Id"] = zoneId;
        }
        if (lat && lng) {
          config.headers["X-User-Lat"] = lat;
          config.headers["X-User-Lng"] = lng;
        }
      }

      return config;
    },
    (err) => Promise.reject(err)
  );

  // Response Interceptor
  client.interceptors.response.use(
    (response) => response,
    async (err) => {
      const original = err?.config;
      
      if (err?.response?.status === 429) return Promise.reject(err);
      
      // 403 handling (Forbidden vs Unauthorized)
      if (err?.response?.status === 403) {
        // Token is valid but wrong role. Don't logout, just deny access.
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("accessDenied", { detail: { module: moduleName } }));
        }
        return Promise.reject(formatApiError(err));
      }

      // 401 handling (Unauthorized / Expired)
      if (err?.response?.status !== 401 || !original || original._retry) {
        return Promise.reject(formatApiError(err));
      }

      const refreshToken = getRefreshToken(moduleName);
      if (!refreshToken) {
        onRefreshFailed();
        return Promise.reject(formatApiError(err));
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          subscribeToRefresh((newToken) => {
            if (newToken) {
              original.headers.Authorization = `Bearer ${newToken}`;
              resolve(client(original));
            } else {
              reject(formatApiError(err));
            }
          });
        });
      }

      original._retry = true;
      isRefreshing = true;

      try {
        const refreshUrl = baseURL ? `${baseURL}/food/auth/refresh-token` : "/api/v1/food/auth/refresh-token";
        const { data } = await axios.post(refreshUrl, { refreshToken }, { timeout: 10000 });
        const newAccessToken = data?.data?.accessToken || data?.accessToken;

        if (newAccessToken) {
          setModuleAccessToken(moduleName, newAccessToken);
          window.dispatchEvent(new CustomEvent("authRefreshed", { 
            detail: { module: moduleName, token: newAccessToken } 
          }));
          onRefreshed(newAccessToken);
          original.headers.Authorization = `Bearer ${newAccessToken}`;
          return client(original);
        }
      } catch (_) {
        onRefreshFailed();
        return Promise.reject(formatApiError(err));
      } finally {
        isRefreshing = false;
      }

      onRefreshFailed();
      return Promise.reject(formatApiError(err));
    }
  );

  return client;
}

/**
 * Specialized Clients
 * Export these for use in index.js to ensure strict role isolation.
 */
export const userClient = createModuleClient("user");
export const restaurantClient = createModuleClient("restaurant");
export const deliveryClient = createModuleClient("delivery");
export const adminClient = createModuleClient("admin");

/**
 * Legacy Smart Client
 * Maintained for backward compatibility and shared services.
 */
const apiClient = axios.create({
  baseURL: baseURL || undefined,
  timeout: 30000,
  headers: { "Content-Type": "application/json" },
});

// Reuse the existing smart detection for the legacy client
function getModuleFromUrl(url = "") {
  const u = typeof url === "string" ? url : (url?.url || "");
  if (!u) return "user";
  const normalized = u.toLowerCase();
  if (normalized.includes("/admin/") || normalized.includes("/food/admin/")) return "admin";
  if (normalized.includes("/food/delivery") || normalized.includes("/delivery/")) return "delivery";
  if (normalized.includes("/food/restaurant/") || normalized.includes("/restaurant/")) return "restaurant";
  return "user";
}

apiClient.interceptors.request.use(
  (config) => {
    // FormData handling
    if (config.data instanceof FormData) {
      if (config.headers && config.headers["Content-Type"]) {
        delete config.headers["Content-Type"];
      }
    }

    const module = config.contextModule || getModuleFromUrl(config.url);
    const token = getAccessToken(module);
    if (token) config.headers.Authorization = `Bearer ${token}`;

    // Automatically inject Zone ID and Coordinates for user/public endpoints
    if (module === "user" || module === "public" || module === "delivery") {
      const { zoneId, latitude, longitude } = readStoredZoneContext();
        const lat = latitude != null ? String(latitude) : null;
        const lng = longitude != null ? String(longitude) : null;
      if (zoneId) {
        config.headers["X-Zone-Id"] = zoneId;
      }
      if (lat && lng) {
        config.headers["X-User-Lat"] = lat;
        config.headers["X-User-Lng"] = lng;
      }
    }

    return config;
  },
  (err) => Promise.reject(err)
);

// Response Interceptor for Legacy Client
apiClient.interceptors.response.use(
  (response) => response,
  (err) => {
    return Promise.reject(formatApiError(err));
  }
);

export default apiClient;



