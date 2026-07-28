import fs from 'fs/promises';
import dns from 'node:dns/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import XLSX from 'xlsx';

import { connectDB, disconnectDB } from '../src/config/db.js';
import { logger } from '../src/utils/logger.js';
import { FoodRestaurant } from '../src/modules/food/restaurant/models/restaurant.model.js';
import { FoodRestaurantWallet } from '../src/modules/food/restaurant/models/restaurantWallet.model.js';
import { FoodRestaurantOutletTimings } from '../src/modules/food/restaurant/models/outletTimings.model.js';
import { FoodZone } from '../src/modules/food/admin/models/zone.model.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_INPUT = path.join(REPO_ROOT, 'old db', 'restaurants.csv');
const OUTPUT_ROOT = path.join(REPO_ROOT, 'migration-output', 'old-db-restaurants');
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const LEGACY_DEFAULT_ZONE_NAME = 'Samana';

function parseArgs(argv = []) {
    const args = {
        apply: false,
        input: DEFAULT_INPUT,
        outputDir: '',
        limit: 0
    };

    for (const rawArg of argv) {
        const arg = String(rawArg || '').trim();
        if (!arg) continue;

        if (arg === '--apply') {
            args.apply = true;
            continue;
        }

        if (arg === '--help' || arg === '-h') {
            args.help = true;
            continue;
        }

        if (arg.startsWith('--input=')) {
            args.input = arg.slice('--input='.length).trim();
            continue;
        }

        if (arg.startsWith('--output-dir=')) {
            args.outputDir = arg.slice('--output-dir='.length).trim();
            continue;
        }

        if (arg.startsWith('--limit=')) {
            const parsed = Number(arg.slice('--limit='.length).trim());
            args.limit = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
        }
    }

    return args;
}

function printHelp() {
    console.log(`
Old DB restaurant migration

Usage:
  node scripts/migrate-old-db-restaurants.js
  node scripts/migrate-old-db-restaurants.js --apply

Options:
  --apply              Write restaurants into MongoDB
  --input=...          Custom input CSV path
  --output-dir=...     Custom report directory
  --limit=...          Process first N rows only
  --help               Show this help

Default mode:
  Dry run only. Reads old db/restaurants.csv and writes compatibility reports.
`);
}

function toTrimmedString(value) {
    if (value == null) return '';
    const raw = String(value).trim();
    if (!raw || raw.toUpperCase() === 'NULL') return '';
    return raw;
}

function toLowerCollapsed(value) {
    return toTrimmedString(value).toLowerCase().replace(/\s+/g, ' ');
}

function toDigits(value) {
    return toTrimmedString(value).replace(/\D/g, '');
}

function parseBooleanish(value, fallback = false) {
    const raw = toTrimmedString(value).toLowerCase();
    if (!raw) return fallback;
    if (['1', 'true', 'yes'].includes(raw)) return true;
    if (['0', 'false', 'no'].includes(raw)) return false;
    return fallback;
}

function parseNumber(value, fallback = 0) {
    const raw = toTrimmedString(value);
    if (!raw) return fallback;
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function parseDate(value) {
    const raw = toTrimmedString(value);
    if (!raw || raw === '0000-00-00 00:00:00') return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
}

function uniqueStrings(values = []) {
    return Array.from(new Set(values.map((value) => toTrimmedString(value)).filter(Boolean)));
}

function parsePhoneInfo(value) {
    const raw = toTrimmedString(value);
    const digits = toDigits(raw);
    if (!digits) {
        return { normalized: '', digits: '', last10: '', countryCode: '+91' };
    }

    const last10 = digits.slice(-10);
    let countryCode = '+91';
    if (raw.startsWith('+')) {
        const withoutPlus = raw.slice(1).replace(/\D/g, '');
        if (withoutPlus.length > 10) {
            countryCode = `+${withoutPlus.slice(0, withoutPlus.length - 10)}`;
        }
    } else if (digits.length > 10) {
        countryCode = `+${digits.slice(0, digits.length - 10)}`;
    }

    return {
        normalized: `${countryCode}${last10}`,
        digits,
        last10,
        countryCode
    };
}

function parseJsonObject(value, fallback = {}) {
    const raw = toTrimmedString(value);
    if (!raw) return fallback;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch {
        return fallback;
    }
}

function normalizeTime(value) {
    const raw = toTrimmedString(value);
    if (!raw) return '';
    const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!match) return '';
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return '';
    }
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function parseAddressParts(address) {
    const raw = toTrimmedString(address);
    if (!raw) {
        return {
            addressLine1: '',
            area: '',
            city: '',
            state: ''
        };
    }

    const segments = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
    const parsedCity = segments.length > 1 ? segments[segments.length - 1] : '';
    const city = parsedCity || LEGACY_DEFAULT_ZONE_NAME;
    return {
        addressLine1: raw,
        area: parsedCity || raw,
        city,
        state: ''
    };
}

