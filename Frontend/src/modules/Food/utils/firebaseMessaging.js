import { toast } from "sonner";
import { userAPI, restaurantAPI, deliveryAPI, adminAPI } from "@food/api";
import { initializeApp, getApp, getApps } from "firebase/app";
import fallbackNotificationSound from "@food/assets/audio/alert.mp3";
import pushNotificationSoundPath from "@food/assets/audio/zomato_sms.mp3";

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  appId: "",
  messagingSenderId: "",
};

const tokenCachePrefix = "fcm_web_registered_token_";
const pushSoundEnabledStorageKey = "push_sound_enabled";
let publicEnvPromise = null;
let foregroundListenerAttached = false;
let registrationInFlight = null;
let serviceWorkerMessageListenerAttached = false;
const MESSAGING_APP_NAME = "web-push-app";
const recentForegroundNotifications = new Map();
let pushSoundAudio = null;
let pushSoundUnlocked = false;
let gestureAudioPrimed = false;
let pushSoundContext = null;
const PUSH_DEBUG_PREFIX = "[push-debug]";
const notificationDedupWindowMs = 8000;

const pushDebugLog = (prefix, message, data = {}) => {};
const pushDebugWarn = (prefix, message, data = {}) => {};

function normalizeModuleFromPath(pathname = window.location.pathname) {
  if (pathname.includes("/restaurant") && !pathname.includes("/restaurants")) return "restaurant";
  if (pathname.includes("/delivery")) return "delivery";
  if (pathname.includes("/admin")) return "admin";
  return "user";
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getPushSoundSources(moduleName = normalizeModuleFromPath()) {
  // Delivery and restaurant should always use the alert tone for FCM pushes.
  if (moduleName === "delivery" || moduleName === "restaurant") {
    return [fallbackNotificationSound];
  }
  return [pushNotificationSoundPath, fallbackNotificationSound];
}

function isSupportedBrowser() {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

function isFlutterWebView() {
  return (
    typeof window !== "undefined" &&
    Boolean(window.flutter_inappwebview) &&
    typeof window.flutter_inappwebview.callHandler === "function"
  );
}

function isSecureContextForPush() {
  return window.isSecureContext || window.location.hostname === "localhost";
}

function sanitize(value) {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "");
}

function inferDevicePlatform() {
  if (typeof navigator === "undefined") return "unknown";
  const agent = String(navigator.userAgent || navigator.vendor || "").toLowerCase();
  if (/iphone|ipad|ipod|ios/.test(agent)) return "ios";
  if (agent.includes("android")) return "android";
  if (agent.includes("mac") || agent.includes("win") || agent.includes("linux")) return "web";
  return "unknown";
}

async function getNativeDevicePlatform(moduleName) {
  if (!isFlutterWebView()) return inferDevicePlatform();

  const handlerNames = ["getDevicePlatform", "getPlatform", "getNativePlatform"];
  for (const handlerName of handlerNames) {
    try {
      const value = await window.flutter_inappwebview.callHandler(handlerName, { module: moduleName });
      const normalized = sanitize(value).toLowerCase();
      if (["ios", "android", "web"].includes(normalized)) return normalized;
    } catch {
      // Try next handler.
    }
  }

  return inferDevicePlatform();
}

function getDeviceId(moduleName, devicePlatform, fcmToken, voipToken) {
  const tokenSeed = sanitize(voipToken || fcmToken).slice(-16);
  return ["tuggo", moduleName, devicePlatform || "unknown", tokenSeed || "device"].join(":");
}

function getNotificationKey(payload = {}) {
  // Use unique identifiers from FCM if available
  const fcmId = payload?.messageId || payload?.data?.messageId || payload?.data?.notificationId;
  if (fcmId) return String(fcmId);

  // Fallback to content-based fingerprinting
  const title = (payload?.notification?.title || payload?.data?.title || "").trim();
  const body = (payload?.notification?.body || payload?.data?.body || "").trim();
  const orderId = payload?.data?.orderId || "";
  
  if (!title && !body && !orderId) return null;

  return [
    title.toLowerCase(),
    body.toLowerCase(),
    orderId
  ].join("|");
}

function wasRecentlyHandled(notificationKey) {
  if (!notificationKey) return false;
  const now = Date.now();

  // Cleanup old entries
  for (const [key, timestamp] of recentForegroundNotifications.entries()) {
    if (now - timestamp > notificationDedupWindowMs) {
      recentForegroundNotifications.delete(key);
    }
  }

  // Check memory-based dedup (for same tab)
  if (recentForegroundNotifications.has(notificationKey)) {
    pushDebugLog(PUSH_DEBUG_PREFIX, "Duplicate notification skipped (memory)", { notificationKey });
    return true;
  }

  // Check storage-based dedup (for cross-tab)
  const storageKey = `fcm_handled_${notificationKey.replace(/[^a-zA-Z0-9]/g, '_')}`;
  if (typeof localStorage !== "undefined") {
    const lastSeen = localStorage.getItem(storageKey);
    if (lastSeen && now - Number(lastSeen) < notificationDedupWindowMs) {
      pushDebugLog(PUSH_DEBUG_PREFIX, "Duplicate notification skipped (storage)", { notificationKey });
      return true;
    }
    localStorage.setItem(storageKey, String(now));
    // Periodic cleanup of storage keys would be good but this is enough for now
  }

  recentForegroundNotifications.set(notificationKey, now);
  return false;
}

function ensurePushSoundAudio() {
  if (typeof window === "undefined") return null;
  if (!pushSoundAudio) {
    const [primarySource] = getPushSoundSources();
    const audioUrl = primarySource.startsWith("/")
      ? new URL(primarySource, window.location.origin).toString()
      : primarySource;
    pushDebugLog(PUSH_DEBUG_PREFIX, "Creating primary push audio", { audioUrl });
    pushSoundAudio = new Audio(audioUrl);
    pushSoundAudio.preload = "auto";
    pushSoundAudio.volume = 1;
    pushSoundAudio.load();
  }
  return pushSoundAudio;
}

function createPushPlaybackAudio() {
  const moduleName = normalizeModuleFromPath();
  const audioSources = getPushSoundSources(moduleName).map((source) =>
    typeof window === "undefined" || !source.startsWith("/")
      ? source
      : new URL(source, window.location.origin).toString(),
  );
  pushDebugLog(PUSH_DEBUG_PREFIX, "Preparing push playback sources", { audioSources });
  return audioSources.map((source) => {
    const separator = source.includes("?") ? "&" : "?";
    const finalSource = typeof import.meta !== "undefined" && import.meta.env?.DEV 
      ? `${source}${separator}cb=${Date.now()}` 
      : source;
    const playbackAudio = new Audio(finalSource);
    playbackAudio.preload = "auto";
    playbackAudio.volume = 1;
    playbackAudio.load();
    return playbackAudio;
  });
}

function getAudioContext() {
  if (typeof window === "undefined") return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!pushSoundContext) {
    pushSoundContext = new AudioContextClass();
  }

  return pushSoundContext;
}

