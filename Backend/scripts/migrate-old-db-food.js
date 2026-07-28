import fs from 'fs/promises';
import dns from 'node:dns/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import XLSX from 'xlsx';

import { connectDB, disconnectDB } from '../src/config/db.js';
import { logger } from '../src/utils/logger.js';
import { FoodItem } from '../src/modules/food/admin/models/food.model.js';
import { FoodRestaurant } from '../src/modules/food/restaurant/models/restaurant.model.js';
import { FoodCategory } from '../src/modules/food/admin/models/category.model.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_FOOD_INPUT = path.join(REPO_ROOT, 'old db', 'food.csv');
const DEFAULT_RESTAURANTS_INPUT = path.join(REPO_ROOT, 'old db', 'restaurants.csv');
const DEFAULT_CATEGORIES_INPUT = path.join(REPO_ROOT, 'old db', 'categories.csv');
const DEFAULT_VARIATIONS_INPUT = path.join(REPO_ROOT, 'old db', 'variations.csv');
const DEFAULT_VARIATION_OPTIONS_INPUT = path.join(REPO_ROOT, 'old db', 'variation_options.csv');
const OUTPUT_ROOT = path.join(REPO_ROOT, 'migration-output', 'old-db-food');

function parseArgs(argv = []) {
    const args = {
        apply: false,
        foodInput: DEFAULT_FOOD_INPUT,
        restaurantsInput: DEFAULT_RESTAURANTS_INPUT,
        categoriesInput: DEFAULT_CATEGORIES_INPUT,
        variationsInput: DEFAULT_VARIATIONS_INPUT,
        variationOptionsInput: DEFAULT_VARIATION_OPTIONS_INPUT,
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
        if (arg.startsWith('--food-input=')) args.foodInput = arg.slice('--food-input='.length).trim();
        else if (arg.startsWith('--restaurants-input=')) args.restaurantsInput = arg.slice('--restaurants-input='.length).trim();
        else if (arg.startsWith('--categories-input=')) args.categoriesInput = arg.slice('--categories-input='.length).trim();
        else if (arg.startsWith('--variations-input=')) args.variationsInput = arg.slice('--variations-input='.length).trim();
        else if (arg.startsWith('--variation-options-input=')) args.variationOptionsInput = arg.slice('--variation-options-input='.length).trim();
        else if (arg.startsWith('--output-dir=')) args.outputDir = arg.slice('--output-dir='.length).trim();
        else if (arg.startsWith('--limit=')) {
            const parsed = Number(arg.slice('--limit='.length).trim());
            args.limit = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
        }
    }

    return args;
}