function parseLatLng(latValue, lngValue) {
    const latitude = Number(latValue);
    const longitude = Number(lngValue);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return {
        latitude,
        longitude,
        coordinates: [longitude, latitude]
    };
}

function parseRatingDistribution(value) {
    const obj = parseJsonObject(value, {});
    const entries = Object.entries(obj);
    if (entries.length === 0) {
        return { rating: 0, totalRatings: 0 };
    }

    let weighted = 0;
    let count = 0;
    for (const [starRaw, qtyRaw] of entries) {
        const star = Number(starRaw);
        const qty = Number(qtyRaw);
        if (!Number.isFinite(star) || !Number.isFinite(qty) || qty <= 0) continue;
        weighted += star * qty;
        count += qty;
    }

    if (!count) return { rating: 0, totalRatings: 0 };
    return {
        rating: Math.max(0, Math.min(5, Number((weighted / count).toFixed(1)))),
        totalRatings: count
    };
}

function parseGst(value) {
    const gst = parseJsonObject(value, {});
    const code = toTrimmedString(gst.code);
    const enabled = parseBooleanish(gst.status, false) && Boolean(code);
    return {
        gstRegistered: enabled,
        gstNumber: enabled ? code : ''
    };
}

function parseOffer(row) {
    const enabled = parseBooleanish(row.offer, false);
    const offerType = toTrimmedString(row.offer_type).toLowerCase();
    const offerValue = parseNumber(row.offer_value, 0);
    const maxDiscount = parseNumber(row.max_discount, 0);

    if (!enabled) {
        return {
            offer: '',
            discount: 0
        };
    }

    if (offerType === 'percent' || offerType === 'percentage') {
        return {
            offer: maxDiscount > 0 ? `Legacy ${offerValue}% off up to ${maxDiscount}` : `Legacy ${offerValue}% off`,
            discount: Math.max(0, Math.min(100, offerValue))
        };
    }

    if (offerType === 'flat') {
        return {
            offer: maxDiscount > 0 ? `Legacy flat ${offerValue} off up to ${maxDiscount}` : `Legacy flat ${offerValue} off`,
            discount: 0
        };
    }

    return {
        offer: 'Legacy offer',
        discount: 0
    };
}

function buildOpenDays(openingTime, closingTime) {
    if (!openingTime || !closingTime) return [];
    return [...DAY_NAMES];
}

function buildOutletTimingsDoc(restaurantId, openingTime, closingTime, createdAt, updatedAt) {
    if (!openingTime || !closingTime) return null;
    return {
        restaurantId,
        timings: DAY_NAMES.map((day) => ({
            day,
            isOpen: true,
            openingTime,
            closingTime
        })),
        createdAt,
        updatedAt
    };
}

function ensureDir(dirPath) {
    return fs.mkdir(dirPath, { recursive: true });
}