async function playSynthNotificationBeep() {
  const ctx = getAudioContext();
  if (!ctx) return false;
  pushDebugLog(PUSH_DEBUG_PREFIX, "Playing synth notification beep");

  if (ctx.state === "suspended") {
    await ctx.resume();
  }

  const now = ctx.currentTime;
  const pulses = [
    { start: 0, duration: 0.11, frequency: 880 },
    { start: 0.16, duration: 0.11, frequency: 988 },
    { start: 0.34, duration: 0.18, frequency: 1046 },
  ];

  pulses.forEach(({ start, duration, frequency }) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now + start);
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(0.18, now + start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(now + start);
    oscillator.stop(now + start + duration);
  });

  return true;
}

export function isPushSoundEnabled() {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(pushSoundEnabledStorageKey) === "true";
}

function isPushSoundActive() {
  return pushSoundUnlocked || isPushSoundEnabled();
}

/** Prime Web Audio on a user gesture without playing notification MP3 (iOS-safe). */
async function primeAudioGesture() {
  if (gestureAudioPrimed) return true;

  const ctx = getAudioContext();
  if (!ctx) return false;

  if (ctx.state === "suspended") {
    await ctx.resume();
  }

  const now = ctx.currentTime;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.01);

  gestureAudioPrimed = true;
  return true;
}

