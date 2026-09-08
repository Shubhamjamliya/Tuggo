import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const errorHandler = (err, req, res, next) => {
    const statusCode = err.statusCode || 500;
    const message = err.error?.description || err.description || err.message || (typeof err.error === 'string' ? err.error : 'Server Error');
    const requestId = req.requestId || '-';

    logger.error(
        `[${requestId}] ${req.method} ${req.originalUrl} ${statusCode} - ${err.name || 'Error'} - ${message}`
    );
    if (config.nodeEnv === 'development' && (err.stack || err.error)) {
        logger.error(`[${requestId}] ${err.stack || JSON.stringify(err.error)}`);
    }

    res.status(statusCode).json({
        success: false,
        error: message
    });
};

export default errorHandler;
