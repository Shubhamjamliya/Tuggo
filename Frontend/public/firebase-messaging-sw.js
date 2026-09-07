/* eslint-disable no-undef */
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

const sanitize = (value) => String(value || "").trim().replace(/^['"]|['"]$/g, "");
const PUSH_DEBUG_PREFIX = "[push-sw]";
const pushDebugLog = () => {};
let firebaseMessagingReady = false;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});
const getNotificationKey = (payload) => {
  const fcmId = payload?.messageId || payload?.data?.messageId || payload?.data?.notificationId;
  if (fcmId) return String(fcmId);

  const title = (payload?.notification?.title || payload?.data?.title || "").trim();
  const body = (payload?.notification?.body || payload?.data?.body || "").trim();
  const orderId = payload?.data?.orderId || "";
  
  if (!title && !body && !orderId) return "unknown";

  return [
    title.toLowerCase(),
    body.toLowerCase(),
    orderId
  ].join("|");
};

async function notifyOpenClients(payload) {
  pushDebugLog(PUSH_DEBUG_PREFIX, "Broadcasting push to open clients", { payload });
  const windowClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
  windowClients.forEach((client) => {
    client.postMessage({
      type: "push-notification-received",
      payload,
    });
  });
}

function getTargetPathFromPayload(payload = {}) {
  const rawTarget =
    payload?.data?.targetUrl ||
    payload?.data?.link ||
    payload?.data?.click_action ||
    payload?.fcmOptions?.link ||
    "/";

  try {
    const url = new URL(rawTarget, self.location.origin);
    return url.pathname || "/";
  } catch {
    return "/";
  }
}

async function hasVisibleClientForTarget(payload = {}) {
  const windowClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
  const targetPath = getTargetPathFromPayload(payload);
  const targetRoot = `/${String(targetPath).split("/").filter(Boolean)[0] || ""}`;
  const visibleClient = windowClients.find((client) => {
    const isVisible = client.visibilityState === "visible" || client.focused;
    if (!isVisible) return false;
    try {
      const clientUrl = new URL(client.url);
      if (targetRoot === "/" || !targetRoot) {
        return true;
      }
      return clientUrl.pathname.startsWith(targetRoot);
    } catch {
      return false;
    }
  });
  pushDebugLog(PUSH_DEBUG_PREFIX, "Visible client check", {
    count: windowClients.length,
    targetPath,
    targetRoot,
    hasVisibleClient: Boolean(visibleClient),
    clients: windowClients.map((client) => ({
      url: client.url,
      visibilityState: client.visibilityState,
      focused: client.focused,
    })),
  });
  return Boolean(visibleClient);
}

async function handleColdStartPush(payload = {}) {
  const title =
    payload?.notification?.title ||
    payload?.data?.title ||
    "New notification";
  const body = payload?.notification?.body || payload?.data?.body || "";
  const image =
    payload?.notification?.image ||
    payload?.data?.image ||
    payload?.data?.imageUrl ||
    undefined;

  // Do not rely on WindowClient.visibilityState here. Android/iOS browsers can
  // briefly report a minimized client as visible while waking a cold worker,
  // which previously suppressed the only system notification for the push.
  await self.registration.showNotification(title, {
    body,
    icon: payload?.notification?.icon || "/logo.png?v=2",
    image,
    tag: getNotificationKey(payload),
    renotify: true,
    silent: false,
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 300],
    data: payload?.data || {},
  });

  await notifyOpenClients(payload);
}

function loadFirebaseWebConfig() {
  try {
    const params = new URLSearchParams(self.location.search);
    const config = {
      apiKey: sanitize(params.get("apiKey")),
      authDomain: sanitize(params.get("authDomain")),
      projectId: sanitize(params.get("projectId")),
      appId: sanitize(params.get("appId")),
      messagingSenderId: sanitize(params.get("messagingSenderId")),
      storageBucket: sanitize(params.get("storageBucket")),
      measurementId: sanitize(params.get("measurementId")),
    };

    if (config.apiKey && config.projectId && config.appId && config.messagingSenderId) {
      pushDebugLog(PUSH_DEBUG_PREFIX, "Loaded Firebase web config from query params");
      return config;
    }
  } catch {
    // fallback
  }

  return {
    apiKey: "AIzaSyAC_N9ZTat6Pt_1mh78Q92KJDp20FOHor8",
    authDomain: "demotuggo.firebaseapp.com",
    projectId: "demotuggo",
    storageBucket: "demotuggo.firebasestorage.app",
    messagingSenderId: "841927628612",
    appId: "1:841927628612:web:1634e9e4f4faa8e7472911",
    measurementId: "G-PZG4TFCQLW",
  };
}

(async () => {
  const config = loadFirebaseWebConfig();
  if (!config || !config.apiKey || !config.projectId || !config.appId || !config.messagingSenderId) {
    return;
  }

  firebase.initializeApp(config);
  pushDebugLog(PUSH_DEBUG_PREFIX, "Firebase messaging service worker initialized");
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage(async (payload) => {
    
    const visibleClient = await hasVisibleClientForTarget(payload);
    
    // 💡 IMPORTANT: If the payload contains a 'notification' object, the browser/FCM SDK
    // will often display a system notification automatically in the background.
    // To prevent double notifications (one from browser, one from our manual call),
    // we only call showNotification manually if 'notification' is missing (Data-only message)
    // AND there is no visible window for the user.
    if (!visibleClient && !payload.notification) {
      const title = payload?.data?.title || "New Notification";
      const body = payload?.data?.body || "";
      const image =
        payload?.data?.image ||
        payload?.data?.imageUrl ||
        undefined;
      const notificationKey = getNotificationKey(payload);
      
      pushDebugLog(PUSH_DEBUG_PREFIX, "Showing manual service worker notification (Data-only message)", {
        title,
        body,
        image,
        notificationKey,
      });
  
      self.registration.showNotification(title, {
        body,
        icon: "/logo.png?v=2",
        image,
        tag: notificationKey,
        renotify: true,
        silent: false,
        requireInteraction: true,
        vibrate: [200, 100, 200, 100, 300],
        data: payload?.data || {},
      });
    }

    // Always notify clients regardless of visibility
    await notifyOpenClients(payload);
  });
  firebaseMessagingReady = true;
})();

self.addEventListener("push", (event) => {
  if (!event.data) return;

  try {
    const payload = event.data.json();
    pushDebugLog(PUSH_DEBUG_PREFIX, "Received raw push event", { payload });
    // On a mobile cold start the push can arrive while runtime Firebase config is
    // still loading. In that case Firebase has not attached its background handler
    // yet, so display the notification directly instead of losing the event.
    // Once Firebase is ready, its handler owns delivery to avoid duplicates.
    if (!firebaseMessagingReady) {
      event.waitUntil(handleColdStartPush(payload));
    }
  } catch {
    // Ignore malformed payloads.
  }
});

self.addEventListener("notificationclick", (event) => {
  pushDebugLog(PUSH_DEBUG_PREFIX, "Notification click received", {
    data: event?.notification?.data || {},
  });
  event.notification.close();
  const rawLink =
    event?.notification?.data?.link ||
    event?.notification?.data?.click_action ||
    event?.notification?.data?.targetUrl ||
    "/";
  const targetUrl = String(rawLink || "/").startsWith("/") ? String(rawLink || "/") : "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      const client = windowClients.find((c) => c.url.includes(self.location.origin));
      if (client) {
        client.focus();
        return client.navigate(targetUrl);
      }
      return clients.openWindow(targetUrl);
    }),
  );
});