async function triggerWebViewNativeNotification(payload = {}) {
  if (typeof window === "undefined") return false;

  const bridgePayload = {
    title: payload?.notification?.title || payload?.data?.title || "New notification",
    body: payload?.notification?.body || payload?.data?.body || "",
    notificationId: payload?.data?.notificationId || payload?.messageId || "",
    targetUrl: payload?.data?.targetUrl || payload?.data?.link || "",
    imageUrl: payload?.notification?.image || payload?.data?.image || payload?.data?.imageUrl || "",
  };

  try {
    if (
      window.flutter_inappwebview &&
      typeof window.flutter_inappwebview.callHandler === "function"
    ) {
      const handlerNames = [
        "playNotificationSound",
        "triggerNotificationFeedback",
        "onPushNotification",
      ];

      for (const handlerName of handlerNames) {
        try {
          pushDebugLog(PUSH_DEBUG_PREFIX, "Trying native notification handler", { handlerName, bridgePayload });
          await window.flutter_inappwebview.callHandler(handlerName, bridgePayload);
          pushDebugLog(PUSH_DEBUG_PREFIX, "Native notification handler succeeded", { handlerName });
          return true;
        } catch {
          // Try the next available handler name.
        }
      }
    }
  } catch {
    // Ignore bridge failures.
  }

  return false;
}

async function playPushSound(payload = {}) {
  try {
    if (!isPushSoundActive()) {
      pushDebugLog(PUSH_DEBUG_PREFIX, "Push sound skipped — not explicitly enabled");
      return;
    }

    pushDebugLog(PUSH_DEBUG_PREFIX, "playPushSound called", {
      notificationKey: getNotificationKey(payload),
      pushSoundUnlocked,
      notificationPermission: typeof Notification !== "undefined" ? Notification.permission : "unsupported",
      payload,
    });
    const usedNativeBridge = await triggerWebViewNativeNotification(payload);

    if (
      typeof navigator !== "undefined" &&
      typeof navigator.vibrate === "function" &&
      isPushSoundActive()
    ) {
      pushDebugLog(PUSH_DEBUG_PREFIX, "Triggering vibration");
      navigator.vibrate([200, 100, 200, 100, 300]);
    }

    if (usedNativeBridge) {
      pushDebugLog(PUSH_DEBUG_PREFIX, "Push sound handled by native bridge");
      return;
    }

    if (!pushSoundUnlocked && !isPushSoundEnabled()) {
      pushDebugWarn(PUSH_DEBUG_PREFIX, "Push sound blocked because sound is not enabled/unlocked");
      return;
    }

    const players = createPushPlaybackAudio();
    for (const audio of players) {
      try {
        audio.currentTime = 0;
        await audio.play();
        pushDebugLog(PUSH_DEBUG_PREFIX, "Audio playback succeeded", { source: audio.src });
        return;
      } catch (error) {
        pushDebugWarn(PUSH_DEBUG_PREFIX, "Audio playback failed", {
          source: audio.src,
          error: error?.message || error,
        });
        // Try next fallback sound source.
      }
    }

    await playSynthNotificationBeep();
  } catch (error) {
    pushDebugWarn(PUSH_DEBUG_PREFIX, "playPushSound failed", { error: error?.message || error });
  }
}

