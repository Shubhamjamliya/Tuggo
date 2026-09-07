import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoSanitize from 'mongo-sanitize';
import xssClean from 'xss-clean';
import routes from './routes/index.js';
import errorHandler from './middleware/errorHandler.js';
import { apiRateLimiter } from './middleware/rateLimit.js';
import { responseTimeLogger } from './middleware/responseTimeLogger.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { healthCheck } from './config/health.js';
import { config } from './config/env.js';
import compression from 'compression';
import path from 'path';

const app = express();

// Add compression middleware to compress JSON payloads (Gzip)
app.use(compression());

// Trust first proxy (essential for express-rate-limit if behind a proxy)
app.set('trust proxy', 1);

// Request ID tracing (before other middlewares so all logs can use it)
app.use(requestIdMiddleware);

// Health endpoints (no rate limit, minimal JSON, no secrets)
app.get('/health', async (_req, res) => {
    try {
        const data = await healthCheck();
        res.status(200).json(data);
    } catch (err) {
        res.status(503).json({ status: 'DOWN', error: 'Health check failed' });
    }
});
app.get('/ready', (_req, res) => {
    res.status(200).json({ status: 'ready' });
});

// Security & parsing middlewares
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "'unsafe-eval'",
                'https://maps.googleapis.com',
                'https://maps.gstatic.com',
                'https://checkout.razorpay.com',
                'blob:'
            ],
            scriptSrcElem: [
                "'self'",
                "'unsafe-inline'",
                'https://maps.googleapis.com',
                'https://maps.gstatic.com',
                'https://checkout.razorpay.com',
                'blob:'
            ],
            connectSrc: [
                "'self'",
                'https://maps.googleapis.com',
                'https://maps.gstatic.com',
                'https://api.razorpay.com',
                'https://checkout.razorpay.com',
                'wss:',
                'ws:'
            ],
            frameSrc: [
                "'self'",
                'https://api.razorpay.com',
                'https://checkout.razorpay.com'
            ]
        }
    },
    hsts: config.nodeEnv === 'production' ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    xssFilter: true,
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({
    limit: '15mb',
    verify: (req, res, buf) => {
        // ✅ Store rawBody for signature verification (Razorpay Webhooks)
        if (req.originalUrl && req.originalUrl.includes('/webhook/razorpay')) {
            req.rawBody = buf;
        }
    }
}));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Protect against NoSQL injection and XSS
app.use((req, _res, next) => {
    req.body = mongoSanitize(req.body);
    req.query = mongoSanitize(req.query);
    req.params = mongoSanitize(req.params);
    next();
});
app.use(xssClean());

// Global rate limiting for API routes has been removed to allow public routes to be free.
// Rate limiting for private routes is now handled inside authMiddleware.

// Optional: log API response time (method, path, status, duration) - no sensitive data
app.use('/api', responseTimeLogger);

// Global logging for any location tracking request to trace foreground/background hits
app.use((req, res, next) => {
    if (req.originalUrl && req.originalUrl.includes('location')) {
        console.log(`\n📥 [RAW_HTTP_HIT] ${req.method} ${req.originalUrl} | Auth: ${req.headers.authorization ? 'Bearer Provided' : 'NO_AUTH_HEADER'} | Body: ${JSON.stringify(req.body || {}).substring(0, 300)}`);
    }
    next();
});

// API Routes (supports both /api/v1/... and /v1/... paths)
app.use('/api', routes);
app.use('/', routes);

// Static file serving for uploads
app.use('/uploads', express.static(path.resolve(config.uploadPath)));

// Error Handling
app.use(errorHandler);

export default app;
