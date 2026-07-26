import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_FOOD_INPUT = path.join(REPO_ROOT, 'old db', 'food.csv');
const DEFAULT_RESTAURANTS_INPUT = path.join(REPO_ROOT, 'old db', 'restaurants.csv');
const DEFAULT_CATEGORIES_INPUT = path.join(REPO_ROOT, 'old db', 'categories.csv');
const DEFAULT_VARIATIONS_INPUT = path.join(REPO_ROOT, 'old db', 'variations.csv');
const OUTPUT_ROOT = path.join(REPO_ROOT, 'migration-output', 'old-db-variation-audit');

function parseArgs(argv = []) {
  const args = {
    foodInput: DEFAULT_FOOD_INPUT,
    restaurantsInput: DEFAULT_RESTAURANTS_INPUT,
    categoriesInput: DEFAULT_CATEGORIES_INPUT,
    variationsInput: DEFAULT_VARIATIONS_INPUT,
    outputDir: ''
  };

  for (const rawArg of argv) {
    const arg = String(rawArg || '').trim();
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg.startsWith('--food-input=')) args.foodInput = arg.slice('--food-input='.length).trim();
    if (arg.startsWith('--restaurants-input=')) args.restaurantsInput = arg.slice('--restaurants-input='.length).trim();
    if (arg.startsWith('--categories-input=')) args.categoriesInput = arg.slice('--categories-input='.length).trim();
    if (arg.startsWith('--variations-input=')) args.variationsInput = arg.slice('--variations-input='.length).trim();
    if (arg.startsWith('--output-dir=')) args.outputDir = arg.slice('--output-dir='.length).trim();
  }

  return args;
}

function printHelp() {
  console.log(`
Legacy variation audit

Usage:
  node scripts/audit-old-db-variations.js

Options:
  --food-input=...          Custom legacy food CSV path
  --restaurants-input=...   Custom legacy restaurant CSV path
  --categories-input=...    Custom legacy category CSV path
  --variations-input=...    Custom legacy variations CSV path
  --output-dir=...          Custom report directory
  --help                    Show this help
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

function parseNumber(value, fallback = 0) {
  const raw = toTrimmedString(value);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function parseNullablePositiveNumber(value) {
  const raw = toTrimmedString(value);
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function readCsvRows(filePath) {
  const workbook = XLSX.readFile(filePath, { raw: false, cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
}

function parsePhoneLast10(value) {
  const digits = toDigits(value);
  return digits ? digits.slice(-10) : '';
}

function determineSkipReason(row) {
  const basePrice = parseNumber(row.price, 0);
  const restaurantPrice = parseNullablePositiveNumber(row.restaurant_price);
  if (basePrice > 0) return '';
  if (restaurantPrice && restaurantPrice <= 1) return 'legacy_variant_only_tiny_fallback_price';
  return 'legacy_variant_only_missing_priced_options';
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const foodRows = readCsvRows(args.foodInput);
  const restaurantRows = readCsvRows(args.restaurantsInput);
  const categoryRows = readCsvRows(args.categoriesInput);
  const variationRows = readCsvRows(args.variationsInput);

  const restaurantById = new Map(restaurantRows.map((row) => [
    toTrimmedString(row.id),
    {
      legacyId: toTrimmedString(row.id),
      name: toTrimmedString(row.name),
      phoneLast10: parsePhoneLast10(row.phone),
      key: `${toLowerCollapsed(row.name)}|${parsePhoneLast10(row.phone)}`
    }
  ]));

  const categoryById = new Map(categoryRows.map((row) => [
    toTrimmedString(row.id),
    {
      legacyId: toTrimmedString(row.id),
      name: toTrimmedString(row.name),
      normalizedName: toLowerCollapsed(row.name)
    }
  ]));

  const variationGroupsByFoodId = new Map();
  for (const row of variationRows) {
    const foodId = toTrimmedString(row.food_id);
    if (!foodId) continue;
    if (!variationGroupsByFoodId.has(foodId)) variationGroupsByFoodId.set(foodId, []);
    variationGroupsByFoodId.get(foodId).push({
      id: toTrimmedString(row.id),
      name: toTrimmedString(row.name),
      type: toTrimmedString(row.type),
      min: parseNumber(row.min, 0),
      max: parseNumber(row.max, 0),
      isRequired: parseNumber(row.is_required, 0) === 1
    });
  }

  const skippedFoods = foodRows
    .filter((row) => parseNumber(row.price, 0) <= 0 && variationGroupsByFoodId.has(toTrimmedString(row.id)))
    .map((row) => {
      const foodId = toTrimmedString(row.id);
      const restaurant = restaurantById.get(toTrimmedString(row.restaurant_id)) || null;
      const category = categoryById.get(toTrimmedString(row.category_id)) || null;
      const groups = variationGroupsByFoodId.get(foodId) || [];
      return {
        legacyFoodId: foodId,
        name: toTrimmedString(row.name),
        slug: toTrimmedString(row.slug),
        restaurantLegacyId: toTrimmedString(row.restaurant_id),
        restaurantName: restaurant?.name || '',
        restaurantKey: restaurant?.key || '',
        categoryLegacyId: toTrimmedString(row.category_id),
        categoryName: category?.name || '',
        basePrice: parseNumber(row.price, 0),
        restaurantPrice: parseNullablePositiveNumber(row.restaurant_price),
        reason: determineSkipReason(row),
        variationGroups: groups
      };
    });

  const byRestaurant = Object.values(
    skippedFoods.reduce((acc, item) => {
      const key = item.restaurantKey || `legacy-${item.restaurantLegacyId}`;
      if (!acc[key]) {
        acc[key] = {
          restaurantKey: key,
          restaurantLegacyId: item.restaurantLegacyId,
          restaurantName: item.restaurantName,
          skippedFoods: []
        };
      }
      acc[key].skippedFoods.push(item);
      return acc;
    }, {})
  ).sort((a, b) => b.skippedFoods.length - a.skippedFoods.length);

  const variationPatternCounts = {};
  for (const item of skippedFoods) {
    for (const group of item.variationGroups) {
      const pattern = `${group.name}|${group.type}|${group.min}|${group.max}|${group.isRequired ? 1 : 0}`;
      variationPatternCounts[pattern] = (variationPatternCounts[pattern] || 0) + 1;
    }
  }

  const outputDir = getOutputDir(args.outputDir);
  await ensureDir(outputDir);

  const summary = {
    skippedFoods: skippedFoods.length,
    restaurantsWithSkippedFoods: byRestaurant.length,
    reasonCounts: skippedFoods.reduce((acc, item) => {
      acc[item.reason] = (acc[item.reason] || 0) + 1;
      return acc;
    }, {}),
    topVariationPatterns: Object.entries(variationPatternCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([pattern, count]) => ({ pattern, count })),
    notes: [
      'The old dump contains only variation group headers, not priced option rows.',
      'These foods were skipped during import because importing them as zero-price menu items would be unsafe.',
      'This audit preserves exactly which restaurants and foods need manual reconstruction.'
    ]
  };

  await writeJson(path.join(outputDir, 'variation-audit-summary.json'), summary);
  await writeJson(path.join(outputDir, 'variation-audit-by-restaurant.json'), byRestaurant);
  await writeJson(path.join(outputDir, 'variation-audit-skipped-foods.json'), skippedFoods);

  console.log(`Variation audit written to ${outputDir}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
