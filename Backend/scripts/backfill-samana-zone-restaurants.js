import mongoose from 'mongoose';

import { connectDB, disconnectDB } from '../src/config/db.js';
import { logger } from '../src/utils/logger.js';
import { FoodRestaurant } from '../src/modules/food/restaurant/models/restaurant.model.js';
import { FoodZone } from '../src/modules/food/admin/models/zone.model.js';

const DEFAULT_ZONE_NAME = 'Samana';

async function resolveSamanaZone() {
    return FoodZone.findOne({
        isActive: true,
        $or: [
            { name: { $regex: `^${DEFAULT_ZONE_NAME}$`, $options: 'i' } },
            { zoneName: { $regex: `^${DEFAULT_ZONE_NAME}$`, $options: 'i' } },
            { serviceLocation: { $regex: `^${DEFAULT_ZONE_NAME}$`, $options: 'i' } }
        ]
    }).select('_id name zoneName serviceLocation').lean();
}

function hasZone(doc) {
    return Boolean(doc?.zoneId && mongoose.Types.ObjectId.isValid(String(doc.zoneId)));
}

function needsSamanaBackfill(doc) {
    if (!doc) return false;
    if (hasZone(doc)) return false;
    if (String(doc.status || '').toLowerCase() !== 'approved') return false;
    return true;
}

function buildUpdatedLocation(location, city) {
    if (!location || typeof location !== 'object') return location;
    return {
        ...location,
        city: String(location.city || city || DEFAULT_ZONE_NAME).trim() || DEFAULT_ZONE_NAME
    };
}

async function main() {
    await connectDB();
    try {
        const samanaZone = await resolveSamanaZone();
        if (!samanaZone?._id) {
            throw new Error(`Zone "${DEFAULT_ZONE_NAME}" not found. Create it before running this backfill.`);
        }

        const docs = await FoodRestaurant.find({
            status: 'approved',
            $or: [{ zoneId: { $exists: false } }, { zoneId: null }]
        })
            .select('_id restaurantName status zoneId city location')
            .lean();

        const targets = docs.filter(needsSamanaBackfill);
        if (targets.length === 0) {
            logger.info('No approved restaurants without a zone were found.');
            return;
        }

        const ops = targets.map((doc) => ({
            updateOne: {
                filter: { _id: doc._id },
                update: {
                    $set: {
                        zoneId: samanaZone._id,
                        city: String(doc.city || DEFAULT_ZONE_NAME).trim() || DEFAULT_ZONE_NAME,
                        location: buildUpdatedLocation(doc.location, doc.city)
                    }
                }
            }
        }));

        await FoodRestaurant.bulkWrite(ops, { ordered: false });
        logger.info(`Assigned zone "${DEFAULT_ZONE_NAME}" to ${targets.length} approved restaurants without a zone.`);
    } finally {
        await disconnectDB();
    }
}

main().catch((error) => {
    logger.error(error?.stack || error?.message || String(error));
    process.exit(1);
});