function setupPushSoundUnlock() {
  if (typeof window === "undefined" || gestureAudioPrimed) return;

  const unlock = async () => {
    try {
      await primeAudioGesture();
      pushDebugLog(PUSH_DEBUG_PREFIX, "Silent audio gesture primed (no notification MP3)");
    } catch (error) {
      pushDebugWarn(PUSH_DEBUG_PREFIX, "Silent audio gesture prime failed", {
        error: error?.message || error,
      });
    }

    if (gestureAudioPrimed) {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    }
  };

  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock, { passive: true });
  window.addEventListener("touchstart", unlock, { passive: true });
}

export async function enablePushNotificationSound() {
  if (typeof window === "undefined") return false;

  try {
    pushDebugLog(PUSH_DEBUG_PREFIX, "Manual push sound enable started");
    await primeAudioGesture();
    pushSoundUnlocked = true;
    localStorage.setItem(pushSoundEnabledStorageKey, "true");
    window.dispatchEvent(new CustomEvent("push-sound-enabled"));

    const players = createPushPlaybackAudio();
    for (const previewAudio of players) {
      try {
        previewAudio.currentTime = 0;
        await previewAudio.play();
        pushDebugLog(PUSH_DEBUG_PREFIX, "Manual sound preview succeeded", { source: previewAudio.src });
        return true;
      } catch (error) {
        pushDebugWarn(PUSH_DEBUG_PREFIX, "Manual sound preview failed", {
          source: previewAudio.src,
          error: error?.message || error,
        });
      }
    }

    await playSynthNotificationBeep();
    return true;
  } catch (error) {
    pushDebugWarn(PUSH_DEBUG_PREFIX, "Manual push sound enable failed, trying synth beep", {
      error: error?.message || error,
    });
    try {
      await playSynthNotificationBeep();
      pushSoundUnlocked = true;
      localStorage.setItem(pushSoundEnabledStorageKey, "true");
      window.dispatchEvent(new CustomEvent("push-sound-enabled"));
    } catch (beepError) {
      pushDebugWarn(PUSH_DEBUG_PREFIX, "Synth beep fallback failed", {
        error: beepError?.message || beepError,
      });
      return false;
    }
    return true;
  }
}

