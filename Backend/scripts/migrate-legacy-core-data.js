import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import XLSX from 'xlsx';

import { connectDB, disconnectDB } from '../src/config/db.js';
import { logger } from '../src/utils/logger.js';
import { FoodUser } from '../src/core/users/user.model.js';
import { FoodRestaurant } from '../src/modules/food/restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../src/modules/food/delivery/models/deliveryPartner.model.js';
import { FoodCategory } from '../src/modules/food/admin/models/category.model.js';
import { FoodItem } from '../src/modules/food/admin/models/food.model.js';
import { FoodZone } from '../src/modules/food/admin/models/zone.model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LEGACY_DIR = path.join(REPO_ROOT, 'Tuggo Food Delivery data');
const OUTPUT_ROOT = path.join(REPO_ROOT, 'migration-output', 'legacy-core');

const VALID_SCOPES = ['users', 'restaurants', 'drivers', 'categories', 'products'];
const LEGACY_DEFAULT_ZONE_NAME = 'Samana';

function parseArgs(argv = []) {
    const args = {
        apply: false,
        scopes: [...VALID_SCOPES],
        outputDir: '',
        dataDir: LEGACY_DIR
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

        if (arg.startsWith('--scopes=')) {
            const values = arg
                .slice('--scopes='.length)
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean);
            if (values.length > 0) {
                args.scopes = values;
            }
            continue;
        }

        if (arg.startsWith('--output-dir=')) {
            args.outputDir = arg.slice('--output-dir='.length).trim();
            continue;
        }

        if (arg.startsWith('--data-dir=')) {
            args.dataDir = arg.slice('--data-dir='.length).trim();
            continue;
        }
    }

    args.scopes = Array.from(new Set(args.scopes)).filter((scope) => VALID_SCOPES.includes(scope));
    if (args.scopes.length === 0) {
        throw new Error(`No valid scopes supplied. Valid scopes: ${VALID_SCOPES.join(', ')}`);
    }

    return args;
}

function printHelp() {
    console.log(`
Legacy core migration

Usage:
  node scripts/migrate-legacy-core-data.js
  node scripts/migrate-legacy-core-data.js --apply
  node scripts/migrate-legacy-core-data.js --scopes=users,restaurants,categories

Options:
  --apply                 Writes data into MongoDB
  --scopes=...            Comma-separated scopes: ${VALID_SCOPES.join(', ')}
  --output-dir=...        Custom output directory
  --data-dir=...          Custom legacy CSV directory
  --help                  Show this help

Default mode:
  Dry-run planning only. Reads legacy CSVs and writes JSON reports without touching MongoDB.
`);
}

function ensureDir(dirPath) {
    return fs.mkdir(dirPath, { recursive: true });
}

function toTrimmedString(value) {
    return value == null ? '' : String(value).trim();
}

function toLowerCollapsed(value) {
    return toTrimmedString(value).toLowerCase().replace(/\s+/g, ' ');
}

function toDigits(value) {
    return toTrimmedString(value).replace(/\D/g, '');
}

function toLast10(value) {
    const digits = toDigits(value);
    return digits ? digits.slice(-10) : '';
}

