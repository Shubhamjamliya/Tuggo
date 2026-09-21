import mongoose from 'mongoose';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

export const connectDB = async () => {
    try {
        const isLocal = config.mongodbUri.includes('127.0.0.1') || config.mongodbUri.includes('localhost');
        const conn = await mongoose.connect(config.mongodbUri, {
            maxPoolSize: 100,       // Handle up to 100 concurrent DB operations (default is ~5-10)
            minPoolSize: 5,         // Keep 5 connections warm for instant response
            socketTimeoutMS: 45000, // Timeout idle sockets after 45s
        });
        if (isLocal) {
            logger.info(`✅ MongoDB Connected to [LOCAL]: ${conn.connection.host}/${conn.connection.name}`);
        } else {
            logger.warn(`⚠️  MongoDB Connected to [PRODUCTION / ATLAS]: ${conn.connection.host}/${conn.connection.name}`);
        }
    } catch (error) {
        logger.error(`MongoDB connection error: ${error.message}`);
        process.exit(1);
    }
};

/**
 * Close MongoDB connection (e.g. graceful shutdown).
 * @returns {Promise<void>}
 */
export const disconnectDB = async () => {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
};