async function getFirebasePublicEnv() {
  if (publicEnvPromise) return publicEnvPromise;

  publicEnvPromise = (async () => {
    try {
      return {
        apiKey: sanitize(import.meta.env.VITE_FIREBASE_API_KEY) || DEFAULT_FIREBASE_CONFIG.apiKey,
        authDomain: sanitize(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN) || DEFAULT_FIREBASE_CONFIG.authDomain,
        projectId: sanitize(import.meta.env.VITE_FIREBASE_PROJECT_ID) || DEFAULT_FIREBASE_CONFIG.projectId,
        appId: sanitize(import.meta.env.VITE_FIREBASE_APP_ID) || DEFAULT_FIREBASE_CONFIG.appId,
        messagingSenderId:
          sanitize(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID) || DEFAULT_FIREBASE_CONFIG.messagingSenderId,
        storageBucket: sanitize(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
        measurementId: sanitize(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID),
        vapidKey: sanitize(import.meta.env.VITE_FIREBASE_VAPID_KEY),
      };
    } catch {
      return {
        ...DEFAULT_FIREBASE_CONFIG,
        storageBucket: sanitize(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
        measurementId: sanitize(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID),
        vapidKey: sanitize(import.meta.env.VITE_FIREBASE_VAPID_KEY),
      };
    } finally {
      publicEnvPromise = null;
    }
  })();

  return publicEnvPromise;
}

function getMessagingFirebaseApp(config) {
  const appConfig = {
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    appId: config.appId,
    messagingSenderId: config.messagingSenderId,
    ...(config.storageBucket ? { storageBucket: config.storageBucket } : {}),
    ...(config.measurementId ? { measurementId: config.measurementId } : {}),
  };

  if (!appConfig.apiKey || !appConfig.projectId || !appConfig.appId || !appConfig.messagingSenderId) {
    return null;
  }

  const existing = getApps().find((a) => a.name === MESSAGING_APP_NAME);
  if (existing) return existing;

  try {
    return getApp(MESSAGING_APP_NAME);
  } catch {
    return initializeApp(appConfig, MESSAGING_APP_NAME);
  }
}

function getSavedToken(moduleName) {
  return localStorage.getItem(`${tokenCachePrefix}${moduleName}`) || "";
}

function setSavedToken(moduleName, token) {
  localStorage.setItem(`${tokenCachePrefix}${moduleName}`, token);
}

/**
 * Clear the locally cached FCM token for a module.
 * Call this on login so the next registerWebPushForCurrentModule
 * call will force a backend sync (even if the browser token is unchanged).
 */
export function clearCachedFcmToken(moduleName) {
  if (!moduleName) return;
  localStorage.removeItem(`${tokenCachePrefix}${moduleName}`);
  pushDebugLog(PUSH_DEBUG_PREFIX, "Cleared cached FCM token for module", { moduleName });
}

async function saveTokenByModule(moduleName, token, platform = "web") {
  pushDebugLog(PUSH_DEBUG_PREFIX, "saveTokenByModule starting", { moduleName, platform, tokenPreview: `${token?.slice(0, 10)}...` });
  if (moduleName === "restaurant") {
    await restaurantAPI.saveFcmToken(token, platform);
    return;
  }
  if (moduleName === "delivery") {
    await deliveryAPI.saveFcmToken(token, platform);
    return;
  }
  if (moduleName === "user") {
    await userAPI.saveFcmToken(token, { platform });
  }
}

async function savePushDeviceByModule(moduleName, payload = {}) {
  if (moduleName === "restaurant") {
    await restaurantAPI.savePushDevice(payload);
    return;
  }
  if (moduleName === "delivery") {
    await deliveryAPI.savePushDevice(payload);
    return;
  }
  if (moduleName === "user") {
    await userAPI.savePushDevice(payload);
  }
}

async function getNativeBridgeToken(handlerNames, moduleName) {
  for (const handlerName of handlerNames) {
    try {
      const token = await window.flutter_inappwebview.callHandler(handlerName, { module: moduleName });
      const normalizedToken = String(token || "").trim();
      if (normalizedToken.length >= 20) {
        return { handlerName, token: normalizedToken };
      }
    } catch {
      // Try next handler.
    }
  }
  return { handlerName: "", token: "" };
}

async function registerNativeWebViewFcmToken(moduleName) {
  if (!isFlutterWebView()) return;

  const devicePlatform = await getNativeDevicePlatform(moduleName);
  const fcmResult = await getNativeBridgeToken(["getFcmToken", "getFCMToken", "getPushToken", "getFirebaseToken"], moduleName);
  const voipResult = devicePlatform === "ios"
    ? await getNativeBridgeToken(["getVoipToken", "getVOIPToken", "getPushKitToken"], moduleName)
    : { handlerName: "", token: "" };

  const normalizedToken = fcmResult.token;
  const normalizedVoipToken = voipResult.token;
  if (!normalizedToken && !normalizedVoipToken) return;

  const lastSavedToken = getSavedToken(moduleName);
  if (lastSavedToken !== normalizedToken) {
    setSavedToken(moduleName, normalizedToken);
  }

  await savePushDeviceByModule(moduleName, {
    fcmToken: normalizedToken || undefined,
    voipToken: normalizedVoipToken || undefined,
    pushPlatform: "mobile",
    devicePlatform,
  });

  pushDebugLog(PUSH_DEBUG_PREFIX, "Registered native WebView push device", {
    moduleName,
    devicePlatform,
    fcmHandlerName: fcmResult.handlerName,
    voipHandlerName: voipResult.handlerName,
    tokenPreview: normalizedToken ? `${normalizedToken.slice(0, 12)}...` : "",
    hasVoipToken: Boolean(normalizedVoipToken),
  });
}

// options.fromSwRelay = true means the service worker already showed the system
// notification; we should only show the in-app toast here to avoid duplicates.
function showForegroundNotification(payload = {}, options = {}) {
  if (!isRecord(payload)) {
    pushDebugWarn(PUSH_DEBUG_PREFIX, "Ignoring malformed foreground notification payload", { payload });
    return;
  }

  const moduleName = normalizeModuleFromPath();
  const notificationKey = getNotificationKey(payload);
  pushDebugLog(PUSH_DEBUG_PREFIX, "showForegroundNotification received", { notificationKey, fromSwRelay: options.fromSwRelay, payload });
  if (wasRecentlyHandled(notificationKey)) {
    return;
  }

  const title =
    payload?.notification?.title ||
    payload?.data?.title ||
    payload?.data?.alert ||
    "New notification";
  const body =
    payload?.notification?.body ||
    payload?.data?.body ||
    payload?.data?.message ||
    payload?.data?.msg ||
    "";
  const image =
    payload?.notification?.image ||
    payload?.notification?.imageUrl ||
    payload?.data?.image ||
    payload?.data?.imageUrl ||
    undefined;

  playPushSound(payload);

  const payloadOrderId =
    payload?.data?.orderMongoId ||
    payload?.data?.order_id ||
    payload?.data?.orderId ||
    payload?.data?.id ||
    "";
  const isDeliveryOrderSignal =
    moduleName === "delivery" &&
    Boolean(
      payloadOrderId ||
      payload?.data?.type === "new_order" ||
      title.toLowerCase().includes("order") ||
      body.toLowerCase().includes("order")
    );

  if (typeof window !== "undefined" && isDeliveryOrderSignal) {
    const relayPayload = {
      orderId: payload?.data?.orderId || payload?.data?.order_id || payloadOrderId || undefined,
      orderMongoId: payload?.data?.orderMongoId || payloadOrderId || undefined,
      payload,
      fromSwRelay: Boolean(options.fromSwRelay),
    };
    pushDebugLog(PUSH_DEBUG_PREFIX, "Dispatching delivery FCM alert to in-app flow", relayPayload);
    window.dispatchEvent(new CustomEvent("delivery-fcm-order-alert", { detail: relayPayload }));
  }

  // Only show a system notification from the PAGE if this is NOT a SW relay.
  // When it IS a SW relay the service worker already showed the notification —
  // creating another one here would produce a duplicate.
  const isTabVisible = typeof document !== "undefined" && document.visibilityState === "visible";

  // Only show a system notification from the PAGE if:
  // 1. This is NOT a relay from the service worker (the SW already handles background alerts).
  // 2. The tab is currently HIDDEN (if visible, the user sees the toast instead).
  // 3. We are NOT in a mobile WebView (where native notifications are preferred).
  if (!options.fromSwRelay && !isTabVisible && !isFlutterWebView() && typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      pushDebugLog(PUSH_DEBUG_PREFIX, "Showing browser notification from page (tab is hidden)", {
        title,
        body,
        image,
        notificationKey,
      });
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then(registration => {
          if (registration) {
            registration.showNotification(title, {
              body,
              icon: "/logo.png",
              image,
              tag: notificationKey || undefined,
              data: payload?.data || {},
              requireInteraction: true,
              vibrate: [200, 100, 200, 100, 300]
            });
          } else {
            new Notification(title, {
              body,
              icon: "/logo.png",
              image,
              tag: notificationKey || undefined,
              requireInteraction: true
            });
          }
        }).catch(() => {
          new Notification(title, {
            body,
            icon: "/logo.png",
            image,
            tag: notificationKey || undefined,
          });
        });
      } else {
        new Notification(title, {
          body,
          icon: "/logo.png",
          image,
          tag: notificationKey || undefined,
        });
      }
    } catch (error) {
      pushDebugWarn(PUSH_DEBUG_PREFIX, "Browser notification creation failed", {
        error: error?.message || error,
      });
    }
  }

  // Show in-app toast if tab is visible.
  if (typeof document !== "undefined" && document.visibilityState === "visible") {
    // Cross-tab deduplication using BroadcastChannel and LocalStorage
    const notificationId = payload?.data?.broadcastId || payload?.data?.orderId || payload?.data?.id || (title + body).replace(/\s+/g, '');
    const channelName = `notification_dedupe_${notificationId}`;
    const storageKey = `handled_notify_${notificationId}`;

    if (localStorage.getItem(storageKey)) {
      return;
    }

    localStorage.setItem(storageKey, "true");
    setTimeout(() => localStorage.removeItem(storageKey), 5000);

    const channel = new BroadcastChannel(channelName);
    channel.postMessage({ type: "HANDLED" });
    channel.close();

    const isNewOrder = 
      title.toLowerCase().includes("order") || 
      body.toLowerCase().includes("order") || 
      payload?.data?.orderId;

    if (body) {
      toast(title, {
        description: body,
        duration: isNewOrder ? 15000 : 6000,
        important: isNewOrder,
        action: payload?.data?.targetUrl ? {
          label: 'View',
          onClick: () => window.location.href = payload.data.targetUrl
        } : undefined
      });
    } else {
      toast(title, {
        duration: isNewOrder ? 15000 : 6000,
        important: isNewOrder
      });
    }
  }
}

