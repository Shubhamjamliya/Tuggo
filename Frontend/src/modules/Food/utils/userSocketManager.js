import io from 'socket.io-client';
import { isValidSocketOrigin, resolveSocketOrigin } from '@food/utils/socketOrigin';
import { getModuleToken } from '@food/utils/auth';

let socket = null;
let connectionUserId = null;
let refCount = 0;

const locationListeners = new Set();
const connectedListeners = new Set();
const joinedTrackingRooms = new Set();

let isConnected = false;

function getAuthToken() {
  return getModuleToken('user') || localStorage.getItem('accessToken') || '';
}

function notifyLocationListeners(data) {
  locationListeners.forEach((fn) => {
    try {
      fn(data);
    } catch {
      // ignore listener errors
    }
  });
}

function notifyConnectedListeners(connected) {
  isConnected = connected;
  connectedListeners.forEach((fn) => {
    try {
      fn(connected);
    } catch {
      // ignore listener errors
    }
  });
  if (typeof window !== 'undefined') {
    window.orderSocketConnected = connected;
  }
}

function reconnectUserSocketWithToken(newToken) {
  if (!socket || !newToken) return;
  socket.auth = { token: newToken };
  if (socket.io?.opts) {
    socket.io.opts.query = { token: newToken };
  }
  if (socket.connected) {
    socket.disconnect();
  }
  socket.connect();
}

function attachCoreListeners(sock) {
  sock.off('location-update');
  sock.on('location-update', (data) => notifyLocationListeners(data));

  sock.off('connect');
  sock.on('connect', () => {
    notifyConnectedListeners(true);
    joinedTrackingRooms.forEach((id) => sock.emit('join-tracking', id));
    sock.emit('resync');
  });

  sock.off('disconnect');
  sock.on('disconnect', () => notifyConnectedListeners(false));

  sock.off('connect_error');
  sock.on('connect_error', () => notifyConnectedListeners(false));
}

function createUserSocket(userId, token) {
  const origin = resolveSocketOrigin();
  if (!isValidSocketOrigin(origin)) return null;

  connectionUserId = String(userId);
  socket = io(origin, {
    path: '/socket.io/',
    transports: ['websocket', 'polling'],
    reconnection: true,
    auth: { token },
    query: { token },
  });

  attachCoreListeners(socket);
  return socket;
}

/**
 * Shared Socket.IO connection for Food user module (order status + live tracking).
 * Reference-counted so map + notification hooks share one connection.
 */
export function acquireUserSocket(userId) {
  const token = getAuthToken();
  if (!token || !userId) return null;

  refCount += 1;

  if (socket && connectionUserId === String(userId)) {
    return socket;
  }

  if (socket) {
    socket.disconnect();
    socket = null;
    joinedTrackingRooms.clear();
  }

  return createUserSocket(userId, token);
}

export function releaseUserSocket() {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0) return;

  if (socket) {
    socket.disconnect();
    socket = null;
  }
  connectionUserId = null;
  joinedTrackingRooms.clear();
  notifyConnectedListeners(false);
}

export function getUserSocket() {
  return socket;
}

export function isUserSocketConnected() {
  return isConnected;
}

export function subscribeUserSocketConnection(listener) {
  connectedListeners.add(listener);
  listener(isConnected);
  return () => connectedListeners.delete(listener);
}

export function subscribeLocationUpdates(listener) {
  locationListeners.add(listener);
  return () => locationListeners.delete(listener);
}

export function joinOrderTrackingRooms(orderIds = []) {
  const ids = [...new Set(orderIds.map((id) => String(id || '').trim()).filter(Boolean))];
  ids.forEach((id) => joinedTrackingRooms.add(id));
  if (socket?.connected) {
    ids.forEach((id) => socket.emit('join-tracking', id));
  }
}

export function leaveOrderTrackingRooms(orderIds = []) {
  orderIds.forEach((id) => {
    const key = String(id || '').trim();
    if (!key) return;
    joinedTrackingRooms.delete(key);
    if (socket?.connected) socket.emit('leave-tracking', key);
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('authRefreshed', (event) => {
    if (event.detail?.module !== 'user' || !event.detail?.token || !socket) return;
    reconnectUserSocketWithToken(event.detail.token);
  });
}

