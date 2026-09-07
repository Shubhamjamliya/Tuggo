import { Server } from 'socket.io';
import { Emitter } from '@socket.io/redis-emitter';
import { config } from './env.js';
import { logger } from '../utils/logger.js';
import { haversineMeters, shouldBroadcastLocation } from '../utils/geo.js';
import { verifyAccessToken } from '../core/auth/token.util.js';
import { getFirebaseDB } from './firebase.js';

let io = null;
let redisEmitter = null;

function logDeliverySocket(message, extra = {}) {
    const suffix = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : '';
    logger.info(`[DeliverySocket] ${message}${suffix}`);
}

function getTokenFromHandshake(socket) {
    const authToken = socket?.handshake?.auth?.token;
    if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();
    const header = socket?.handshake?.headers?.authorization || socket?.handshake?.headers?.Authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) return header.substring(7).trim();
    const queryToken = socket?.handshake?.query?.token;
    if (typeof queryToken === 'string' && queryToken.trim()) return queryToken.trim();
    return null;
}

function maskToken(token) {
    if (!token || typeof token !== 'string') return null;
    const trimmed = token.trim();
    if (!trimmed) return null;
    return `${trimmed.slice(0, 12)}...${trimmed.slice(-6)}`;
}

const roomNames = {
    restaurant: (id) => `restaurant:${String(id)}`,
    user: (id) => `user:${String(id)}`,
    delivery: (id) => `delivery:${String(id)}`,
    tracking: (orderId) => `tracking:${String(orderId)}`
};

/**
 * Initializes Socket.IO with the provided HTTP server.
 * When REDIS_ENABLED=true and REDIS_URL is set, attaches Redis adapter for horizontal scaling.
 * @param {import('http').Server} server
 * @returns {Promise<Server>}
 */
