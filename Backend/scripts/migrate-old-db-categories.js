import fs from 'fs/promises';
import dns from 'node:dns/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import XLSX from 'xlsx';

import { connectDB, disconnectDB } from '../src/config/db.js';
import { logger } from '../src/utils/logger.js';
import { FoodCategory } from '../src/modules/food/admin/models/category.model.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_INPUT = path.join(REPO_ROOT, 'old db', 'categories.csv');
const OUTPUT_ROOT = path.join(REPO_ROOT, 'migration-output', 'old-db-categories');

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
Old DB category migration

Usage:
  node scripts/migrate-old-db-categories.js
  node scripts/migrate-old-db-categories.js --apply

Options:
  --apply              Write categories into MongoDB
  --input=...          Custom input CSV path
  --output-dir=...     Custom report directory
  --limit=...          Process first N rows only
  --help               Show this help

Default mode:
  Dry run only. Reads old db/categories.csv and writes compatibility reports.
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

function buildPreparedCategories(rows) {
    const prepared = [];
    const issues = [];
    const seenNames = new Map();

    for (const row of rows) {
        const legacyId = toTrimmedString(row.id);
        const name = toTrimmedString(row.name).replace(/\s+/g, ' ').trim();
        const normalizedName = toLowerCollapsed(name);

        if (!legacyId) {
            issues.push({ type: 'missing_legacy_id', row });
            continue;
        }
        if (!name) {
            issues.push({ type: 'missing_name', legacyId, row });
            continue;
        }
        if (seenNames.has(normalizedName)) {
            issues.push({
                type: 'duplicate_name',
                legacyId,
                duplicateOf: seenNames.get(normalizedName),
                name
            });
            continue;
        }
        seenNames.set(normalizedName, legacyId);

        const createdAt = parseDate(row.created_at) || new Date();
        const updatedAt = parseDate(row.updated_at) || createdAt;
        const isActive = parseBooleanish(row.status, true);
        const sortOrder = parseNumber(row.priority, parseNumber(row.position, 0));

        prepared.push({
            legacyId,
            normalizedName,
            doc: {
                _id: new mongoose.Types.ObjectId(),
                name,
                image: toTrimmedString(row.image),
                type: '',
                foodTypeScope: 'Both',
                restaurantId: undefined,
                createdByRestaurantId: undefined,
                approvalStatus: 'approved',
                isApproved: true,
                rejectionReason: '',
                requestedAt: undefined,
                approvedAt: updatedAt,
                rejectedAt: undefined,
                globalizedAt: undefined,
                zoneId: undefined,
                isActive,
                sortOrder,
                createdAt,
                updatedAt
            },
            meta: {
                parentId: toTrimmedString(row.parent_id),
                slug: toTrimmedString(row.slug),
                position: parseNumber(row.position, 0),
                priority: parseNumber(row.priority, 0)
            }
        });
    }

    return { prepared, issues };
}

function buildReport(prepared, issues, args, rawRows) {
    return {
        source: path.resolve(args.input),
        applyMode: args.apply,
        rawRows,
        processedCategories: prepared.length,
        activeCategories: prepared.filter((item) => item.doc.isActive).length,
        fieldMapping: {
            name: 'FoodCategory.name',
            image: 'FoodCategory.image',
            status: 'FoodCategory.isActive',
            priority: 'FoodCategory.sortOrder fallback',
            position: 'FoodCategory.sortOrder fallback',
            created_at: 'FoodCategory.createdAt',
            updated_at: 'FoodCategory.updatedAt'
        },
        unmappedLegacyFields: [
            'parent_id',
            'slug'
        ],
        notes: [
            'Legacy categories are imported as approved global admin categories.',
            'foodTypeScope defaults to Both because the old category CSV does not encode a veg/non-veg scope.',
            'parent_id is not used because the current category schema is flat.'
        ],
        issues
    };
}

async function applyCategories(prepared) {
    const existingDocs = await FoodCategory.find({
        name: { $in: prepared.map((item) => item.doc.name) },
        restaurantId: { $exists: false }
    }).select('_id name').lean();

    const existingMap = new Map(existingDocs.map((doc) => [toLowerCollapsed(doc.name), doc]));

    const bulkOps = prepared.map((item) => {
        const existing = existingMap.get(item.normalizedName);
        const finalId = existing?._id || item.doc._id;
        const doc = { ...item.doc };
        delete doc._id;

        return {
            updateOne: {
                filter: {
                    name: item.doc.name,
                    restaurantId: { $exists: false }
                },
                update: {
                    $set: doc,
                    $setOnInsert: { _id: finalId }
                },
                upsert: true
            }
        };
    });

    if (bulkOps.length > 0) {
        await FoodCategory.collection.bulkWrite(bulkOps, { ordered: false });
    }

    return {
        categoriesUpserted: bulkOps.length
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
    const { prepared, issues } = buildPreparedCategories(rows);
    const report = buildReport(prepared, issues, args, allRows.length);
    const preview = prepared.slice(0, 20).map((item) => ({
        legacyId: item.legacyId,
        name: item.doc.name,
        isActive: item.doc.isActive,
        sortOrder: item.doc.sortOrder,
        image: item.doc.image
    }));

    await writeJson(path.join(outputDir, 'categories-report.json'), report);
    await writeJson(path.join(outputDir, 'categories-preview.json'), preview);

    let applyResult = null;
    if (args.apply) {
        await connectDB();
        try {
            applyResult = await applyCategories(prepared);
            await writeJson(path.join(outputDir, 'apply-result.json'), applyResult);
        } finally {
            await disconnectDB();
        }
    }

    logger.info(`Processed ${prepared.length} legacy categories from ${args.input}`);
    logger.info(`Report written to ${outputDir}`);
    if (issues.length > 0) {
        logger.warn(`Detected ${issues.length} migration issues. Review categories-report.json before apply.`);
    }
    if (applyResult) {
        logger.info(`Applied ${applyResult.categoriesUpserted} categories`);
    }
}

main().catch((error) => {
    logger.error(error?.stack || error?.message || String(error));
    process.exit(1);
});
