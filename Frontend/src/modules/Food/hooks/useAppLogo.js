import { useState, useEffect } from 'react';
import { getCachedSettings, loadBusinessSettings } from '@food/utils/businessSettings';

const resolveLogoFromSettings = (settings, appType) => {
  if (!settings) return null;
  if (appType === 'user_app') {
    return settings.userLogo?.url || settings.logo?.url || null;
  }
  if (appType === 'restaurant_app') {
    return settings.restaurantLogo?.url || settings.logo?.url || null;
  }
  if (appType === 'delivery_app') {
    return settings.deliveryLogo?.url || settings.logo?.url || null;
  }
  return settings.logo?.url || null;
};

const readDynamicLogo = (appType) => {
  if (typeof window === 'undefined') return null;

  const logoFromSettings = resolveLogoFromSettings(getCachedSettings(), appType);
  if (logoFromSettings) return logoFromSettings;

  return localStorage.getItem(`${appType}_logo`) || null;
};

/**
 * Hook to get the dynamic app logo for the specific application (user, admin, restaurant, delivery)
 * @param {'user_app' | 'admin_app' | 'restaurant_app' | 'delivery_app'} appType
 * @returns {string | null} The logo URL from business settings if available
 */
export function useAppLogo(appType = 'user_app') {
  const [logo, setLogo] = useState(() => readDynamicLogo(appType));

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;

    const syncLogo = async () => {
      const cachedLogo = readDynamicLogo(appType);
      if (cachedLogo) {
        if (!cancelled) setLogo(cachedLogo);
        return;
      }

      const settings = await loadBusinessSettings();
      if (!cancelled) {
        setLogo(resolveLogoFromSettings(settings, appType) || readDynamicLogo(appType));
      }
    };

    void syncLogo();

    const handleLogoUpdate = () => {
      void syncLogo();
    };

    window.addEventListener('themeLoaded', handleLogoUpdate);
    window.addEventListener('businessSettingsUpdated', handleLogoUpdate);
    window.addEventListener('storage', handleLogoUpdate);

    return () => {
      cancelled = true;
      window.removeEventListener('themeLoaded', handleLogoUpdate);
      window.removeEventListener('businessSettingsUpdated', handleLogoUpdate);
      window.removeEventListener('storage', handleLogoUpdate);
    };
  }, [appType]);

  return logo;
}