export const initSocket = async (server) => {
    logger.info(
        `[SocketInit] initSocket called redisEnabled=${config.redisEnabled} redisUrlPresent=${Boolean(config.redisUrl)} socketCorsOrigin=${config.socketCorsOrigin}`
    );
    io = new Server(server, {
        cors: {
            origin: config.socketCorsOrigin,
            methods: ['GET', 'POST']
        }
    });

    // Socket auth middleware (Bearer token).
    io.use((socket, next) => {
        try {
            const token = getTokenFromHandshake(socket);
            if (!token) {
                logger.warn(`Socket auth failed: token missing for socket ${socket.id}`);
                logger.warn(`[DeliverySocket] Handshake auth missing`, {
                    socketId: socket.id,
                    origin: socket?.handshake?.headers?.origin || null,
                    host: socket?.handshake?.headers?.host || null,
                    userAgent: socket?.handshake?.headers?.['user-agent'] || null,
                    hasAuthToken: Boolean(socket?.handshake?.auth?.token),
                    hasAuthorizationHeader: Boolean(
                        socket?.handshake?.headers?.authorization || socket?.handshake?.headers?.Authorization
                    ),
                    hasQueryToken: Boolean(socket?.handshake?.query?.token),
                });
                return next(new Error('AUTH_MISSING'));
            }
            logger.info(`[DeliverySocket] Handshake token received`, {
                socketId: socket.id,
                origin: socket?.handshake?.headers?.origin || null,
                host: socket?.handshake?.headers?.host || null,
                transport: socket?.handshake?.query?.transport || null,
                tokenPreview: maskToken(token),
            });
            const decoded = verifyAccessToken(token);
            socket.user = { userId: decoded.userId, role: decoded.role };
            logger.info(`Socket auth success: ${decoded.role}:${decoded.userId} for socket ${socket.id}`);
            return next();
        } catch (err) {
            logger.error(`Socket auth failed for socket ${socket.id}: ${err.message}`);
            logger.error(`[DeliverySocket] Handshake auth invalid`, {
                socketId: socket.id,
                origin: socket?.handshake?.headers?.origin || null,
                host: socket?.handshake?.headers?.host || null,
                transport: socket?.handshake?.query?.transport || null,
                tokenPreview: maskToken(getTokenFromHandshake(socket)),
                errorMessage: err.message,
                errorName: err.name || null,
            });
            return next(new Error('AUTH_INVALID'));
        }
    });

    if (config.redisEnabled && config.redisUrl) {
        try {
            const { createAdapter } = await import('@socket.io/redis-adapter');
            const { createClient } = await import('redis');
            const pubClient = createClient({ url: config.redisUrl });
            const subClient = pubClient.duplicate();
            pubClient.on('error', (err) => logger.error(`Socket.IO Redis pub client: ${err.message}`));
            subClient.on('error', (err) => logger.error(`Socket.IO Redis sub client: ${err.message}`));
            await Promise.all([pubClient.connect(), subClient.connect()]);
            io.adapter(createAdapter(pubClient, subClient));
            logger.info('Socket.IO Redis adapter attached for horizontal scaling');
        } catch (err) {
            logger.warn(`Socket.IO Redis adapter skipped (using in-memory): ${err.message}`);
        }
    }

    io.on('connection', (socket) => {
        const userId = socket.user?.userId;
        const role = socket.user?.role;
        logger.info(`Socket client connected: ${socket.id} (${role || 'UNKNOWN'}:${userId || '-'})`);

        // Auto-join role rooms (lets us emit without a custom join).
        if (userId && role) {
            if (role === 'RESTAURANT') socket.join(roomNames.restaurant(userId));
            if (role === 'USER') socket.join(roomNames.user(userId));
            if (role === 'ADMIN') socket.join('admin'); // Admin panel broadcasts
            if (role === 'DELIVERY_PARTNER') {
                socket.join(roomNames.delivery(userId));
                socket.join('all_delivery'); // Global delivery broadcast room
                logDeliverySocket('Auto-joined delivery room on connect', {
                    socketId: socket.id,
                    deliveryPartnerId: String(userId),
                    room: roomNames.delivery(userId),
                });
            }
        }

        // Generic joinRoom (used by Admin bulk upload page)
        socket.on('joinRoom', (roomName) => {
            if (typeof roomName === 'string' && roomName.trim()) {
                socket.join(roomName.trim());
                logger.info(`Socket ${socket.id} (${role}:${userId}) joined room: ${roomName.trim()}`);
            }
        });

        // Explicit join (used by existing restaurant client hook).
        socket.on('join-restaurant', (restaurantId) => {
            if (socket.user?.role !== 'RESTAURANT') return;
            // Security: only join your own restaurant room.
            if (String(socket.user?.userId) !== String(restaurantId)) return;
            socket.join(roomNames.restaurant(restaurantId));
            socket.emit('restaurant-room-joined', { room: roomNames.restaurant(restaurantId), restaurantId: String(restaurantId) });
        });

        // Explicit join (used by existing delivery client hook).
        socket.on('join-delivery', (deliveryPartnerId) => {
            if (socket.user?.role !== 'DELIVERY_PARTNER') {
                logDeliverySocket('Rejected join-delivery for non-delivery role', {
                    socketId: socket.id,
                    role: socket.user?.role || 'UNKNOWN',
                    requestedDeliveryPartnerId: String(deliveryPartnerId || ''),
                });
                return;
            }
            // Security: only join your own delivery room.
            if (String(socket.user?.userId) !== String(deliveryPartnerId)) {
                logDeliverySocket('Rejected join-delivery due to user mismatch', {
                    socketId: socket.id,
                    authDeliveryPartnerId: String(socket.user?.userId || ''),
                    requestedDeliveryPartnerId: String(deliveryPartnerId || ''),
                });
                return;
            }
            const room = roomNames.delivery(deliveryPartnerId);
            socket.join(room);
            const roomSize = io?.sockets?.adapter?.rooms?.get(room)?.size || 0;
            logDeliverySocket('Delivery room joined', {
                socketId: socket.id,
                deliveryPartnerId: String(deliveryPartnerId),
                room,
                roomSize,
            });
            socket.emit('delivery-room-joined', { room, deliveryPartnerId: String(deliveryPartnerId) });
        });

        // â”€â”€â”€ Live Tracking Events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        // Users / restaurants subscribe to an order's real-time tracking room.
        socket.on('join-tracking', (orderId) => {
            if (!orderId) return;
            const role = socket.user?.role;
            if (role !== 'USER' && role !== 'RESTAURANT' && role !== 'DELIVERY_PARTNER') return;
            const room = roomNames.tracking(orderId);
            socket.join(room);
            logger.info(`Socket ${socket.id} (${role}:${userId}) joined tracking room ${room}`);
            socket.emit('tracking-room-joined', { room, orderId: String(orderId) });
        });

        // Delivery partner emits live GPS location for an active order.
        // Broadcasts to the tracking room so users see the bike move in real time.
        const _lastLocationBroadcast = {};
        const _lastPolylineBroadcast = {}; // Separate throttle for heavy polyline data
        socket.on('update-location', async (data) => {
            if (socket.user?.role !== 'DELIVERY_PARTNER') return;
            if (!data || !data.orderId) return;

            const lat = Number(data.lat);
            const lng = Number(data.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

            const heading = Number.isFinite(Number(data.heading)) ? Number(data.heading) : 0;
            const speed = Number.isFinite(Number(data.speed)) ? Number(data.speed) : 0;
            const accuracy = Number.isFinite(Number(data.accuracy)) ? Number(data.accuracy) : null;

            // Throttle: max one broadcast per 10s per orderId
            // (reduces server→client events and network consumption)
            const now = Date.now();
            const lastTS = _lastLocationBroadcast[data.orderId] || 0;
            if (now - lastTS < 10000) return;
            _lastLocationBroadcast[data.orderId] = now;

            // ── MINIFIED tracking payload (sent to users watching the map) ──
            // Only essential fields for 60fps client-side interpolation.
            // Polyline/ETA are large strings that rarely change — sent on 30s cadence.
            const trackingPayload = {
                orderId: String(data.orderId),
                deliveryPartnerId: String(userId),
                lat,
                lng,
                heading,
                speed,
                timestamp: now,
                status: data.status || 'on_the_way',
            };

            // Send polyline/eta only every 30 seconds (they're large and change rarely)
            const lastPolyTS = _lastPolylineBroadcast[data.orderId] || 0;
            if (now - lastPolyTS >= 30000) {
                _lastPolylineBroadcast[data.orderId] = now;
                if (data.polyline) trackingPayload.polyline = data.polyline;
                if (data.eta != null && data.eta !== '') trackingPayload.eta = data.eta;
            }

            logDeliverySocket('Location update received', {
                socketId: socket.id,
                deliveryPartnerId: String(userId),
                orderId: String(data.orderId),
                lat,
                lng,
                status: data.status || 'on_the_way',
            });

            // Broadcast to tracking room (all users watching this order)
            const trackingRoom = roomNames.tracking(data.orderId);
            socket.to(trackingRoom).emit('location-update', trackingPayload);

            // Also emit to the specific user room if userId is provided
            if (data.userId) {
                socket.to(roomNames.user(data.userId)).emit('location-update', trackingPayload);
            }

            if (data.restaurantId) {
                socket.to(roomNames.restaurant(data.restaurantId)).emit('location-update', trackingPayload);
            }

            // â”€â”€â”€ Scalable Persistence (BullMQ + Redis "Hot" Buffering) â”€â”€â”€
            try {
                const { getTrackingQueue } = await import('../queues/index.js');
                const { getRedisClient } = await import('../config/redis.js');
                const trackingQueue = getTrackingQueue();
                const redis = getRedisClient();

                if (trackingQueue && redis) {
                    const coordString = JSON.stringify({ lat, lng, timestamp: now });
                    
                    // 1. Immediately buffer the newest location in high-speed Redis Hash (HOT storage)
                    await Promise.all([
                        redis.hSet('rider:locations:hot', String(userId), coordString),
                        redis.hSet('order:locations:hot', String(data.orderId), coordString)
                    ]);

                    // 2. Schedule a deferred MongoDB write (COLD storage)
                    // jobId debulks updates: if a job is already waiting, BullMQ ignores the new add()
                    // Delay (30s) ensures we don't spam MongoDB while the rider is moving fast
                    const syncJobId = `sync:loc:${data.orderId}`;
                    trackingQueue.add('sync-hot-locations', 
                        { userId, orderId: data.orderId }, 
                        { jobId: syncJobId, delay: 30000, removeOnComplete: true }
                    ).catch(e => logger.error(`BullMQ sync schedule failed: ${e.message}`));
                }
            } catch (err) {
                logger.error(`Real-time persistence layer error: ${err.message}`);
            }

            // â”€â”€â”€ Firebase Realtime Database Sync (Cost Optimization) â”€â”€â”€
            try {
                const db = getFirebaseDB();
                if (db) {
                    // 1. Update order-specific tracking node
                    const orderRef = db.ref(`active_orders/${data.orderId}`);
                    orderRef.update({
                        lat,
                        lng,
                        heading,
                        speed,
                        accuracy,
                        last_updated: now,
                        status: data.status || 'on_the_way',
                        ...(data.polyline ? { polyline: data.polyline } : {}),
                        ...(data.eta != null && data.eta !== '' ? { eta: data.eta } : {}),
                    }).catch(e => logger.error(`Firebase orderRef update error: ${e.message}`));

                    // 2. Update global delivery boy status node
                    const boyRef = db.ref(`delivery_boys/${userId}`);
                    boyRef.update({
                        lat,
                        lng,
                        accuracy,
                        last_updated: now,
                        status: 'online'
                    }).catch(e => logger.error(`Firebase boyRef update error: ${e.message}`));
                }
            } catch (err) {
                // Silently skip if Firebase not initialized yet
                logger.debug(`Firebase RTDB sync skipped: ${err.message}`);
            }
        });

        // Leave tracking room on user navigation away.
        socket.on('leave-tracking', (orderId) => {
            if (!orderId) return;
            const room = roomNames.tracking(orderId);
            socket.leave(room);
        });

        socket.on('disconnect', () => {
            logger.info(`Socket client disconnected: ${socket.id}`);
            if (role === 'DELIVERY_PARTNER') {
                logDeliverySocket('Delivery socket disconnected', {
                    socketId: socket.id,
                    deliveryPartnerId: String(userId || ''),
                });
            }
        });

        // ðŸ†• Resync State on Reconnect
        socket.on('resync', async () => {
          try {
            if (role === 'DELIVERY_PARTNER') {
              logDeliverySocket('Resync requested', {
                socketId: socket.id,
                deliveryPartnerId: String(userId || ''),
              });
            }
            const { resyncState } = await import('../modules/food/orders/services/order.service.js');
            const state = await resyncState(userId, role);
            if (state.activeOrder) {
              const eventName = role === 'USER' ? 'order_state' : 'active_order';
              socket.emit(eventName, state.activeOrder);
              if (role === 'DELIVERY_PARTNER') {
                logDeliverySocket('Resync emitted active order', {
                  socketId: socket.id,
                  deliveryPartnerId: String(userId || ''),
                  orderId: String(
                    state.activeOrder?.orderId ||
                    state.activeOrder?.orderMongoId ||
                    ''
                  ),
                  eventName,
                });
              }
              
              // Re-emit OTP if user is in drop phase
              if (role === 'USER' && state.activeOrder.handoverOtp) {
                socket.emit('delivery_drop_otp', {
                  orderId: state.activeOrder.orderId,
                  otp: state.activeOrder.handoverOtp,
                  message: 'Share this OTP with your delivery partner.'
                });
              }
            }

            if (
              role === 'DELIVERY_PARTNER' &&
              Array.isArray(state.pendingOffers) &&
              state.pendingOffers.length > 0
            ) {
              logDeliverySocket('Resync recovered pending offers', {
                socketId: socket.id,
                deliveryPartnerId: String(userId || ''),
                pendingOfferCount: state.pendingOffers.length,
              });

              socket.emit('pending_offers', {
                offers: state.pendingOffers,
                count: state.pendingOffers.length,
                recoveredAt: Date.now(),
              });

              for (const offer of state.pendingOffers) {
                socket.emit('new_order_available', {
                  ...offer,
                  recovered: true,
                  recoveredAt: Date.now(),
                });
              }
            }

            socket.emit('resync_complete', { timestamp: Date.now() });
            if (role === 'DELIVERY_PARTNER') {
              logDeliverySocket('Resync complete', {
                socketId: socket.id,
                deliveryPartnerId: String(userId || ''),
                hasActiveOrder: Boolean(state.activeOrder),
                pendingOfferCount: Array.isArray(state.pendingOffers) ? state.pendingOffers.length : 0,
              });
            }
          } catch (err) {
            logger.error(`Resync failed for ${role}:${userId} â€” ${err.message}`);
          }
        });
    });

    logger.info('Socket.IO infrastructure initialized');
    return io;
};

export const initRedisEmitter = (redisClient) => {
    if (redisClient && !redisEmitter) {
        redisEmitter = new Emitter(redisClient);
        logger.info('Redis Emitter initialized for API broadcasting.');
        return;
    }

    if (!redisClient) {
        logger.warn('[SocketInit] initRedisEmitter called without a Redis client');
        return;
    }

    logger.info('[SocketInit] Redis emitter already initialized; reusing existing emitter');
};

/**
 * Returns the initialized Socket.IO instance or Redis Emitter.
 * @returns {Server | Emitter | null}
 */
export const getIO = () => {
    if (io) return io;
    if (redisEmitter) return redisEmitter;
    
    logger.warn(
        `[SocketInit] Socket.IO not initialized (No local Server or Redis Emitter). redisEnabled=${config.redisEnabled} redisUrlPresent=${Boolean(config.redisUrl)} pid=${process.pid}`
    );
    
    // Return a mock object to prevent crashes if called when disabled
    return {
        to: () => ({ emit: () => {} }),
        emit: () => {}
    };
};

export const rooms = roomNames;