function toBool(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const normalized = toTrimmedString(value).toLowerCase();
    if (!normalized) return fallback;
    if (['true', '1', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
    return fallback;
}

function toNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveNumber(value, fallback = 0) {
    const numeric = toNumber(value, fallback);
    return numeric >= 0 ? numeric : fallback;
}

function toDate(value) {
    const raw = toTrimmedString(value);
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
}

function parseJsonValue(value, fallback) {
    const raw = toTrimmedString(value);
    if (!raw) return fallback;
    try {
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function parseJsonArray(value) {
    const parsed = parseJsonValue(value, []);
    return Array.isArray(parsed) ? parsed : [];
}

function uniqueStrings(values = []) {
    return Array.from(
        new Set(
            values
                .map((value) => toTrimmedString(value))
                .filter(Boolean)
        )
    );
}

function averageRating(sumValue, countValue) {
    const count = toPositiveNumber(countValue, 0);
    const sum = toPositiveNumber(sumValue, 0);
    if (!count) return 0;
    return Math.max(0, Math.min(5, Number((sum / count).toFixed(1))));
}

function maybePhone(value) {
    const digits = toDigits(value);
    if (digits.length < 7) return '';
    return digits;
}

function parseLatLng(latValue, lngValue) {
    const lat = Number(latValue);
    const lng = Number(lngValue);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
        latitude: lat,
        longitude: lng,
        coordinates: [lng, lat]
    };
}

function sanitizeBankString(value) {
    const raw = toTrimmedString(value);
    if (!raw) return '';
    if (raw.toLowerCase() === 'f') return '';
    return raw;
}

function slugifyLikeKey(value) {
    return toLowerCollapsed(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
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

function getOutputDir(customOutputDir = '') {
    if (customOutputDir) return path.resolve(customOutputDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(OUTPUT_ROOT, stamp);
}

async function writeJson(filePath, data) {
    await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readCsvRows(filePath) {
    const workbook = XLSX.readFile(filePath, {
        raw: false,
        cellDates: false
    });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(sheet, {
        defval: '',
        raw: false
    });
}

function loadLegacyData(dataDir) {
    return {
        users: readCsvRows(path.join(dataDir, 'customers.csv')),
        vendors: readCsvRows(path.join(dataDir, 'vendors.csv')),
        owners: readCsvRows(path.join(dataDir, 'owner.csv')),
        ownerSupplements: readCsvRows(path.join(dataDir, 'owners.csv')),
        ownerCredentials: readCsvRows(path.join(dataDir, 'owner__restaurantCredentials.csv')),
        banks: readCsvRows(path.join(dataDir, 'bank_details.csv')),
        drivers: readCsvRows(path.join(dataDir, 'driver.csv')),
        driverSupplements: readCsvRows(path.join(dataDir, 'driver_users.csv')),
        driverVerifications: readCsvRows(path.join(dataDir, 'verify_driver.csv')),
        categories: readCsvRows(path.join(dataDir, 'category.csv')),
        subCategories: readCsvRows(path.join(dataDir, 'sub_category.csv')),
        products: readCsvRows(path.join(dataDir, 'product.csv')),
        cuisines: readCsvRows(path.join(dataDir, 'cuisine.csv'))
    };
}

function buildLookupMaps(data) {
    const ownerByVendorId = new Map();
    for (const owner of data.owners) {
        const vendorId = toTrimmedString(owner.vendorId);
        if (vendorId) ownerByVendorId.set(vendorId, owner);

        const vendorIds = parseJsonArray(owner.vendorIds);
        for (const extraVendorId of vendorIds) {
            const id = toTrimmedString(extraVendorId);
            if (id) ownerByVendorId.set(id, owner);
        }
    }

    const ownerSupplementById = new Map();
    for (const row of data.ownerSupplements) {
        const key = toTrimmedString(row._id || row.id);
        if (key) ownerSupplementById.set(key, row);
    }

    const ownerCredentialByVendorId = new Map();
    for (const row of data.ownerCredentials) {
        const vendorId = toTrimmedString(row.vendorId);
        if (vendorId) ownerCredentialByVendorId.set(vendorId, row);
    }

    const bankByOwnerId = new Map();
    const bankByDriverId = new Map();
    for (const row of data.banks) {
        const ownerId = toTrimmedString(row.ownerId);
        const driverId = toTrimmedString(row.driverId);
        if (ownerId && !bankByOwnerId.has(ownerId)) bankByOwnerId.set(ownerId, row);
        if (driverId && !bankByDriverId.has(driverId)) bankByDriverId.set(driverId, row);
    }

    const driverSupplementById = new Map();
    for (const row of data.driverSupplements) {
        const key = toTrimmedString(row._id || row.id);
        if (key) driverSupplementById.set(key, row);
    }

    const driverVerificationByDriverId = new Map();
    for (const row of data.driverVerifications) {
        const driverId = toTrimmedString(row.driverId);
        if (driverId) driverVerificationByDriverId.set(driverId, row);
    }

    const categoryByLegacyId = new Map();
    for (const row of data.categories) {
        const key = toTrimmedString(row.id || row._id);
        if (key) categoryByLegacyId.set(key, row);
    }

    const subCategoryByLegacyId = new Map();
    for (const row of data.subCategories) {
        const key = toTrimmedString(row.id || row._id);
        if (key) subCategoryByLegacyId.set(key, row);
    }

    return {
        ownerByVendorId,
        ownerSupplementById,
        ownerCredentialByVendorId,
        bankByOwnerId,
        bankByDriverId,
        driverSupplementById,
        driverVerificationByDriverId,
        categoryByLegacyId,
        subCategoryByLegacyId
    };
}

function buildUserPayload(row) {
    const phone = maybePhone(row.phoneNumber);
    const name = uniqueStrings([row.firstName, row.lastName]).join(' ').replace(/\s+/g, ' ').trim();
    const addressList = parseJsonArray(row.customerAddresses);
    const addresses = addressList
        .map((entry = {}) => {
            const point = parseLatLng(entry?.location?.latitude, entry?.location?.longitude);
            const labelRaw = toTrimmedString(entry.addressAs);
            let label = 'Other';
            if (/home/i.test(labelRaw)) label = 'Home';
            else if (/office|work/i.test(labelRaw)) label = 'Office';

            const addressDoc = {
                label,
                street: toTrimmedString(entry.address || entry.locality || 'Unknown'),
                additionalDetails: toTrimmedString(entry.addressLine2),
                city: toTrimmedString(entry.locality || entry.city || entry.state || 'Unknown'),
                state: toTrimmedString(entry.state || entry.locality || 'Unknown'),
                zipCode: toTrimmedString(entry.pincode),
                phone,
                isDefault: toBool(entry.isDefault, false)
            };

            addressDoc.location = point?.coordinates?.length === 2
                ? {
                    type: 'Point',
                    coordinates: point.coordinates
                }
                : null;

            return addressDoc;
        })
        .filter((entry) => toTrimmedString(entry.street) && toTrimmedString(entry.city) && toTrimmedString(entry.state));

    return {
        legacyId: toTrimmedString(row.id || row._id),
        uniqueKey: phone,
        doc: {
            phone,
            countryCode: toTrimmedString(row.countryCode) || '+91',
            name,
            email: toTrimmedString(row.email),
            profileImage: toTrimmedString(row.profilePic),
            fcmTokens: uniqueStrings([row.fcmToken]),
            dateOfBirth: toDate(row.dateOfBirth),
            gender: normalizeGender(row.gender),
            isVerified: true,
            isActive: toBool(row.isActive, true),
            role: 'USER',
            addresses
        }
    };
}

function normalizeGender(value) {
    const normalized = toLowerCollapsed(value);
    if (normalized === 'male') return 'male';
    if (normalized === 'female') return 'female';
    if (normalized === 'other') return 'other';
    return '';
}

function parseOpeningHoursList(value) {
    const list = parseJsonArray(value);
    const openEntries = list.filter((entry) => toBool(entry?.isOpen, false));
    return {
        openDays: uniqueStrings(openEntries.map((entry) => entry?.day)),
        openingTime: toTrimmedString(openEntries[0]?.openingHours),
        closingTime: toTrimmedString(openEntries[0]?.closingHours)
    };
}

function buildRestaurantPayload(vendor, lookups) {
    const vendorId = toTrimmedString(vendor.id || vendor._id);
    const owner = lookups.ownerByVendorId.get(vendorId) || null;
    const ownerId = toTrimmedString(owner?.id || owner?._id);
    const ownerSupplement = ownerId ? lookups.ownerSupplementById.get(ownerId) || null : null;
    const ownerCredential = lookups.ownerCredentialByVendorId.get(vendorId) || null;
    const bank = ownerId ? lookups.bankByOwnerId.get(ownerId) || null : null;

    const ownerPhoneRaw = toTrimmedString(owner?.phoneNumber);
    const primaryContactCandidate = maybePhone(vendor.restaurantNumber);
    const ownerPhone = maybePhone(ownerPhoneRaw);
    const point = parseLatLng(vendor['address.location.latitude'], vendor['address.location.longitude']);
    const { openDays, openingTime, closingTime } = parseOpeningHoursList(vendor.openingHoursList);
    const restaurantName = toTrimmedString(vendor.vendorName);
    const restaurantNameNormalized = toLowerCollapsed(restaurantName);
    const ownerPhoneLast10 = toLast10(ownerPhone || primaryContactCandidate);
    const active = toBool(vendor.active, true);
    const isOnline = toBool(vendor.isOnline, false);
    const isVerified = toBool(owner?.isVerified, false) || toBool(vendor.active, false);
    const cuisineNames = uniqueStrings([vendor.cuisineName]);

    const ownerNameFallback = uniqueStrings([owner?.firstName, owner?.lastName]).join(' ').replace(/\s+/g, ' ').trim();

    return {
        legacyId: vendorId,
        uniqueKey: ownerPhoneLast10
            ? `${restaurantNameNormalized}|${ownerPhoneLast10}`
            : `${restaurantNameNormalized}|${slugifyLikeKey(owner?.email || ownerCredential?.email || vendorId)}`,
        doc: {
            restaurantName,
            ownerName: toTrimmedString(vendor.ownerFullName) || ownerNameFallback,
            ownerEmail: toTrimmedString(owner?.email || ownerCredential?.email),
            ownerPhone: ownerPhone || '',
            primaryContactNumber: primaryContactCandidate || ownerPhone || '',
            pureVegRestaurant: /veg/i.test(toTrimmedString(vendor.vendorType)) && !/non/i.test(toTrimmedString(vendor.vendorType)),
            addressLine1: toTrimmedString(vendor['address.address']),
            addressLine2: toTrimmedString(vendor['address.addressLine2']),
            area: toTrimmedString(vendor['address.locality']) || LEGACY_DEFAULT_ZONE_NAME,
            city: toTrimmedString(vendor['address.locality']) || LEGACY_DEFAULT_ZONE_NAME,
            state: toTrimmedString(vendor['address.state']),
            pincode: toTrimmedString(vendor['address.pincode']),
            landmark: toTrimmedString(vendor['address.landmark']),
            cuisines: cuisineNames,
            openingTime,
            closingTime,
            openDays,
            isAcceptingOrders: active && isOnline,
            panNumber: toTrimmedString(owner?.panNumber),
            fssaiNumber: toTrimmedString(vendor.fssai),
            gstRegistered: Boolean(toTrimmedString(vendor.gstin)),
            gstNumber: toTrimmedString(vendor.gstin),
            accountNumber: sanitizeBankString(bank?.accountNumber),
            ifscCode: sanitizeBankString(bank?.ifscCode),
            accountHolderName: sanitizeBankString(bank?.holderName),
            upiId: sanitizeBankString(bank?.upiId),
            upiQrImage: sanitizeBankString(bank?.upiQrCodeUrl),
            coverImages: uniqueStrings([vendor.coverImage]),
            profileImage: toTrimmedString(vendor.logoImage || owner?.profileImage),
            fcmTokens: uniqueStrings([owner?.fcmToken, owner?.fcmTokens]),
            location: point
                ? {
                    type: 'Point',
                    coordinates: point.coordinates,
                    latitude: point.latitude,
                    longitude: point.longitude,
                    address: toTrimmedString(vendor['address.address']),
                    addressLine1: toTrimmedString(vendor['address.address']),
                    addressLine2: toTrimmedString(vendor['address.addressLine2']),
                    area: toTrimmedString(vendor['address.locality']) || LEGACY_DEFAULT_ZONE_NAME,
                    city: toTrimmedString(vendor['address.locality']) || LEGACY_DEFAULT_ZONE_NAME,
                    state: toTrimmedString(vendor['address.state']),
                    pincode: toTrimmedString(vendor['address.pincode']),
                    landmark: toTrimmedString(vendor['address.landmark'])
                }
                : undefined,
            businessModel: '',
            rating: averageRating(vendor.reviewSum, vendor.reviewCount),
            totalRatings: toPositiveNumber(vendor.reviewCount, 0),
            status: isVerified ? 'approved' : 'pending',
            approvedAt: isVerified ? toDate(owner?.createdAt || vendor.createdAt) || new Date() : undefined,
            rejectedAt: undefined,
            rejectionReason: '',
            pendingUpdateReason: '',
            menuImages: [],
            menuPdf: '',
            ownerPhoneDigitsSource: ownerPhone,
            ownerVerificationNote: ownerSupplement ? 'owner-supplement-present' : ''
        }
    };
}

function buildDriverPayload(driver, lookups) {
    const legacyId = toTrimmedString(driver.driverId || driver.id || driver._id);
    const supplement = lookups.driverSupplementById.get(legacyId) || null;
    const verification = lookups.driverVerificationByDriverId.get(legacyId) || null;
    const bank = lookups.bankByDriverId.get(legacyId) || null;
    const phone = maybePhone(driver.phoneNumber);
    const point = parseLatLng(driver['location.latitude'], driver['location.longitude']);
    const isVerified =
        toBool(driver.isVerified, false) ||
        toBool(supplement?.isAadharVerified, false) ||
        Boolean(verification?.verifyDocument);

    return {
        legacyId,
        uniqueKey: phone || toTrimmedString(driver['driverVehicleDetails.vehicleNumber']),
        doc: {
            name: uniqueStrings([driver.firstName, driver.lastName]).join(' ').replace(/\s+/g, ' ').trim(),
            phone,
            email: toTrimmedString(driver.email),
            countryCode: toTrimmedString(driver.countryCode) || '+91',
            vehicleType: toTrimmedString(driver['driverVehicleDetails.vehicleTypeName']),
            vehicleName: toTrimmedString(driver['driverVehicleDetails.modelName']),
            vehicleNumber: toTrimmedString(driver['driverVehicleDetails.vehicleNumber']),
            panNumber: toTrimmedString(driver.panCard),
            aadharNumber: toTrimmedString(driver.aadharCard),
            drivingLicenseNumber: toTrimmedString(driver['driverVehicleDetails.dlNumber']),
            profilePhoto: toTrimmedString(driver.profileImage),
            fcmTokens: uniqueStrings([driver.fcmToken]),
            status: isVerified ? 'approved' : 'pending',
            approvedAt: isVerified ? toDate(driver.createdAt) || new Date() : undefined,
            bankAccountHolderName: sanitizeBankString(bank?.holderName),
            bankAccountNumber: sanitizeBankString(bank?.accountNumber),
            bankIfscCode: sanitizeBankString(bank?.ifscCode),
            bankName: sanitizeBankString(bank?.bankName),
            upiId: sanitizeBankString(bank?.upiId),
            upiQrCode: sanitizeBankString(bank?.upiQrCodeUrl),
            availabilityStatus: toBool(driver.isOnline, false) ? 'online' : 'offline',
            lastLocation: point
                ? {
                    type: 'Point',
                    coordinates: point.coordinates
                }
                : undefined,
            lastLat: point?.latitude,
            lastLng: point?.longitude,
            lastLocationAt: toDate(driver.createdAt),
            rating: averageRating(driver.reviewSum || driver.reviewsSum, driver.reviewCount || driver.reviewsCount),
            totalRatings: toPositiveNumber(driver.reviewCount || driver.reviewsCount, 0)
        }
    };
}

function buildCategoryPayload(row) {
    const name = toTrimmedString(row.categoryName).replace(/\s+/g, ' ').trim();
    return {
        legacyId: toTrimmedString(row.id || row._id),
        uniqueKey: toLowerCollapsed(name),
        doc: {
            name,
            image: toTrimmedString(row.image),
            type: '',
            foodTypeScope: 'Both',
            approvalStatus: 'approved',
            isApproved: true,
            isActive: toBool(row.active, true),
            sortOrder: 0
        }
    };
}

function flattenLegacyVariants(value) {
    const groups = parseJsonArray(value);
    const variants = [];

    for (const group of groups) {
        const groupName = toTrimmedString(group?.name);
        const optionList = Array.isArray(group?.optionList) ? group.optionList : [];
        for (const option of optionList) {
            const optionName = toTrimmedString(option?.name);
            const name = groupName && optionName ? `${groupName}: ${optionName}` : optionName || groupName;
            const price = toPositiveNumber(option?.price, NaN);
            if (!name || !Number.isFinite(price) || price <= 0) continue;
            variants.push({ name, price });
        }
    }

    return variants;
}

function buildProductPayload(row, context) {
    const legacyRestaurantId = toTrimmedString(row.vendorId);
    const legacyCategoryId = toTrimmedString(row.categoryId);
    const restaurantId = context.restaurantIdMap[legacyRestaurantId] || null;
    const categoryId = context.categoryIdMap[legacyCategoryId] || null;
    const variants = flattenLegacyVariants(row.variationList);
    const basePrice = toPositiveNumber(row.price, 0);
    const name = toTrimmedString(row.productName);
    const categoryRow = context.lookups.categoryByLegacyId.get(legacyCategoryId) || null;
    const subCategoryRow = context.lookups.subCategoryByLegacyId.get(toTrimmedString(row.subCategoryId)) || null;

    const blockers = [];
    if (!restaurantId) blockers.push('missing_restaurant');
    if (!categoryId && !toTrimmedString(row['categoryModel.categoryName'])) blockers.push('missing_category');
    if (!name) blockers.push('missing_name');

    const payload = {
        legacyId: toTrimmedString(row.id || row._id),
        uniqueKey: restaurantId
            ? `${String(restaurantId)}|${String(categoryId || '')}|${toLowerCollapsed(name)}`
            : '',
        blockers,
        legacySubCategoryId: toTrimmedString(row.subCategoryId),
        legacySubCategoryName: toTrimmedString(subCategoryRow?.subCategoryName || row['subCategoryModel.subCategoryName']),
        hasAddons: parseJsonArray(row.addonsList).length > 0,
        doc: {
            restaurantId,
            categoryId,
            categoryName: toTrimmedString(categoryRow?.categoryName || row['categoryModel.categoryName']),
            name,
            description: toTrimmedString(row.description),
            price: variants.length > 0 ? Math.min(...variants.map((entry) => entry.price)) : basePrice,
            variants,
            image: toTrimmedString(row.productImage),
            foodType: normalizeFoodType(row.foodType),
            isAvailable: toBool(row.inStock, true) && toBool(row.status, true),
            preparationTime: toTrimmedString(row.preparationTime),
            approvalStatus: 'approved',
            requestedAt: undefined,
            approvedAt: toDate(row.createAt) || new Date()
        }
    };

    return payload;
}

function normalizeFoodType(value) {
    const normalized = toLowerCollapsed(value);
    if (normalized === 'veg') return 'Veg';
    return 'Non-Veg';
}

async function withDb(apply, fn) {
    if (!apply) return fn();
    await connectDB();
    try {
        return await fn();
    } finally {
        await disconnectDB();
    }
}

function buildStats(scope) {
    return {
        scope,
        total: 0,
        valid: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: 0
    };
}

async function migrateUsers({ rows, apply, outputDir }) {
    const stats = buildStats('users');
    const idMap = {};
    const skipped = [];
    const errors = [];
    const summary = [];

    const existingByPhone = new Map();
    if (apply) {
        const docs = await FoodUser.find({}, '_id phone').lean();
        for (const doc of docs) {
            const key = maybePhone(doc.phone);
            if (key) existingByPhone.set(key, doc);
        }
    }

    for (const row of rows) {
        stats.total += 1;
        try {
            const payload = buildUserPayload(row);
            if (!payload.uniqueKey) {
                stats.skipped += 1;
                skipped.push({ legacyId: payload.legacyId, reason: 'missing_phone' });
                continue;
            }

            stats.valid += 1;
            idMap[payload.legacyId] = argsDryRunId(payload.legacyId, apply);
            summary.push({
                legacyId: payload.legacyId,
                phone: payload.doc.phone,
                name: payload.doc.name
            });

            if (!apply) continue;

            const existing = existingByPhone.get(payload.uniqueKey) || null;
            let targetId = '';
            if (existing?._id) {
                await FoodUser.updateOne({ _id: existing._id }, { $set: payload.doc });
                stats.updated += 1;
                targetId = String(existing._id);
            } else {
                const created = await FoodUser.create(payload.doc);
                stats.created += 1;
                targetId = String(created._id);
                existingByPhone.set(payload.uniqueKey, { _id: created._id, phone: created.phone });
            }
            idMap[payload.legacyId] = targetId;
        } catch (error) {
            stats.errors += 1;
            errors.push({
                legacyId: toTrimmedString(row.id || row._id),
                error: error.message
            });
        }
    }

    await writeJson(path.join(outputDir, 'users-migration-result.json'), { stats, summary, skipped, errors, idMap });
    return { stats, idMap, skipped, errors };
}

async function migrateRestaurants({ rows, lookups, apply, outputDir }) {
    const stats = buildStats('restaurants');
    const defaultZone = apply ? await resolveLegacyDefaultZone() : null;
    if (apply && !defaultZone?._id) {
        throw new Error(`Legacy default zone "${LEGACY_DEFAULT_ZONE_NAME}" not found. Create the Samana zone first.`);
    }
    const idMap = {};
    const skipped = [];
    const errors = [];
    const summary = [];

    const existingByKey = new Map();
    if (apply) {
        const docs = await FoodRestaurant.find({}, '_id restaurantNameNormalized ownerPhoneLast10 restaurantName ownerEmail').lean();
        for (const doc of docs) {
            const normalizedName = toLowerCollapsed(doc.restaurantName);
            const last10 = toLast10(doc.ownerPhoneLast10);
            const key = last10
                ? `${normalizedName}|${last10}`
                : `${normalizedName}|${slugifyLikeKey(doc.ownerEmail || doc._id)}`;
            existingByKey.set(key, doc);
        }
    }

    for (const row of rows) {
        stats.total += 1;
        try {
            const payload = buildRestaurantPayload(row, lookups);
            if (!payload.doc.restaurantName) {
                stats.skipped += 1;
                skipped.push({ legacyId: payload.legacyId, reason: 'missing_restaurant_name' });
                continue;
            }

            stats.valid += 1;
            idMap[payload.legacyId] = argsDryRunId(payload.legacyId, apply);
            summary.push({
                legacyId: payload.legacyId,
                restaurantName: payload.doc.restaurantName,
                ownerName: payload.doc.ownerName,
                status: payload.doc.status
            });

            if (!apply) continue;

            const { ownerPhoneDigitsSource, ownerVerificationNote, ...restDoc } = payload.doc;
            const updateDoc = {
                ...restDoc,
                zoneId: defaultZone?._id || restDoc.zoneId,
                city: restDoc.city || LEGACY_DEFAULT_ZONE_NAME,
                location: restDoc.location
                    ? {
                        ...restDoc.location,
                        city: restDoc.location.city || restDoc.city || LEGACY_DEFAULT_ZONE_NAME
                    }
                    : restDoc.location
            };
            const existing = existingByKey.get(payload.uniqueKey) || null;
            let targetId = '';
            if (existing?._id) {
                await FoodRestaurant.updateOne({ _id: existing._id }, { $set: updateDoc });
                stats.updated += 1;
                targetId = String(existing._id);
            } else {
                const created = await FoodRestaurant.create(updateDoc);
                stats.created += 1;
                targetId = String(created._id);
                existingByKey.set(payload.uniqueKey, {
                    _id: created._id,
                    restaurantName: created.restaurantName,
                    ownerEmail: created.ownerEmail,
                    ownerPhoneLast10: created.ownerPhoneLast10
                });
            }
            idMap[payload.legacyId] = targetId;
        } catch (error) {
            stats.errors += 1;
            errors.push({
                legacyId: toTrimmedString(row.id || row._id),
                error: error.message
            });
        }
    }

    await writeJson(path.join(outputDir, 'restaurants-migration-result.json'), { stats, summary, skipped, errors, idMap });
    return { stats, idMap, skipped, errors };
}

async function migrateDrivers({ rows, lookups, apply, outputDir }) {
    const stats = buildStats('drivers');
    const idMap = {};
    const skipped = [];
    const errors = [];
    const summary = [];

    const existingByKey = new Map();
    if (apply) {
        const docs = await FoodDeliveryPartner.find({}, '_id phone vehicleNumber').lean();
        for (const doc of docs) {
            const phoneKey = maybePhone(doc.phone);
            if (phoneKey) existingByKey.set(phoneKey, doc);
            const vehicleKey = toTrimmedString(doc.vehicleNumber);
            if (vehicleKey) existingByKey.set(vehicleKey, doc);
        }
    }

    const resolveSafeVehicleNumber = async (vehicleNumber, currentDoc = null) => {
        const normalized = toTrimmedString(vehicleNumber);
        if (!normalized) return '';

        const mappedExisting = existingByKey.get(normalized) || null;
        if (mappedExisting?._id) {
            if (currentDoc?._id && String(mappedExisting._id) === String(currentDoc._id)) {
                return normalized;
            }
            return '';
        }

        const dbExisting = await FoodDeliveryPartner.findOne({ vehicleNumber: normalized }).select('_id').lean();
        if (!dbExisting?._id) return normalized;
        if (currentDoc?._id && String(dbExisting._id) === String(currentDoc._id)) return normalized;
        return '';
    };

    for (const row of rows) {
        stats.total += 1;
        try {
            const payload = buildDriverPayload(row, lookups);
            if (!payload.uniqueKey || !payload.doc.name) {
                stats.skipped += 1;
                skipped.push({ legacyId: payload.legacyId, reason: 'missing_driver_identity' });
                continue;
            }

            stats.valid += 1;
            idMap[payload.legacyId] = argsDryRunId(payload.legacyId, apply);
            summary.push({
                legacyId: payload.legacyId,
                name: payload.doc.name,
                phone: payload.doc.phone,
                status: payload.doc.status
            });

            if (!apply) continue;

            const existing = existingByKey.get(payload.uniqueKey) || null;
            let targetId = '';
            if (existing?._id) {
                const safeVehicleNumber = await resolveSafeVehicleNumber(payload.doc.vehicleNumber, existing);
                const updateDoc = {
                    ...payload.doc,
                    vehicleNumber: safeVehicleNumber || null
                };
                const updateOps = safeVehicleNumber
                    ? { $set: updateDoc }
                    : { $set: updateDoc, $unset: { vehicleNumber: 1 } };
                await FoodDeliveryPartner.updateOne({ _id: existing._id }, updateOps);
                stats.updated += 1;
                targetId = String(existing._id);
            } else {
                const safeVehicleNumber = await resolveSafeVehicleNumber(payload.doc.vehicleNumber, null);
                const createDoc = {
                    ...payload.doc,
                    vehicleNumber: safeVehicleNumber || undefined
                };
                const created = await FoodDeliveryPartner.create(createDoc);
                stats.created += 1;
                targetId = String(created._id);
                if (payload.doc.phone) existingByKey.set(payload.doc.phone, { _id: created._id });
                if (safeVehicleNumber) existingByKey.set(safeVehicleNumber, { _id: created._id });
            }
            idMap[payload.legacyId] = targetId;
        } catch (error) {
            stats.errors += 1;
            errors.push({
                legacyId: toTrimmedString(row.driverId || row.id || row._id),
                error: error.message
            });
        }
    }

    await writeJson(path.join(outputDir, 'drivers-migration-result.json'), { stats, summary, skipped, errors, idMap });
    return { stats, idMap, skipped, errors };
}

async function migrateCategories({ rows, apply, outputDir }) {
    const stats = buildStats('categories');
    const idMap = {};
    const skipped = [];
    const errors = [];
    const summary = [];

    const existingByKey = new Map();
    if (apply) {
        const docs = await FoodCategory.find({ restaurantId: { $exists: false } }, '_id name').lean();
        for (const doc of docs) {
            const key = toLowerCollapsed(doc.name);
            if (key) existingByKey.set(key, doc);
        }
    }

    for (const row of rows) {
        stats.total += 1;
        try {
            const payload = buildCategoryPayload(row);
            if (!payload.uniqueKey) {
                stats.skipped += 1;
                skipped.push({ legacyId: payload.legacyId, reason: 'missing_category_name' });
                continue;
            }

            stats.valid += 1;
            idMap[payload.legacyId] = argsDryRunId(payload.legacyId, apply);
            summary.push({
                legacyId: payload.legacyId,
                name: payload.doc.name
            });

            if (!apply) continue;

            const existing = existingByKey.get(payload.uniqueKey) || null;
            let targetId = '';
            if (existing?._id) {
                await FoodCategory.updateOne({ _id: existing._id }, { $set: payload.doc });
                stats.updated += 1;
                targetId = String(existing._id);
            } else {
                const created = await FoodCategory.create(payload.doc);
                stats.created += 1;
                targetId = String(created._id);
                existingByKey.set(payload.uniqueKey, { _id: created._id, name: created.name });
            }
            idMap[payload.legacyId] = targetId;
        } catch (error) {
            stats.errors += 1;
            errors.push({
                legacyId: toTrimmedString(row.id || row._id),
                error: error.message
            });
        }
    }

    await writeJson(path.join(outputDir, 'categories-migration-result.json'), { stats, summary, skipped, errors, idMap });
    return { stats, idMap, skipped, errors };
}

async function migrateProducts({ rows, lookups, restaurantIdMap, categoryIdMap, apply, outputDir }) {
    const stats = buildStats('products');
    const idMap = {};
    const skipped = [];
    const errors = [];
    const summary = [];
    const addonNotes = [];
    const subCategoryNotes = [];

    const existingByKey = new Map();
    if (apply) {
        const docs = await FoodItem.find({}, '_id restaurantId categoryId name').lean();
        for (const doc of docs) {
            const key = `${String(doc.restaurantId)}|${String(doc.categoryId || '')}|${toLowerCollapsed(doc.name)}`;
            existingByKey.set(key, doc);
        }
    }

    for (const row of rows) {
        stats.total += 1;
        try {
            const payload = buildProductPayload(row, {
                restaurantIdMap,
                categoryIdMap,
                lookups
            });

            if (payload.blockers.length > 0) {
                stats.skipped += 1;
                skipped.push({
                    legacyId: payload.legacyId,
                    name: toTrimmedString(row.productName),
                    reason: payload.blockers.join(',')
                });
                continue;
            }

            stats.valid += 1;
            idMap[payload.legacyId] = argsDryRunId(payload.legacyId, apply);
            summary.push({
                legacyId: payload.legacyId,
                name: payload.doc.name,
                restaurantId: String(payload.doc.restaurantId),
                categoryId: payload.doc.categoryId ? String(payload.doc.categoryId) : '',
                variantCount: payload.doc.variants.length
            });

            if (payload.hasAddons) {
                addonNotes.push({
                    legacyId: payload.legacyId,
                    name: payload.doc.name,
                    restaurantId: String(payload.doc.restaurantId),
                    note: 'legacy product has addonsList but current FoodItem has no direct addon link'
                });
            }

            if (payload.legacySubCategoryId || payload.legacySubCategoryName) {
                subCategoryNotes.push({
                    legacyId: payload.legacyId,
                    name: payload.doc.name,
                    legacySubCategoryId: payload.legacySubCategoryId,
                    legacySubCategoryName: payload.legacySubCategoryName
                });
            }

            if (!apply) continue;

            const existing = existingByKey.get(payload.uniqueKey) || null;
            let targetId = '';
            if (existing?._id) {
                await FoodItem.updateOne({ _id: existing._id }, { $set: payload.doc });
                stats.updated += 1;
                targetId = String(existing._id);
            } else {
                const created = await FoodItem.create(payload.doc);
                stats.created += 1;
                targetId = String(created._id);
                existingByKey.set(payload.uniqueKey, {
                    _id: created._id,
                    restaurantId: created.restaurantId,
                    categoryId: created.categoryId,
                    name: created.name
                });
            }
            idMap[payload.legacyId] = targetId;
        } catch (error) {
            stats.errors += 1;
            errors.push({
                legacyId: toTrimmedString(row.id || row._id),
                error: error.message
            });
        }
    }

    await writeJson(path.join(outputDir, 'products-migration-result.json'), {
        stats,
        summary,
        skipped,
        errors,
        idMap,
        addonNotes,
        subCategoryNotes
    });
    return { stats, idMap, skipped, errors, addonNotes, subCategoryNotes };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return;
    }

    const outputDir = getOutputDir(args.outputDir);
    await ensureDir(outputDir);

    logger.info(`Legacy data dir: ${args.dataDir}`);
    logger.info(`Output dir: ${outputDir}`);
    logger.info(`Mode: ${args.apply ? 'APPLY' : 'DRY-RUN'}`);
    logger.info(`Scopes: ${args.scopes.join(', ')}`);

    const data = loadLegacyData(args.dataDir);
    const lookups = buildLookupMaps(data);
    const globalSummary = {
        mode: args.apply ? 'apply' : 'dry-run',
        dataDir: args.dataDir,
        scopes: args.scopes,
        generatedAt: new Date().toISOString(),
        sourceCounts: {
            users: data.users.length,
            vendors: data.vendors.length,
            owners: data.owners.length,
            drivers: data.drivers.length,
            categories: data.categories.length,
            subCategories: data.subCategories.length,
            products: data.products.length
        },
        outputs: {}
    };

    await withDb(args.apply, async () => {
        const userResult = args.scopes.includes('users')
            ? await migrateUsers({
                rows: data.users,
                apply: args.apply,
                outputDir
            })
            : { stats: null, idMap: {} };

        const restaurantResult = args.scopes.includes('restaurants')
            ? await migrateRestaurants({
                rows: data.vendors,
                lookups,
                apply: args.apply,
                outputDir
            })
            : { stats: null, idMap: {} };

        const driverResult = args.scopes.includes('drivers')
            ? await migrateDrivers({
                rows: data.drivers,
                lookups,
                apply: args.apply,
                outputDir
            })
            : { stats: null, idMap: {} };

        const categoryResult = args.scopes.includes('categories')
            ? await migrateCategories({
                rows: data.categories,
                apply: args.apply,
                outputDir
            })
            : { stats: null, idMap: {} };

        const productResult = args.scopes.includes('products')
            ? await migrateProducts({
                rows: data.products,
                lookups,
                restaurantIdMap: restaurantResult.idMap || new Map(),
                categoryIdMap: categoryResult.idMap || new Map(),
                apply: args.apply,
                outputDir
            })
            : { stats: null, idMap: {} };

        const legacyIdMap = {
            users: userResult.idMap || {},
            restaurants: restaurantResult.idMap || {},
            drivers: driverResult.idMap || {},
            categories: categoryResult.idMap || {},
            products: productResult.idMap || {}
        };

        await writeJson(path.join(outputDir, 'legacy-id-map.json'), legacyIdMap);

        globalSummary.outputs = {
            users: userResult.stats,
            restaurants: restaurantResult.stats,
            drivers: driverResult.stats,
            categories: categoryResult.stats,
            products: productResult.stats
        };
    });

    await writeJson(path.join(outputDir, 'migration-summary.json'), globalSummary);
    logger.info('Legacy core migration run completed');
}

function argsDryRunId(legacyId, apply) {
    return apply ? '' : `dryrun:${legacyId}`;
}

main().catch(async (error) => {
    logger.error(error?.stack || error?.message || String(error));
    if (mongoose.connection.readyState) {
        try {
            await disconnectDB();
        } catch {
            // noop
        }
    }
    process.exitCode = 1;
});