function getOutputDir(customOutputDir = '') {
    if (customOutputDir) return path.resolve(customOutputDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(OUTPUT_ROOT, stamp);
}

async function writeJson(filePath, data) {
    await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readCsvRows(filePath) {
    const workbook = XLSX.readFile(filePath, { raw: false, cellDates: false });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
}

function buildPreparedRestaurants(rows) {
    const seenUniqueKeys = new Map();
    const prepared = [];
    const issues = [];

    for (const row of rows) {
        const legacyId = toTrimmedString(row.id || row.vendor_id);
        const restaurantName = toTrimmedString(row.name);
        const phoneInfo = parsePhoneInfo(row.phone);
        const ownerPhone = phoneInfo.normalized;
        const createdAt = parseDate(row.created_at) || new Date();
        const updatedAt = parseDate(row.updated_at) || createdAt;

        if (!legacyId) {
            issues.push({ type: 'missing_legacy_id', row });
            continue;
        }

        if (!restaurantName) {
            issues.push({ type: 'missing_restaurant_name', legacyId, row });
            continue;
        }

        if (!phoneInfo.last10) {
            issues.push({ type: 'missing_phone', legacyId, row });
            continue;
        }

        const uniqueKey = `${toLowerCollapsed(restaurantName)}|${phoneInfo.last10}`;
        if (seenUniqueKeys.has(uniqueKey)) {
            issues.push({
                type: 'duplicate_restaurant_key',
                legacyId,
                duplicateOf: seenUniqueKeys.get(uniqueKey),
                uniqueKey
            });
            continue;
        }
        seenUniqueKeys.set(uniqueKey, legacyId);

        const addressParts = parseAddressParts(row.address);
        const point = parseLatLng(row.latitude, row.longitude);
        const ratingData = parseRatingDistribution(row.rating);
        const gstData = parseGst(row.gst);
        const offerData = parseOffer(row);
        const openingTime = normalizeTime(row.opening_time);
        const closingTime = normalizeTime(row.closeing_time);
        const openDays = buildOpenDays(openingTime, closingTime);
        const isAcceptingOrders = parseBooleanish(row.status, false) && parseBooleanish(row.active, true);
        const pureVegRestaurant = parseBooleanish(row.veg, false) && !parseBooleanish(row.non_veg, false);
        const objectId = new mongoose.Types.ObjectId();

        const doc = {
            _id: objectId,
            restaurantName,
            ownerName: restaurantName,
            ownerEmail: toTrimmedString(row.email).toLowerCase(),
            ownerPhone,
            restaurantNameNormalized: toLowerCollapsed(restaurantName),
            ownerPhoneDigits: phoneInfo.digits || undefined,
            ownerPhoneLast10: phoneInfo.last10 || undefined,
            primaryContactNumber: ownerPhone,
            pureVegRestaurant,
            addressLine1: addressParts.addressLine1,
            addressLine2: '',
            area: addressParts.area,
            city: addressParts.city,
            state: addressParts.state,
            pincode: '',
            landmark: '',
            cuisines: [],
            openingTime,
            closingTime,
            openDays,
            isAcceptingOrders,
            panNumber: '',
            nameOnPan: '',
            gstRegistered: gstData.gstRegistered,
            gstNumber: gstData.gstNumber,
            gstLegalName: '',
            gstAddress: '',
            fssaiNumber: '',
            accountNumber: '',
            ifscCode: '',
            accountHolderName: '',
            accountType: '',
            upiId: '',
            upiQrImage: '',
            menuImages: [],
            menuPdf: '',
            coverImages: uniqueStrings([row.cover_photo]),
            profileImage: toTrimmedString(row.logo),
            fcmTokens: [],
            fcmTokenMobile: [],
            pushDevices: [],
            location: point
                ? {
                    type: 'Point',
                    coordinates: point.coordinates,
                    latitude: point.latitude,
                    longitude: point.longitude,
                    formattedAddress: addressParts.addressLine1,
                    address: addressParts.addressLine1,
                    addressLine1: addressParts.addressLine1,
                    addressLine2: '',
                    area: addressParts.area,
                    city: addressParts.city,
                    state: addressParts.state,
                    pincode: '',
                    landmark: ''
                }
                : undefined,
            businessModel: toTrimmedString(row.restaurant_model),
            panImage: '',
            gstImage: toTrimmedString(row.tin_certificate_image),
            fssaiImage: '',
            estimatedDeliveryTime: toTrimmedString(row.delivery_time),
            estimatedDeliveryTimeMinutes: parseNumber((toTrimmedString(row.delivery_time).match(/(\d{1,3})/) || [])[1], undefined),
            featuredDish: '',
            featuredPrice: undefined,
            offer: offerData.offer,
            discount: offerData.discount,
            itemDiscounts: [],
            discountRules: [],
            rating: ratingData.rating,
            totalRatings: ratingData.totalRatings,
            diningSettings: {
                isEnabled: false,
                maxGuests: 6,
                diningType: ['family-dining']
            },
            menu: { sections: [] },
            status: 'approved',
            approvedAt: createdAt,
            rejectedAt: undefined,
            rejectionReason: '',
            pendingUpdateReason: '',
            zoneRank: null,
            createdAt,
            updatedAt
        };

        prepared.push({
            legacyId,
            uniqueKey,
            objectId,
            doc,
            wallet: {
                restaurantId: objectId,
                balance: 0,
                lockedAmount: 0,
                totalEarnings: 0,
                totalSettled: 0,
                createdAt,
                updatedAt
            },
            outletTimings: buildOutletTimingsDoc(objectId, openingTime, closingTime, createdAt, updatedAt),
            meta: {
                active: parseBooleanish(row.active, true),
                statusFlag: parseBooleanish(row.status, false),
                vendorId: toTrimmedString(row.vendor_id),
                zoneId: toTrimmedString(row.zone_id),
                legacyOrderCount: parseNumber(row.order_count, 0),
                legacyTotalOrder: parseNumber(row.total_order, 0),
                commission: parseNumber(row.comission, 0),
                minimumOrder: parseNumber(row.minimum_order, 0),
                minimumShippingCharge: parseNumber(row.minimum_shipping_charge, 0),
                maximumShippingCharge: parseNumber(row.maximum_shipping_charge, 0),
                perKmShippingCharge: parseNumber(row.per_km_shipping_charge, 0)
            }
        });
    }

    return { prepared, issues };
}

function buildReport(prepared, issues, args, rawRowsCount) {
    const unmappedLegacyFields = [
        'footer_text',
        'minimum_order',
        'comission',
        'schedule_order',
        'free_delivery',
        'delivery',
        'take_away',
        'food_section',
        'tax',
        'zone_id',
        'reviews_section',
        'off_day',
        'self_delivery_system',
        'pos_system',
        'minimum_shipping_charge',
        'order_count',
        'total_order',
        'per_km_shipping_charge',
        'maximum_shipping_charge',
        'slug',
        'order_subscription_active',
        'cutlery',
        'meta_title',
        'meta_description',
        'meta_image',
        'announcement',
        'announcement_message',
        'qr_code',
        'free_delivery_distance',
        'additional_data',
        'additional_documents',
        'package_id',
        'tin',
        'tin_expire_date'
    ];

    const fieldMapping = {
        name: 'FoodRestaurant.restaurantName + ownerName fallback',
        phone: 'FoodRestaurant.ownerPhone + primaryContactNumber',
        email: 'FoodRestaurant.ownerEmail',
        logo: 'FoodRestaurant.profileImage',
        cover_photo: 'FoodRestaurant.coverImages[]',
        latitude: 'FoodRestaurant.location.latitude',
        longitude: 'FoodRestaurant.location.longitude',
        address: 'FoodRestaurant.addressLine1 + location.address',
        opening_time: 'FoodRestaurant.openingTime + outlet timings',
        closeing_time: 'FoodRestaurant.closingTime + outlet timings',
        status: 'FoodRestaurant.isAcceptingOrders support signal',
        active: 'FoodRestaurant.isAcceptingOrders support signal',
        veg: 'FoodRestaurant.pureVegRestaurant support signal',
        non_veg: 'FoodRestaurant.pureVegRestaurant support signal',
        rating: 'FoodRestaurant.rating + totalRatings',
        gst: 'FoodRestaurant.gstRegistered + gstNumber',
        delivery_time: 'FoodRestaurant.estimatedDeliveryTime',
        restaurant_model: 'FoodRestaurant.businessModel',
        offer: 'FoodRestaurant.offer support signal',
        offer_type: 'FoodRestaurant.offer support signal',
        offer_value: 'FoodRestaurant.discount support signal',
        max_discount: 'FoodRestaurant.offer support signal',
        created_at: 'FoodRestaurant.createdAt',
        updated_at: 'FoodRestaurant.updatedAt'
    };

    return {
        source: path.resolve(args.input),
        applyMode: args.apply,
        rawRows: rawRowsCount,
        processedRestaurants: prepared.length,
        walletsToCreate: prepared.length,
        outletTimingsToCreate: prepared.filter((item) => item.outletTimings).length,
        acceptingOrders: prepared.filter((item) => item.doc.isAcceptingOrders).length,
        approvedRestaurants: prepared.filter((item) => item.doc.status === 'approved').length,
        pureVegRestaurants: prepared.filter((item) => item.doc.pureVegRestaurant).length,
        fieldMapping,
        unmappedLegacyFields,
        notes: [
            'Legacy restaurants are imported as approved because they are historical production entities already operating in the old app.',
            'isAcceptingOrders is derived from legacy status + active flags.',
            'Owner name is not present in restaurants.csv, so ownerName falls back to restaurantName.',
            'Zero-balance restaurant wallets are created for all imported restaurants.',
            'Outlet timing docs are created only for restaurants that have both opening_time and closeing_time.'
        ],
        issues
    };
}

async function resolveLegacyDefaultZone() {
    return FoodZone.findOne({
        isActive: true,
        $or: [
            { name: { $regex: `^${LEGACY_DEFAULT_ZONE_NAME}$`, $options: 'i' } },
            { zoneName: { $regex: `^${LEGACY_DEFAULT_ZONE_NAME}$`, $options: 'i' } },
            { serviceLocation: { $regex: `^${LEGACY_DEFAULT_ZONE_NAME}$`, $options: 'i' } }
        ]
    }).select('_id name zoneName serviceLocation').lean();
}

async function applyRestaurants(prepared) {
    const defaultZone = await resolveLegacyDefaultZone();
    if (!defaultZone?._id) {
        throw new Error(`Legacy default zone "${LEGACY_DEFAULT_ZONE_NAME}" not found. Create the Samana zone first.`);
    }

    const existingDocs = await FoodRestaurant.find({
        $or: prepared.map((item) => ({
            restaurantNameNormalized: item.doc.restaurantNameNormalized,
            ownerPhoneLast10: item.doc.ownerPhoneLast10
        }))
    }).select('_id restaurantNameNormalized ownerPhoneLast10').lean();

    const existingMap = new Map(
        existingDocs.map((doc) => [`${doc.restaurantNameNormalized}|${doc.ownerPhoneLast10}`, doc])
    );

    const restaurantIdMap = new Map();
    const restaurantBulkOps = prepared.map((item) => {
        const existing = existingMap.get(item.uniqueKey);
        const finalId = existing?._id || item.objectId;
        restaurantIdMap.set(item.legacyId, finalId);

        const doc = {
            ...item.doc,
            zoneId: defaultZone._id,
            city: item.doc.city || LEGACY_DEFAULT_ZONE_NAME,
            location: item.doc.location
                ? {
                    ...item.doc.location,
                    city: item.doc.location.city || item.doc.city || LEGACY_DEFAULT_ZONE_NAME
                }
                : item.doc.location,
            _id: undefined
        };
        delete doc._id;

        return {
            updateOne: {
                filter: {
                    restaurantNameNormalized: item.doc.restaurantNameNormalized,
                    ownerPhoneLast10: item.doc.ownerPhoneLast10
                },
                update: {
                    $set: doc,
                    $setOnInsert: { _id: finalId }
                },
                upsert: true
            }
        };
    });

    if (restaurantBulkOps.length > 0) {
        await FoodRestaurant.collection.bulkWrite(restaurantBulkOps, { ordered: false });
    }

    const walletBulkOps = prepared.map((item) => ({
        updateOne: {
            filter: { restaurantId: restaurantIdMap.get(item.legacyId) || item.objectId },
            update: {
                $set: {
                    ...item.wallet,
                    restaurantId: restaurantIdMap.get(item.legacyId) || item.objectId
                }
            },
            upsert: true
        }
    }));

    if (walletBulkOps.length > 0) {
        await FoodRestaurantWallet.collection.bulkWrite(walletBulkOps, { ordered: false });
    }

    const timingDocs = prepared
        .filter((item) => item.outletTimings)
        .map((item) => ({
            ...item.outletTimings,
            restaurantId: restaurantIdMap.get(item.legacyId) || item.objectId
        }));

    const timingBulkOps = timingDocs.map((doc) => ({
        updateOne: {
            filter: { restaurantId: doc.restaurantId },
            update: { $set: doc },
            upsert: true
        }
    }));

    if (timingBulkOps.length > 0) {
        await FoodRestaurantOutletTimings.collection.bulkWrite(timingBulkOps, { ordered: false });
    }

    return {
        restaurantsUpserted: restaurantBulkOps.length,
        walletsUpserted: walletBulkOps.length,
        outletTimingsUpserted: timingBulkOps.length
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return;
    }

    const outputDir = getOutputDir(args.outputDir);
    await ensureDir(outputDir);

    const allRows = readCsvRows(args.input);
    const rows = args.limit > 0 ? allRows.slice(0, args.limit) : allRows;
    const { prepared, issues } = buildPreparedRestaurants(rows);
    const report = buildReport(prepared, issues, args, allRows.length);
    const preview = prepared.slice(0, 20).map((item) => ({
        legacyId: item.legacyId,
        restaurantName: item.doc.restaurantName,
        ownerPhone: item.doc.ownerPhone,
        status: item.doc.status,
        isAcceptingOrders: item.doc.isAcceptingOrders,
        pureVegRestaurant: item.doc.pureVegRestaurant,
        gstRegistered: item.doc.gstRegistered,
        gstNumber: item.doc.gstNumber,
        rating: item.doc.rating,
        totalRatings: item.doc.totalRatings,
        estimatedDeliveryTime: item.doc.estimatedDeliveryTime,
        openingTime: item.doc.openingTime,
        closingTime: item.doc.closingTime
    }));

    await writeJson(path.join(outputDir, 'restaurants-report.json'), report);
    await writeJson(path.join(outputDir, 'restaurants-preview.json'), preview);

    let applyResult = null;
    if (args.apply) {
        await connectDB();
        try {
            applyResult = await applyRestaurants(prepared);
            await writeJson(path.join(outputDir, 'apply-result.json'), applyResult);
        } finally {
            await disconnectDB();
        }
    }

    logger.info(`Processed ${prepared.length} legacy restaurants from ${args.input}`);
    logger.info(`Report written to ${outputDir}`);
    if (issues.length > 0) {
        logger.warn(`Detected ${issues.length} migration issues. Review restaurants-report.json before apply.`);
    }
    if (applyResult) {
        logger.info(`Applied ${applyResult.restaurantsUpserted} restaurants, ${applyResult.walletsUpserted} wallets, and ${applyResult.outletTimingsUpserted} outlet timing docs`);
    }
}

main().catch((error) => {
    logger.error(error?.stack || error?.message || String(error));
    process.exit(1);
});