function printHelp() {
    console.log(`
Old DB food migration

Usage:
  node scripts/migrate-old-db-food.js
  node scripts/migrate-old-db-food.js --apply

Options:
  --apply                        Write food items into MongoDB
  --food-input=...               Custom legacy food CSV path
  --restaurants-input=...        Custom legacy restaurant CSV path
  --categories-input=...         Custom legacy category CSV path
  --variations-input=...         Custom legacy variation CSV path
  --variation-options-input=...  Custom legacy variation options CSV path
  --output-dir=...               Custom report directory
  --limit=...                    Process first N rows only
  --help                         Show this help
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

function parseNullablePositiveNumber(value) {
    const raw = toTrimmedString(value);
    if (!raw) return null;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return numeric;
}

function parseDate(value) {
    const raw = toTrimmedString(value);
    if (!raw || raw === '0000-00-00 00:00:00') return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
}

function readCsvRows(filePath) {
    const workbook = XLSX.readFile(filePath, { raw: false, cellDates: false });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
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

function parsePhoneInfo(value) {
    const raw = toTrimmedString(value);
    const digits = toDigits(raw);
    if (!digits) return { last10: '', normalized: '' };
    const last10 = digits.slice(-10);
    return {
        last10,
        normalized: raw.startsWith('+') ? raw : `+91${last10}`
    };
}

function buildRestaurantLegacyMap(rows) {
    const map = new Map();
    for (const row of rows) {
        const legacyId = toTrimmedString(row.id || row.vendor_id);
        const name = toTrimmedString(row.name);
        const phoneInfo = parsePhoneInfo(row.phone);
        if (!legacyId || !name || !phoneInfo.last10) continue;
        const uniqueKey = `${toLowerCollapsed(name)}|${phoneInfo.last10}`;
        map.set(legacyId, {
            legacyId,
            restaurantName: name,
            uniqueKey,
            phoneLast10: phoneInfo.last10
        });
    }
    return map;
}

function buildCategoryLegacyMap(rows) {
    const map = new Map();
    for (const row of rows) {
        const legacyId = toTrimmedString(row.id);
        const name = toTrimmedString(row.name).replace(/\s+/g, ' ').trim();
        if (!legacyId || !name) continue;
        map.set(legacyId, {
            legacyId,
            name,
            normalizedName: toLowerCollapsed(name)
        });
    }
    return map;
}

function buildVariationGroupMap(rows) {
    const map = new Map();
    for (const row of rows) {
        const foodId = toTrimmedString(row.food_id);
        if (!foodId) continue;
        if (!map.has(foodId)) map.set(foodId, []);
        map.get(foodId).push({
            id: toTrimmedString(row.id),
            name: toTrimmedString(row.name),
            type: toTrimmedString(row.type),
            min: parseNumber(row.min, 0),
            max: parseNumber(row.max, 0),
            isRequired: parseBooleanish(row.is_required, false)
        });
    }
    return map;
}

function buildVariationOptionsMap(rows) {
    const byFoodId = new Map();
    for (const row of rows) {
        const foodId = toTrimmedString(row.food_id);
        const optionName = toTrimmedString(row.option_name);
        const optionPrice = parseNullablePositiveNumber(row.option_price);
        if (!foodId || !optionName || optionPrice == null) continue;
        if (!byFoodId.has(foodId)) byFoodId.set(foodId, []);
        byFoodId.get(foodId).push({
            id: toTrimmedString(row.id),
            variationId: toTrimmedString(row.variation_id),
            name: optionName,
            price: optionPrice,
            restaurantPrice: parseNullablePositiveNumber(row.restaurant_price),
            stockType: toTrimmedString(row.stock_type),
            totalStock: parseNumber(row.total_stock, 0),
            sellCount: parseNumber(row.sell_count, 0),
            createdAt: parseDate(row.created_at),
            updatedAt: parseDate(row.updated_at)
        });
    }

    for (const [foodId, list] of byFoodId.entries()) {
        const deduped = [];
        const seen = new Set();
        for (const option of list) {
            const key = `${toLowerCollapsed(option.name)}|${option.price}`;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(option);
        }
        byFoodId.set(foodId, deduped);
    }

    return byFoodId;
}

function buildVariantDocs(optionList = []) {
    return optionList
        .filter((option) => option?.name && Number.isFinite(Number(option?.price)) && Number(option.price) > 0)
        .map((option) => ({
            name: String(option.name).trim(),
            price: Number(option.price)
        }));
}

function determinePricing(row, variantDocs) {
    const basePrice = parseNumber(row.price, 0);
    const rowRestaurantPrice = parseNullablePositiveNumber(row.restaurant_price);

    if (variantDocs.length > 0) {
        const minVariantPrice = Math.min(...variantDocs.map((entry) => Number(entry.price) || 0));
        return {
            importable: true,
            price: minVariantPrice,
            priceOnOtherPlatforms: rowRestaurantPrice && Math.abs(rowRestaurantPrice - minVariantPrice) > 0.01 ? rowRestaurantPrice : null,
            usedVariants: true
        };
    }

    if (basePrice > 0) {
        return {
            importable: true,
            price: basePrice,
            priceOnOtherPlatforms: rowRestaurantPrice && Math.abs(rowRestaurantPrice - basePrice) > 0.01 ? rowRestaurantPrice : null,
            usedVariants: false
        };
    }

    return {
        importable: false,
        price: 0,
        priceOnOtherPlatforms: rowRestaurantPrice,
        usedVariants: false,
        reason: rowRestaurantPrice && rowRestaurantPrice <= 1
            ? 'legacy_variant_only_tiny_fallback_price'
            : 'legacy_variant_only_missing_priced_options'
    };
}

function buildPreparedFoods(foodRows, context) {
    const prepared = [];
    const issues = [];
    const skipped = [];
    const seenKeys = new Map();

    for (const row of foodRows) {
        const legacyId = toTrimmedString(row.id);
        const name = toTrimmedString(row.name).replace(/\s+/g, ' ').trim();
        const restaurantLegacyId = toTrimmedString(row.restaurant_id);
        const categoryLegacyId = toTrimmedString(row.category_id);
        const restaurantLegacy = context.restaurantsByLegacyId.get(restaurantLegacyId) || null;
        const categoryLegacy = context.categoriesByLegacyId.get(categoryLegacyId) || null;
        const variationGroups = context.variationGroupsByFoodId.get(legacyId) || [];
        const variantOptions = context.variationOptionsByFoodId.get(legacyId) || [];
        const variantDocs = buildVariantDocs(variantOptions);

        if (!legacyId) {
            issues.push({ type: 'missing_legacy_id', row });
            continue;
        }
        if (!name) {
            issues.push({ type: 'missing_name', legacyId, row });
            continue;
        }
        if (!restaurantLegacy) {
            issues.push({ type: 'missing_restaurant_reference', legacyId, restaurantLegacyId, row });
            continue;
        }
        if (!categoryLegacy) {
            issues.push({ type: 'missing_category_reference', legacyId, categoryLegacyId, row });
            continue;
        }

        const pricing = determinePricing(row, variantDocs);
        if (!pricing.importable) {
            skipped.push({
                legacyId,
                name,
                restaurantLegacyId,
                restaurantName: restaurantLegacy.restaurantName,
                categoryLegacyId,
                categoryName: categoryLegacy.name,
                reason: pricing.reason,
                basePrice: parseNumber(row.price, 0),
                restaurantPrice: parseNullablePositiveNumber(row.restaurant_price),
                variationGroups,
                variantOptions: variantOptions.slice(0, 20)
            });
            continue;
        }

        const uniqueKey = `${restaurantLegacy.uniqueKey}|${categoryLegacy.normalizedName}|${toLowerCollapsed(name)}`;
        if (seenKeys.has(uniqueKey)) {
            issues.push({
                type: 'duplicate_food_key',
                legacyId,
                duplicateOf: seenKeys.get(uniqueKey),
                uniqueKey,
                name
            });
            continue;
        }
        seenKeys.set(uniqueKey, legacyId);

        const createdAt = parseDate(row.created_at) || new Date();
        const updatedAt = parseDate(row.updated_at) || createdAt;
        const status = parseBooleanish(row.status, true);
        const foodType = parseBooleanish(row.veg, false) ? 'Veg' : 'Non-Veg';
        const tax = parseNullablePositiveNumber(row.tax);

        prepared.push({
            legacyId,
            uniqueKey,
            restaurantLegacyId,
            restaurantUniqueKey: restaurantLegacy.uniqueKey,
            categoryLegacyId,
            categoryNormalizedName: categoryLegacy.normalizedName,
            doc: {
                _id: new mongoose.Types.ObjectId(),
                restaurantId: null,
                categoryId: null,
                categoryName: categoryLegacy.name,
                name,
                description: toTrimmedString(row.description),
                price: pricing.price,
                priceOnOtherPlatforms: pricing.priceOnOtherPlatforms,
                otherPlatformGst: tax,
                variants: variantDocs,
                image: toTrimmedString(row.image),
                foodType,
                isAvailable: status,
                preparationTime: '',
                approvalStatus: 'approved',
                rejectionReason: '',
                requestedAt: undefined,
                approvedAt: updatedAt,
                rejectedAt: undefined,
                createdAt,
                updatedAt
            },
            meta: {
                legacyOrderCount: parseNumber(row.order_count, 0),
                legacyRatingCount: parseNumber(row.rating_count, 0),
                legacyAvgRating: parseNumber(row.avg_rating, 0),
                legacySlug: toTrimmedString(row.slug),
                legacyRecommended: parseBooleanish(row.recommended, false),
                variationGroups,
                variantOptionsCount: variantOptions.length,
                variantsRecovered: variantDocs.length > 0,
                stockType: toTrimmedString(row.stock_type),
                maxCartQuantity: parseNumber(row.maximum_cart_quantity, 0)
            }
        });
    }

    return { prepared, issues, skipped };
}

function buildReport(prepared, issues, skipped, args, rawRowsCount) {
    const skippedByReason = skipped.reduce((acc, item) => {
        acc[item.reason] = (acc[item.reason] || 0) + 1;
        return acc;
    }, {});

    return {
        source: path.resolve(args.foodInput),
        variationOptionsSource: path.resolve(args.variationOptionsInput),
        applyMode: args.apply,
        rawRows: rawRowsCount,
        processedFoods: prepared.length,
        skippedFoods: skipped.length,
        activeFoods: prepared.filter((item) => item.doc.isAvailable).length,
        vegFoods: prepared.filter((item) => item.doc.foodType === 'Veg').length,
        foodsWithVariants: prepared.filter((item) => Array.isArray(item.doc.variants) && item.doc.variants.length > 0).length,
        foodsRecoveredFromVariationOptions: prepared.filter((item) => item.meta.variantsRecovered).length,
        foodsWithOtherPlatformPrice: prepared.filter((item) => item.doc.priceOnOtherPlatforms != null).length,
        skippedByReason,
        fieldMapping: {
            name: 'FoodItem.name',
            description: 'FoodItem.description',
            image: 'FoodItem.image',
            restaurant_id: 'FoodItem.restaurantId via imported restaurant mapping',
            category_id: 'FoodItem.categoryId via imported category mapping',
            price: 'FoodItem.price',
            restaurant_price: 'FoodItem.priceOnOtherPlatforms when usable',
            tax: 'FoodItem.otherPlatformGst',
            veg: 'FoodItem.foodType',
            status: 'FoodItem.isAvailable',
            option_name: 'FoodItem.variants[].name',
            option_price: 'FoodItem.variants[].price',
            created_at: 'FoodItem.createdAt',
            updated_at: 'FoodItem.updatedAt'
        },
        unmappedLegacyFields: [
            'category_ids',
            'add_ons',
            'attributes',
            'choice_options',
            'tax_type',
            'discount',
            'discount_type',
            'available_time_starts',
            'available_time_ends',
            'order_count',
            'avg_rating',
            'rating_count',
            'rating',
            'recommended',
            'slug',
            'maximum_cart_quantity',
            'is_halal',
            'item_stock',
            'sell_count',
            'stock_type',
            'total_stock'
        ],
        notes: [
            'Foods now recover real variants from variation_options.csv when priced option rows exist.',
            'When variants exist, FoodItem.price is set to the minimum variant price to match current app pricing behavior.',
            'Foods are skipped only if they still have no real base price and no priced variation options.',
            'All imported foods are marked approvalStatus=approved because they are historical production menu items.'
        ],
        issues,
        skippedPreview: skipped.slice(0, 100)
    };
}

async function applyFoods(prepared) {
    const restaurantDocs = await FoodRestaurant.find({})
        .select('_id restaurantNameNormalized ownerPhoneLast10')
        .lean();
    const categoryDocs = await FoodCategory.find({})
        .select('_id name')
        .lean();

    const restaurantMap = new Map(
        restaurantDocs
            .filter((doc) => doc?.restaurantNameNormalized && doc?.ownerPhoneLast10)
            .map((doc) => [`${doc.restaurantNameNormalized}|${doc.ownerPhoneLast10}`, doc])
    );
    const categoryMap = new Map(categoryDocs.map((doc) => [toLowerCollapsed(doc.name), doc]));

    const unresolved = [];
    const bulkOps = [];

    for (const item of prepared) {
        const restaurant = restaurantMap.get(item.restaurantUniqueKey) || null;
        const category = categoryMap.get(item.categoryNormalizedName) || null;

        if (!restaurant || !category) {
            unresolved.push({
                legacyId: item.legacyId,
                name: item.doc.name,
                restaurantUniqueKey: item.restaurantUniqueKey,
                categoryNormalizedName: item.categoryNormalizedName,
                missingRestaurant: !restaurant,
                missingCategory: !category
            });
            continue;
        }

        const finalDoc = {
            ...item.doc,
            restaurantId: restaurant._id,
            categoryId: category._id,
            categoryName: category.name
        };
        delete finalDoc._id;

        bulkOps.push({
            updateOne: {
                filter: {
                    restaurantId: restaurant._id,
                    categoryId: category._id,
                    name: item.doc.name
                },
                update: {
                    $set: finalDoc,
                    $setOnInsert: { _id: item.doc._id }
                },
                upsert: true
            }
        });
    }

    if (bulkOps.length > 0) {
        await FoodItem.collection.bulkWrite(bulkOps, { ordered: false });
    }

    return {
        foodsUpserted: bulkOps.length,
        unresolvedCount: unresolved.length,
        unresolvedPreview: unresolved.slice(0, 50)
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

    const allFoodRows = readCsvRows(args.foodInput);
    const restaurantRows = readCsvRows(args.restaurantsInput);
    const categoryRows = readCsvRows(args.categoriesInput);
    const variationRows = readCsvRows(args.variationsInput);
    const variationOptionRows = readCsvRows(args.variationOptionsInput);
    const foodRows = args.limit > 0 ? allFoodRows.slice(0, args.limit) : allFoodRows;

    const context = {
        restaurantsByLegacyId: buildRestaurantLegacyMap(restaurantRows),
        categoriesByLegacyId: buildCategoryLegacyMap(categoryRows),
        variationGroupsByFoodId: buildVariationGroupMap(variationRows),
        variationOptionsByFoodId: buildVariationOptionsMap(variationOptionRows)
    };

    const { prepared, issues, skipped } = buildPreparedFoods(foodRows, context);
    const report = buildReport(prepared, issues, skipped, args, allFoodRows.length);
    const preview = prepared.slice(0, 50).map((item) => ({
        legacyId: item.legacyId,
        name: item.doc.name,
        restaurantLegacyId: item.restaurantLegacyId,
        categoryLegacyId: item.categoryLegacyId,
        categoryName: item.doc.categoryName,
        price: item.doc.price,
        variants: item.doc.variants,
        foodType: item.doc.foodType,
        isAvailable: item.doc.isAvailable
    }));

    await writeJson(path.join(outputDir, 'food-report.json'), report);
    await writeJson(path.join(outputDir, 'food-preview.json'), preview);

    let applyResult = null;
    if (args.apply) {
        await connectDB();
        try {
            applyResult = await applyFoods(prepared);
            await writeJson(path.join(outputDir, 'apply-result.json'), applyResult);
        } finally {
            await disconnectDB();
        }
    }

    logger.info(`Processed ${prepared.length} importable legacy foods from ${args.foodInput}`);
    logger.info(`Skipped ${skipped.length} legacy foods without usable pricing`);
    logger.info(`Report written to ${outputDir}`);
    if (issues.length > 0) {
        logger.warn(`Detected ${issues.length} migration issues. Review food-report.json before apply.`);
    }
    if (applyResult) {
        logger.info(`Applied ${applyResult.foodsUpserted} foods`);
        if (applyResult.unresolvedCount > 0) {
            logger.warn(`Could not resolve ${applyResult.unresolvedCount} foods to imported restaurants/categories.`);
        }
    }
}

main().catch((error) => {
    logger.error(error?.stack || error?.message || String(error));
    process.exit(1);
});
