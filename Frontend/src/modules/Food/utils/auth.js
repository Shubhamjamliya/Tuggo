import { readScopedValue, removeScopedValue, writeScopedValue } from "@food/utils/appStorage";

function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") return null;

  try {
    const [, payload] = token.split(".");
    if (!payload) return null;

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function isTokenExpired(token) {
  const payload = decodeJwtPayload(token);

  if (!payload) return true;

  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp <= 0) return false;

  return exp * 1000 <= Date.now();
}

/**
 * Check if user has access to a module based on role
 * @param {string} role - User role
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 * @returns {boolean} - True if user has access
 */
export function hasModuleAccess(role, module) {
  const roleModuleMap = {
    'admin': 'admin',
    'restaurant': 'restaurant',
    'delivery': 'delivery',
    'user': 'user'
  };

  return roleModuleMap[role] === module;
}

/**
 * Get module-specific access token
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 * @returns {string|null} - Access token or null
 */
export function getModuleToken(module) {
  const scoped = readScopedValue("auth", `${module}:accessToken`, { fallback: null });
  if (scoped !== null && scoped !== undefined && scoped !== "") return scoped;
  try {
    return localStorage.getItem(`${module}_accessToken`);
  } catch {
    return null;
  }
}

/**
 * Get module-specific refresh token (fallback for WebView environments where cookies may be unreliable)
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 * @returns {string|null} - Refresh token or null
 */
export function getModuleRefreshToken(module) {
  const scoped = readScopedValue("auth", `${module}:refreshToken`, { fallback: null });
  if (scoped !== null && scoped !== undefined && scoped !== "") return scoped;
  try {
    return localStorage.getItem(`${module}_refreshToken`);
  } catch {
    return null;
  }
}

export function setModuleAccessToken(module, token) {
  writeScopedValue("auth", `${module}:accessToken`, token || "");
  try {
    if (token) {
      localStorage.setItem(`${module}_accessToken`, token);
    } else {
      localStorage.removeItem(`${module}_accessToken`);
    }
  } catch {}
}

export function getModuleFcmToken(module) {
  const scoped = readScopedValue("auth-meta", `fcm:${module}`, { fallback: null });
  if (scoped !== null && scoped !== undefined && scoped !== "") return scoped;
  try {
    return localStorage.getItem(`fcm_web_registered_token_${module}`) || null;
  } catch {
    return null;
  }
}

export function clearModuleFcmToken(module) {
  removeScopedValue("auth-meta", `fcm:${module}`);
  try {
    localStorage.removeItem(`fcm_web_registered_token_${module}`);
  } catch {}
}

/**
 * Get current user's role from a specific module's storage/token
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 * @returns {string|null} - Current user role or null
 */
export function getCurrentUserRole(module = null) {
  if (module) {
    const user = getCurrentUser(module);
    if (user) {
      return user.role || module;
    }
  }
  return module || 'user';
}

/**
 * Get current user object from specific module's storage
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 * @returns {Object|null} - User object or null
 */
export function getCurrentUser(module) {
  if (!module) return null;
  const scoped = readScopedValue("auth", `${module}:user`, { fallback: null });
  if (scoped && typeof scoped === "object") return scoped;
  let userStr = null;
  try {
    userStr = localStorage.getItem(`${module}_user`);
  } catch {
    userStr = null;
  }
  if (!userStr) return null;
  try {
    return JSON.parse(userStr);
  } catch (e) {
    return null;
  }
}

/**
 * Check if user is authenticated for a specific module
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 * @returns {boolean} - True if authenticated
 */
export function isModuleAuthenticated(module) {
  const token = getModuleToken(module);
  return !!token && !isTokenExpired(token);
}

/**
 * Clear authentication data for a specific module
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 */
export function clearModuleAuth(module) {
  removeScopedValue("auth", `${module}:accessToken`);
  removeScopedValue("auth", `${module}:refreshToken`);
  removeScopedValue("auth", `${module}:authenticated`);
  removeScopedValue("auth", `${module}:user`);
  try {
    localStorage.removeItem(`${module}_accessToken`);
    localStorage.removeItem(`${module}_refreshToken`);
    localStorage.removeItem(`${module}_authenticated`);
    localStorage.removeItem(`${module}_user`);
  } catch {}
  // Clear cached FCM web token for this module
  clearModuleFcmToken(module);
  
  if (module === "user") {
    clearUserSession();
  }
  
  if (module === "restaurant") {
    clearRestaurantSessionCache();
  }
  // Also clear any sessionStorage data
  removeScopedValue("auth-meta", `${module}:sessionData`);
  sessionStorage.removeItem(`${module}AuthData`);
}

/**
 * Clear user-specific profile data to prevent data leakage across accounts.
 */
export function clearUserSession() {
  if (typeof localStorage === "undefined") return;
  const keys = ["userProfile", "user_user", "user_edit_profile_draft"];
  keys.forEach((k) => localStorage.removeItem(k));
}

/**
 * Clear restaurant-local cached UI data to prevent cross-account stale state.
 */