function attachServiceWorkerMessageListener() {
  if (serviceWorkerMessageListenerAttached || typeof window === "undefined") {
    return;
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = isRecord(event?.data) ? event.data : null;
      if (!data || data.type !== "push-notification-received") return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        pushDebugLog(PUSH_DEBUG_PREFIX, "Skipping page notification render for SW relay because tab is hidden");
        return;
      }
      if (!isRecord(data.payload)) {
        pushDebugWarn(PUSH_DEBUG_PREFIX, "Ignoring malformed SW push relay payload", { payload: data.payload });
        return;
      }
      pushDebugLog(PUSH_DEBUG_PREFIX, "Received service worker message in page", { payload: data.payload });
      // fromSwRelay: true — SW already showed the system notification; only show toast.
      scheduleForegroundNotification(data.payload, { fromSwRelay: true });
    });
  }

  window.addEventListener("native-push-notification", (event) => {
    const payload = isRecord(event?.detail) ? event.detail : null;
    if (!payload) {
      pushDebugWarn(PUSH_DEBUG_PREFIX, "Ignoring malformed native push event", { payload: event?.detail });
      return;
    }
    pushDebugLog(PUSH_DEBUG_PREFIX, "Received native push event", { payload });
    scheduleForegroundNotification(payload);
  });

  window.addEventListener("message", (event) => {
    const data = isRecord(event?.data) ? event.data : null;
    if (!data) return;
    if (data.type !== "native-push-notification") return;
    if (!isRecord(data.payload)) {
      pushDebugWarn(PUSH_DEBUG_PREFIX, "Ignoring malformed native postMessage payload", { payload: data.payload });
      return;
    }
    pushDebugLog(PUSH_DEBUG_PREFIX, "Received native postMessage push event", { payload: data.payload });
    scheduleForegroundNotification(data.payload);
  });

  serviceWorkerMessageListenerAttached = true;
}

