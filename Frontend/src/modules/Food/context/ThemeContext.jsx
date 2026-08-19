import { createContext, useContext, useState, useEffect } from "react";

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    const path = window.location.pathname;
    const isAdmin = path.includes('/admin');
    const isDelivery = path.includes('/delivery');
    const isRestaurant = path.includes('/restaurant') && !path.includes('/user/restaurants');
    const isUserApp = !isAdmin && !isRestaurant && !isDelivery;
    
    let storageKey = "userAppTheme";
    let defaultTheme = "light";
    
    if (isAdmin) {
      storageKey = "adminAppTheme";
      defaultTheme = "light";
    } else if (isRestaurant) {
      storageKey = "restaurantAppTheme";
      defaultTheme = "light";
    } else if (isDelivery) {
      storageKey = "deliveryAppTheme";
      defaultTheme = "light";
    }

    return localStorage.getItem(storageKey) || defaultTheme;
  });

  useEffect(() => {
    const path = window.location.pathname;
    const isAdmin = path.includes('/admin');
    const isDelivery = path.includes('/delivery');
    const isRestaurant = path.includes('/restaurant') && !path.includes('/user/restaurants');
    
    let storageKey = "userAppTheme";
    if (isAdmin) storageKey = "adminAppTheme";
    else if (isRestaurant) storageKey = "restaurantAppTheme";
    else if (isDelivery) storageKey = "deliveryAppTheme";

    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem(storageKey, theme);
    
    // Dispatch a custom event in case non-React parts need to know
    window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