export function clearRestaurantSessionCache() {
  const keys = [
    "restaurant_owner_contact",
    "restaurant_onboarding",
    "restaurant_onboarding_data",
    "restaurant_invited_users",
    "restaurant_schedule_off",
    "restaurant_online_status",
    "restaurant_outlet_timings",
    "restaurant_hub_menu_active_tab",
    "restaurant_name",
    "restaurantName",
  ];

  keys.forEach((key) => localStorage.removeItem(key));
}

export function setRestaurantPendingPhone(phone) {
  if (typeof localStorage === "undefined") return;
  if (!phone) {
    removeScopedValue("auth-meta", "restaurant:pendingPhone");
    localStorage.removeItem("restaurant_pendingPhone");
    return;
  }
  writeScopedValue("auth-meta", "restaurant:pendingPhone", phone);
  localStorage.setItem("restaurant_pendingPhone", phone);
}

export function getRestaurantPendingPhone() {
  if (typeof localStorage === "undefined") return null;
  const scoped = readScopedValue("auth-meta", "restaurant:pendingPhone", { fallback: null });
  if (scoped !== null && scoped !== undefined && scoped !== "") return scoped;
  return localStorage.getItem("restaurant_pendingPhone");
}

export function clearRestaurantPendingPhone() {
  if (typeof localStorage === "undefined") return;
  removeScopedValue("auth-meta", "restaurant:pendingPhone");
  localStorage.removeItem("restaurant_pendingPhone");
}

/**
 * Clear all authentication data for all modules
 */
export function clearAuthData() {
  const modules = ['admin', 'restaurant', 'delivery', 'user'];
  modules.forEach(module => {
    clearModuleAuth(module);
  });
  // Also clear legacy token if it exists
  localStorage.removeItem('accessToken');
  localStorage.removeItem('user');
}

/**
 * Set authentication data for a specific module
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 * @param {string} token - Access token
 * @param {Object} user - User data
 * @param {string|null} refreshToken - Optional refresh token
 * @throws {Error} If localStorage is not available or quota exceeded
 */
export function setAuthData(module, token, user, refreshToken = null) {
  try {
    if (typeof Storage === 'undefined' || !localStorage) {
      throw new Error('localStorage is not available');
    }

    if (!module || !token) {
      throw new Error(`Invalid parameters: module=${module}, token=${!!token}`);
    }

    console.log(`[setAuthData] Storing auth for module: ${module}`, {
      hasToken: !!token,
      tokenLength: token?.length,
      hasUser: !!user
    });

    if (module === "user") {
      clearUserSession();
    } else if (module === "restaurant") {
      clearRestaurantSessionCache();
    }

    setModuleAccessToken(module, token);
    if (refreshToken && typeof refreshToken === "string") {
      writeScopedValue("auth", `${module}:refreshToken`, refreshToken);
      localStorage.setItem(`${module}_refreshToken`, refreshToken);
    }
    writeScopedValue("auth", `${module}:authenticated`, 'true');
    localStorage.setItem(`${module}_authenticated`, 'true');

    if (user) {
      try {
        writeScopedValue("auth", `${module}:user`, user);
        localStorage.setItem(`${module}_user`, JSON.stringify(user));
      } catch (userError) {
        console.warn('Failed to store user data, but token was stored:', userError);
      }
    }

    const storedToken = getModuleToken(module);
    const storedAuth = readScopedValue("auth", `${module}:authenticated`, { fallback: localStorage.getItem(`${module}_authenticated`) });

    if (storedToken !== token) {
      console.error(`[setAuthData] Token mismatch:`, {
        expected: token?.substring(0, 20) + '...',
        stored: storedToken?.substring(0, 20) + '...'
      });
      throw new Error(`Token storage verification failed for module: ${module}`);
    }

    if (storedAuth !== 'true') {
      console.error(`[setAuthData] Auth flag mismatch:`, {
        expected: 'true',
        stored: storedAuth
      });
      throw new Error(`Authentication flag storage failed for module: ${module}`);
    }

    console.log(`[setAuthData] Successfully stored auth data for ${module}`);
  } catch (error) {
    if (error.name === 'QuotaExceededError' || error.code === 22) {
      console.warn('localStorage quota exceeded. Attempting to clear old data...');
      try {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('user');
        setModuleAccessToken(module, token);
        if (refreshToken && typeof refreshToken === "string") {
          writeScopedValue("auth", `${module}:refreshToken`, refreshToken);
          localStorage.setItem(`${module}_refreshToken`, refreshToken);
        }
        writeScopedValue("auth", `${module}:authenticated`, 'true');
        localStorage.setItem(`${module}_authenticated`, 'true');
        if (user) {
          writeScopedValue("auth", `${module}:user`, user);
          localStorage.setItem(`${module}_user`, JSON.stringify(user));
        }

        const storedToken = getModuleToken(module);
        if (storedToken !== token) {
          throw new Error('Token storage failed even after clearing space');
        }
      } catch (retryError) {
        console.error('Failed to store auth data after clearing space:', retryError);
        throw new Error('Unable to store authentication data. Please clear browser storage and try again.');
      }
    } else {
      console.error('[setAuthData] Error storing auth data:', error);
      throw error;
    }
  }
}