function scheduleForegroundNotification(payload, options = {}) {
  // Keep message handlers fast to avoid Chrome [Violation] warnings.
  // Defer heavier work (toast, audio) to idle time / next tick.
  const run = () => showForegroundNotification(payload, options);
  try {
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(run, { timeout: 1000 });
      return;
    }
  } catch {
    // ignore
  }
  setTimeout(run, 0);
}

export function initPushNotificationClient() {
  if (typeof window === "undefined") return;
  const moduleName = normalizeModuleFromPath(window.location.pathname);
  pushDebugLog(PUSH_DEBUG_PREFIX, "Initializing push notification client", {
    path: window.location.pathname,
    moduleName,
    soundEnabled: isPushSoundEnabled(),
  });

  if (moduleName === "admin") {
    return;
  }

  if (isPushSoundEnabled()) {
    pushSoundUnlocked = true;
  }

  setupPushSoundUnlock();
  attachServiceWorkerMessageListener();
}

async function attachForegroundListener(firebaseAppInstance) {
  if (foregroundListenerAttached) return;

  const { getMessaging, onMessage, isSupported } = await import("firebase/messaging");
  const supported = await isSupported().catch(() => false);
  if (!supported) return;

  const messaging = getMessaging(firebaseAppInstance);
  setupPushSoundUnlock();
  attachServiceWorkerMessageListener();

  onMessage(messaging, (payload) => {
    pushDebugLog(PUSH_DEBUG_PREFIX, "Received Firebase foreground message", { payload });
    scheduleForegroundNotification(payload);
  });

  foregroundListenerAttached = true;
}

