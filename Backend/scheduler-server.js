import { connectDB, disconnectDB } from './src/config/db.js';
import { loadEnvFromDb } from './src/config/envLoader.js';
import { logger } from './src/utils/logger.js';
import { expireExpiredOffers } from './src/modules/food/admin/services/admin.service.js';
import { syncExpiredFssaiNotifications } from './src/modules/food/restaurant/services/fssaiExpiry.service.js';
import { config } from './src/config/env.js';

const startScheduler = async () => {
    try {
        await connectDB();
        await loadEnvFromDb();

        logger.info('Scheduler started.');

        // Watchdog: Recover stuck orders
        try {
            const { recoverStuckOrders } = await import('./src/modules/food/orders/services/order.service.js');
            await recoverStuckOrders();
            setInterval(recoverStuckOrders, 5 * 60 * 1000);
        } catch (err) {
            logger.error(`Watchdog startup error: ${err.message}`);
        }

        // Expire old offers
        const runExpire = async () => {
            try {
                await expireExpiredOffers();
            } catch (err) {
                logger.error(`Expire offers error: ${err.message}`);
            }
        };
        runExpire();
        setInterval(runExpire, 5 * 60 * 1000);

        // Sync FSSAI notifications
        const runFssaiExpirySync = async () => {
            try {
                await syncExpiredFssaiNotifications();
            } catch (err) {
                logger.error(`FSSAI expiry sync error: ${err.message}`);
            }
        };
        runFssaiExpirySync();
        setInterval(runFssaiExpirySync, 60 * 60 * 1000);

        // Restaurant Unaccepted Order Phone Call Alert Poller (every 30 seconds)
        try {
            const { pollAndTriggerRestaurantCallAlerts } = await import('./src/modules/food/orders/services/order-call-alert.service.js');
            pollAndTriggerRestaurantCallAlerts();
            setInterval(pollAndTriggerRestaurantCallAlerts, 30 * 1000);
            logger.info('Restaurant OBD call alert poller initialized (30s interval)');
        } catch (err) {
            logger.error(`Call alert poller startup error: ${err.message}`);
        }
        
        // Create a simple HTTP server for health checks
        const http = await import('http');
        const server = http.createServer((req, res) => {
            if (req.url === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok', service: 'scheduler' }));
            } else {
                res.writeHead(404);
                res.end();
            }
        });
        
        const port = 5002;
        server.listen(port, config.host || '127.0.0.1', () => {
            logger.info(`Scheduler health check running on ${config.host || '127.0.0.1'}:${port}`);
        });

        const shutdown = async () => {
            logger.info('Shutting down Scheduler');
            server.close();
            await disconnectDB();
            process.exit(0);
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    } catch (err) {
        logger.error(`Scheduler startup error: ${err.message}`);
        process.exit(1);
    }
};

startScheduler();
