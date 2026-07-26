import fs from 'fs/promises';
import dns from 'node:dns/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import XLSX from 'xlsx';

import { connectDB, disconnectDB } from '../src/config/db.js';
import { logger } from '../src/utils/logger.js';
import { FoodUser } from '../src/core/users/user.model.js';
import { FoodUserWallet } from '../src/modules/food/user/models/userWallet.model.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_INPUT = path.join(REPO_ROOT, 'old db', 'users (1).csv');
const OUTPUT_ROOT = path.join(REPO_ROOT, 'migration-output', 'old-db-users');

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
Old DB user migration

Usage:
  node scripts/migrate-old-db-users.js
  node scripts/migrate-old-db-users.js --apply
  node scripts/migrate-old-db-users.js --limit=100

Options:
  --apply              Write users and wallets into MongoDB
  --input=...          Custom input CSV path
  --output-dir=...     Custom report directory
  --limit=...          Process first N rows only
  --help               Show this help

Default mode:
  Dry run only. Reads old db/users (1).csv and writes compatibility reports.
`);
}

function toTrimmedString(value) {
    if (value == null) return '';
    const raw = String(value).trim();
    if (!raw || raw.toUpperCase() === 'NULL') return '';
    return raw;
}

function toLower(value) {
    return toTrimmedString(value).toLowerCase();
}

function toDigits(value) {
    return toTrimmedString(value).replace(/\D/g, '');
}

function parsePhoneInfo(value) {
    const raw = toTrimmedString(value);
    const digits = toDigits(raw);
    if (!digits) {
        return {
            phone: '',
            countryCode: '+91'
        };
    }

    const localDigits = digits.slice(-10);
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
        phone: `${countryCode}${localDigits}`,
        countryCode
    };
}

function parseBooleanish(value, fallback = false) {
    const raw = toLower(value);
    if (!raw) return fallback;
    if (['1', 'true', 'yes'].includes(raw)) return true;
    if (['0', 'false', 'no'].includes(raw)) return false;
    return fallback;
}

function parseNumber(value, fallback = 0) {
    const raw = toTrimmedString(value);
    if (!raw) return fallback;
    const num = Number(raw);
    return Number.isFinite(num) ? num : fallback;
}

function parseDate(value) {
    const raw = toTrimmedString(value);
    if (!raw || raw === '0000-00-00 00:00:00') return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
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

function buildDisplayName(row) {
    return uniqueStrings([row.f_name, row.l_name]).join(' ').replace(/\s+/g, ' ').trim();
}

function buildStatusFlags(row) {
    const active = parseBooleanish(row.status, true);
    const blacklisted = parseBooleanish(row.blacklisted, false);
    return {
        isActive: active && !blacklisted,
        blacklisted
    };
}

function pickRichestString(values = []) {
    return values
        .map((value) => toTrimmedString(value))
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)[0] || '';
}

function latestDate(rows, field) {
    return rows
        .map((row) => parseDate(row[field]))
        .filter(Boolean)
        .sort((a, b) => b.getTime() - a.getTime())[0] || null;
}

function scoreRowForPrimary(row) {
    return [
        buildDisplayName(row) ? 5 : 0,
        toTrimmedString(row.email) ? 4 : 0,
        parseBooleanish(row.is_phone_verified, false) ? 3 : 0,
        toTrimmedString(row.ref_code) ? 2 : 0,
        Math.min(2, parseNumber(row.order_count, 0)),
        toTrimmedString(row.cm_firebase_token) ? 1 : 0
    ].reduce((sum, value) => sum + value, 0);
}

function mergeDuplicateGroup(rows, phone) {
    const sorted = [...rows].sort((a, b) => {
        const scoreDiff = scoreRowForPrimary(b) - scoreRowForPrimary(a);
        if (scoreDiff !== 0) return scoreDiff;
        const updatedA = parseDate(a.updated_at)?.getTime() || 0;
        const updatedB = parseDate(b.updated_at)?.getTime() || 0;
        return updatedB - updatedA;
    });

    const primary = sorted[0];
    const latest = [...rows].sort((a, b) => (parseDate(b.updated_at)?.getTime() || 0) - (parseDate(a.updated_at)?.getTime() || 0))[0];
    const richestNameRow = [...rows].sort((a, b) => buildDisplayName(b).length - buildDisplayName(a).length)[0];
    const verifiedRow = rows.find((row) => parseBooleanish(row.is_phone_verified, false)) || latest || primary;
    const emailRow = rows.find((row) => toTrimmedString(row.email)) || richestNameRow || primary;
    const refCodeRow = rows.find((row) => toTrimmedString(row.ref_code)) || primary;
    const fcmRow = rows.find((row) => toTrimmedString(row.cm_firebase_token)) || primary;
    const imageRow = rows.find((row) => toTrimmedString(row.image)) || primary;

    const merged = {
        ...primary,
        id: primary.id,
        merged_from_ids: rows.map((row) => toTrimmedString(row.id)).filter(Boolean),
        phone,
        f_name: richestNameRow ? toTrimmedString(richestNameRow.f_name) : '',
        l_name: richestNameRow ? toTrimmedString(richestNameRow.l_name) : '',
        email: emailRow ? toTrimmedString(emailRow.email) : '',
        image: imageRow ? toTrimmedString(imageRow.image) : '',
        is_phone_verified: rows.some((row) => parseBooleanish(row.is_phone_verified, false)) ? '1' : '0',
        email_verified_at: pickRichestString(rows.map((row) => row.email_verified_at)),
        password: pickRichestString(rows.map((row) => row.password)),
        remember_token: pickRichestString(rows.map((row) => row.remember_token)),
        created_at: latestDate(rows, 'created_at') ? null : null,
        updated_at: latestDate(rows, 'updated_at') ? null : null,
        interest: pickRichestString(rows.map((row) => row.interest)),
        cm_firebase_token: fcmRow ? toTrimmedString(fcmRow.cm_firebase_token) : '',
        status: rows.some((row) => parseBooleanish(row.status, true)) ? '1' : '0',
        order_count: String(Math.max(...rows.map((row) => parseNumber(row.order_count, 0)), 0)),
        login_medium: pickRichestString(rows.map((row) => row.login_medium)) || 'otp',
        social_id: pickRichestString(rows.map((row) => row.social_id)),
        zone_id: pickRichestString(rows.map((row) => row.zone_id)),
        wallet_balance: Math.max(...rows.map((row) => parseNumber(row.wallet_balance, 0)), 0).toFixed(3),
        loyalty_point: Math.max(...rows.map((row) => parseNumber(row.loyalty_point, 0)), 0).toFixed(3),
        ref_code: refCodeRow ? toTrimmedString(refCodeRow.ref_code) : '',
        ref_by: pickRichestString(rows.map((row) => row.ref_by)),
        temp_token: pickRichestString(rows.map((row) => row.temp_token)),
        current_language_key: pickRichestString(rows.map((row) => row.current_language_key)) || 'en',
        is_email_verified: rows.some((row) => parseBooleanish(row.is_email_verified, false)) ? '1' : '0',
        blacklisted: rows.some((row) => parseBooleanish(row.blacklisted, false)) ? '1' : '0',
        customer_behaviour: pickRichestString(rows.map((row) => row.customer_behaviour)) || '1'
    };

    const earliestCreated = rows
        .map((row) => parseDate(row.created_at))
        .filter(Boolean)
        .sort((a, b) => a.getTime() - b.getTime())[0] || null;
    const latestUpdated = latestDate(rows, 'updated_at');

    merged.created_at = earliestCreated ? earliestCreated.toISOString() : '';
    merged.updated_at = latestUpdated ? latestUpdated.toISOString() : merged.created_at;

    return {
        merged,
        mergeInfo: {
            phone,
            mergedIds: merged.merged_from_ids,
            keptPrimaryLegacyId: toTrimmedString(primary.id),
            chosenName: buildDisplayName(merged),
            chosenEmail: merged.email,
            chosenRefCode: merged.ref_code,
            verified: merged.is_phone_verified === '1'
        }
    };
}

function normalizeRows(rows) {
    const grouped = new Map();
    const issues = [];
    const mergeLog = [];

    for (const row of rows) {
        const phoneInfo = parsePhoneInfo(row.phone);
        if (!phoneInfo.phone) {
            issues.push({
                type: 'missing_phone',
                legacyId: toTrimmedString(row.id),
                row
            });
            continue;
        }

        const nextRow = {
            ...row,
            phone: phoneInfo.phone,
            countryCode: phoneInfo.countryCode
        };

        if (!grouped.has(phoneInfo.phone)) grouped.set(phoneInfo.phone, []);
        grouped.get(phoneInfo.phone).push(nextRow);
    }

    const normalizedRows = [];
    for (const [phone, groupRows] of grouped.entries()) {
        if (groupRows.length === 1) {
            normalizedRows.push(groupRows[0]);
            continue;
        }

        const { merged, mergeInfo } = mergeDuplicateGroup(groupRows, phone);
        normalizedRows.push(merged);
        mergeLog.push(mergeInfo);
    }

    return { normalizedRows, issues, mergeLog };
}

function buildPreparedUsers(rows) {
    const { normalizedRows, issues, mergeLog } = normalizeRows(rows);
    const legacyIdToObjectId = new Map();
    const prepared = [];

    for (const row of normalizedRows) {
        const allLegacyIds = Array.isArray(row.merged_from_ids)
            ? row.merged_from_ids.map((value) => toTrimmedString(value)).filter(Boolean)
            : [toTrimmedString(row.id)].filter(Boolean);

        const objectId = new mongoose.Types.ObjectId();
        for (const legacyId of allLegacyIds) {
            legacyIdToObjectId.set(legacyId, objectId);
        }

        const createdAt = parseDate(row.created_at) || new Date();
        const updatedAt = parseDate(row.updated_at) || createdAt;
        const name = buildDisplayName(row);
        const email = toTrimmedString(row.email).toLowerCase();
        const walletBalance = Math.max(0, parseNumber(row.wallet_balance, 0));
        const loyaltyPoint = Math.max(0, parseNumber(row.loyalty_point, 0));
        const { isActive, blacklisted } = buildStatusFlags(row);
        const isPhoneVerified = parseBooleanish(row.is_phone_verified, false);
        const isEmailVerified = parseBooleanish(row.is_email_verified, false) || Boolean(parseDate(row.email_verified_at));
        const referredByLegacyId = toTrimmedString(row.ref_by);

        prepared.push({
            legacyId: toTrimmedString(row.id),
            sourceLegacyIds: allLegacyIds,
            objectId,
            phone: row.phone,
            countryCode: toTrimmedString(row.countryCode) || '+91',
            referredByLegacyId,
            doc: {
                _id: objectId,
                phone: row.phone,
                countryCode: toTrimmedString(row.countryCode) || '+91',
                name,
                email,
                profileImage: toTrimmedString(row.image),
                fcmTokens: uniqueStrings([row.cm_firebase_token]),
                fcmTokenMobile: uniqueStrings([row.cm_firebase_token]),
                isVerified: isPhoneVerified || isEmailVerified,
                isActive,
                role: 'USER',
                referralCode: toTrimmedString(row.ref_code),
                referralCount: 0,
                addresses: [],
                createdAt,
                updatedAt
            },
            meta: {
                blacklisted,
                isPhoneVerified,
                isEmailVerified,
                orderCount: Math.max(0, parseNumber(row.order_count, 0)),
                loginMedium: toTrimmedString(row.login_medium) || 'otp',
                socialId: toTrimmedString(row.social_id),
                zoneId: toTrimmedString(row.zone_id),
                walletBalance,
                loyaltyPoint,
                currentLanguageKey: toTrimmedString(row.current_language_key) || 'en',
                customerBehaviour: toTrimmedString(row.customer_behaviour),
                tempToken: toTrimmedString(row.temp_token),
                interest: toTrimmedString(row.interest),
                passwordHashPresent: Boolean(toTrimmedString(row.password)),
                rememberTokenPresent: Boolean(toTrimmedString(row.remember_token))
            }
        });
    }

    for (const item of prepared) {
        const referredId = item.referredByLegacyId;
        if (!referredId) continue;
        item.doc.referredBy = legacyIdToObjectId.get(referredId) || null;
    }

    const referralCounts = new Map();
    for (const item of prepared) {
        const referredBy = item.doc.referredBy ? String(item.doc.referredBy) : '';
        if (!referredBy) continue;
        referralCounts.set(referredBy, (referralCounts.get(referredBy) || 0) + 1);
    }

    for (const item of prepared) {
        item.doc.referralCount = referralCounts.get(String(item.objectId)) || 0;
    }

    return { prepared, issues, mergeLog };
}

function buildWalletDocs(preparedUsers, legacyIdToFinalUserId = new Map()) {
    const walletDocs = [];
    for (const item of preparedUsers) {
        if (!(item.meta.walletBalance > 0)) continue;

        walletDocs.push({
            userId: legacyIdToFinalUserId.get(item.legacyId) || item.objectId,
            balance: Number(item.meta.walletBalance.toFixed(2)),
            referralEarnings: 0,
            transactions: [
                {
                    type: 'addition',
                    amount: Number(item.meta.walletBalance.toFixed(2)),
                    status: 'Completed',
                    description: 'Legacy wallet balance migration',
                    metadata: {
                        source: 'old db/users (1).csv',
                        legacyUserId: item.legacyId,
                        legacySourceIds: item.sourceLegacyIds
                    },
                    createdAt: item.doc.updatedAt,
                    updatedAt: item.doc.updatedAt
                }
            ],
            createdAt: item.doc.createdAt,
            updatedAt: item.doc.updatedAt
        });
    }
    return walletDocs;
}

function buildReport(preparedUsers, issues, mergeLog, args) {
    const unmappedLegacyFields = [
        'password',
        'remember_token',
        'interest',
        'zone_id',
        'order_count',
        'loyalty_point',
        'login_medium',
        'social_id',
        'temp_token',
        'current_language_key',
        'customer_behaviour'
    ];

    const fieldMapping = {
        id: 'report only as legacyId',
        f_name: 'FoodUser.name (combined)',
        l_name: 'FoodUser.name (combined)',
        phone: 'FoodUser.phone + FoodUser.countryCode',
        email: 'FoodUser.email',
        image: 'FoodUser.profileImage',
        is_phone_verified: 'FoodUser.isVerified',
        email_verified_at: 'FoodUser.isVerified support signal only',
        cm_firebase_token: 'FoodUser.fcmTokens[] and FoodUser.fcmTokenMobile[]',
        status: 'FoodUser.isActive (combined with blacklisted)',
        blacklisted: 'FoodUser.isActive inversion rule only',
        ref_code: 'FoodUser.referralCode',
        ref_by: 'FoodUser.referredBy via legacy id lookup',
        wallet_balance: 'FoodUserWallet.balance + opening transaction',
        created_at: 'FoodUser.createdAt',
        updated_at: 'FoodUser.updatedAt'
    };

    return {
        source: path.resolve(args.input),
        applyMode: args.apply,
        processedUsers: preparedUsers.length,
        rawRows: rowsLengthCache,
        walletsToCreate: preparedUsers.filter((item) => item.meta.walletBalance > 0).length,
        referredUsers: preparedUsers.filter((item) => item.referredByLegacyId).length,
        inactiveUsers: preparedUsers.filter((item) => !item.doc.isActive).length,
        verifiedUsers: preparedUsers.filter((item) => item.doc.isVerified).length,
        mergedDuplicatePhones: mergeLog.length,
        fieldMapping,
        unmappedLegacyFields,
        notes: [
            'No legacy address dataset was found for users in old db/. Users will migrate with empty addresses.',
            'Loyalty points currently have no destination in FoodUser or FoodUserWallet.',
            'Legacy password hashes are intentionally not migrated because current auth is OTP-based.',
            'Legacy ref_by values are resolved only within this CSV import set.',
            'When duplicate legacy rows share the same phone, the importer merges richer profile fields with the latest verified/referral data.'
        ],
        mergeLog,
        issues
    };
}

async function applyUsers(preparedUsers) {
    const existingUsers = await FoodUser.find({
        phone: { $in: preparedUsers.map((item) => item.phone) }
    }).select('_id phone').lean();

    const existingByPhone = new Map(existingUsers.map((doc) => [String(doc.phone), doc]));
    const legacyIdToFinalUserId = new Map();
    const referralCountByLegacyId = new Map();

    for (const item of preparedUsers) {
        const existing = existingByPhone.get(item.phone);
        const finalId = existing?._id || item.objectId;
        for (const legacyId of item.sourceLegacyIds) {
            legacyIdToFinalUserId.set(legacyId, finalId);
        }
    }

    for (const item of preparedUsers) {
        if (!item.referredByLegacyId) continue;
        referralCountByLegacyId.set(
            item.referredByLegacyId,
            (referralCountByLegacyId.get(item.referredByLegacyId) || 0) + 1
        );
    }

    const userBulkOps = preparedUsers.map((item) => {
        const finalUserId = legacyIdToFinalUserId.get(item.legacyId) || item.objectId;
        const referredByFinalId = item.referredByLegacyId
            ? legacyIdToFinalUserId.get(item.referredByLegacyId) || null
            : null;

        const doc = {
            phone: item.doc.phone,
            countryCode: item.doc.countryCode,
            name: item.doc.name,
            email: item.doc.email,
            profileImage: item.doc.profileImage,
            fcmTokens: item.doc.fcmTokens,
            fcmTokenMobile: item.doc.fcmTokenMobile,
            isVerified: item.doc.isVerified,
            isActive: item.doc.isActive,
            role: item.doc.role,
            referralCode: item.doc.referralCode,
            referredBy: referredByFinalId,
            referralCount: item.sourceLegacyIds.reduce((sum, legacyId) => sum + (referralCountByLegacyId.get(legacyId) || 0), 0),
            addresses: item.doc.addresses,
            createdAt: item.doc.createdAt,
            updatedAt: item.doc.updatedAt
        };

        return {
            updateOne: {
                filter: { phone: item.phone },
                update: { $set: doc, $setOnInsert: { _id: finalUserId } },
                upsert: true
            }
        };
    });

    if (userBulkOps.length > 0) {
        await FoodUser.collection.bulkWrite(userBulkOps, { ordered: false });
    }

    const walletDocs = buildWalletDocs(preparedUsers, legacyIdToFinalUserId);
    const walletBulkOps = walletDocs.map((wallet) => ({
        updateOne: {
            filter: { userId: wallet.userId },
            update: { $set: wallet },
            upsert: true
        }
    }));

    if (walletBulkOps.length > 0) {
        await FoodUserWallet.collection.bulkWrite(walletBulkOps, { ordered: false });
    }

    return {
        usersUpserted: userBulkOps.length,
        walletsUpserted: walletBulkOps.length
    };
}

let rowsLengthCache = 0;

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return;
    }

    const outputDir = getOutputDir(args.outputDir);
    await ensureDir(outputDir);

    const allRows = readCsvRows(args.input);
    rowsLengthCache = allRows.length;
    const rows = args.limit > 0 ? allRows.slice(0, args.limit) : allRows;
    const { prepared, issues, mergeLog } = buildPreparedUsers(rows);
    const report = buildReport(prepared, issues, mergeLog, args);
    const preview = prepared.slice(0, 20).map((item) => ({
        legacyId: item.legacyId,
        sourceLegacyIds: item.sourceLegacyIds,
        phone: item.phone,
        name: item.doc.name,
        isActive: item.doc.isActive,
        isVerified: item.doc.isVerified,
        referralCode: item.doc.referralCode,
        referredByLegacyId: item.referredByLegacyId,
        walletBalance: item.meta.walletBalance,
        loyaltyPoint: item.meta.loyaltyPoint
    }));

    await writeJson(path.join(outputDir, 'users-report.json'), report);
    await writeJson(path.join(outputDir, 'users-preview.json'), preview);

    let applyResult = null;
    if (args.apply) {
        await connectDB();
        try {
            applyResult = await applyUsers(prepared);
            await writeJson(path.join(outputDir, 'apply-result.json'), applyResult);
        } finally {
            await disconnectDB();
        }
    }

    logger.info(`Processed ${prepared.length} legacy users from ${args.input}`);
    logger.info(`Report written to ${outputDir}`);
    if (mergeLog.length > 0) {
        logger.warn(`Merged ${mergeLog.length} duplicate phone groups during import preparation.`);
    }
    if (issues.length > 0) {
        logger.warn(`Detected ${issues.length} migration issues. Review users-report.json before apply.`);
    }
    if (applyResult) {
        logger.info(`Applied ${applyResult.usersUpserted} users and ${applyResult.walletsUpserted} wallets`);
    }
}

main().catch((error) => {
    logger.error(error?.stack || error?.message || String(error));
    process.exit(1);
});