export async function registerWebPushForCurrentModule(pathname = window.location.pathname) {
  const moduleName = normalizeModuleFromPath(pathname);
  if (moduleName === "admin") return false;

  const accessToken = localStorage.getItem(`${moduleName}_accessToken`);
  if (!accessToken) return false;

  initPushNotificationClient();

  const supportsBrowserPush = isSupportedBrowser() && isSecureContextForPush();

  if (supportsBrowserPush) {
    if (registrationInFlight) return registrationInFlight;

    registrationInFlight = (async () => {
      const firebasePublicEnv = await getFirebasePublicEnv();
      if (!firebasePublicEnv?.vapidKey) {
        console.warn("FCM web registration skipped: FIREBASE_VAPID_KEY is missing in env setup.");
        return;
      }

      const app = getMessagingFirebaseApp(firebasePublicEnv);
      if (!app) {
        console.warn("FCM web registration skipped: Firebase public web config is incomplete.");
        return;
      }

      const permission =
        Notification.permission === "default"
          ? await Notification.requestPermission()
          : Notification.permission;

      if (permission !== "granted") {
        console.warn("FCM web registration skipped: Notification permission not granted.", permission);
        return;
      }

      const { getMessaging, getToken, isSupported } = await import("firebase/messaging");
      const supported = await isSupported().catch(() => false);
      if (!supported) return;

      let registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
      
      // Wait for the service worker to be ready/active before subscribing
      registration = await navigator.serviceWorker.ready;
      
      pushDebugLog(PUSH_DEBUG_PREFIX, "Service worker registered and ready for push", {
        scope: registration.scope,
        moduleName,
      });
      const messaging = getMessaging(app);

      const token = await getToken(messaging, {
        vapidKey: firebasePublicEnv.vapidKey,
        serviceWorkerRegistration: registration,
      });

      if (!token) return;
      pushDebugLog(PUSH_DEBUG_PREFIX, "FCM token resolved", {
        moduleName,
        tokenPreview: `${token.slice(0, 12)}...`,
      });

      // We rely on the API client's internal memory debounce (createSaveFcmTokenOnce) 
      // to prevent spamming the backend, so we don't need localStorage caching here anymore.
      try {
        pushDebugLog(PUSH_DEBUG_PREFIX, "Synchronizing FCM token with backend database", { moduleName, tokenPreview: `${token?.slice(0, 10)}...` });
        await saveTokenByModule(moduleName, token);
        pushDebugLog(PUSH_DEBUG_PREFIX, "FCM token synchronized with backend successfully");
      } catch (e) {
        pushDebugWarn(PUSH_DEBUG_PREFIX, "Failed to synchronize FCM token to backend", { error: e?.message || e, stack: e?.stack });
      }
      
      await attachForegroundListener(app);
    })()
    .catch((e) => {
      console.error("FCM web registration failed:", e);
    })
    .finally(() => {
      registrationInFlight = null;
    });

    return registrationInFlight;
  }

  // Flutter WebView fallback: register native token when browser web push isn't available.
  // This keeps restaurant/delivery FCM alerts working even when Web Push APIs are limited.
  await registerNativeWebViewFcmToken(moduleName);
  return null;
}

