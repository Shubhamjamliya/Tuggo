import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import dns from 'node:dns/promises';
import { fileURLToPath } from 'url';
import { FoodCategory } from '../src/modules/food/admin/models/category.model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(backendRoot, '.env') });
dns.setServers(['8.8.8.8', '1.1.1.1']);

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
const uploadDir = path.resolve(backendRoot, process.env.UPLOAD_DIR || process.env.UPLOAD_PATH || 'uploads');
const outputRoot = path.join(path.resolve(backendRoot, '..'), 'migration-output', 'category-image-name-match');
const applyChanges = process.argv.includes('--apply');

const allowedExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg']);
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
const stopWords = new Set(['a', 'an', 'and', 'e', 'the', 'of', 'with', 'for', 'to', 'n']);
const noisyTokens = new Set(['banner', 'logo', 'story', 'offer', 'offers', 'ad', 'thumbnail', 'facebook', 'youtube', 'billboard']);
const manualOverrides = new Map([
  ['Amritsari Naan', 'amritsari_naan_with_chana.jpg'],
  ['Atta , Rice & Dal', 'dal_fry.jpg'],
  ['Bakery', 'blackforest_pastry.jpeg'],
  ['Beverages', 'cold_drink.jpg'],
  ['Biryani', 'veg_biryani.jpg'],
  ['Burger', 'cheese_burger.jpg'],
  ['Burgers', 'cheese_burger.jpg'],
  ['Chaaps', 'special_chaap.jpg'],
  ['Chaat', 'basket_chaat.jpg'],
  ['Chef\'s Special', 'chef_special.jpg'],
  ['Chicken', 'chicken_tikka.jpg'],
  ['Chinese Non veg', 'chilli_chicken.jpeg'],
  ['Dinner', 'indian_course2.jpg'],
  ['Drinks & Juice', 'juice.jpg'],
  ['Festive Sweets', 'sweet_deserts.jpg'],
  ['Fish', 'fish_fried.jpg'],
  ['Fruit Cream', 'fruit-saladcream.jpg'],
  ['Garlic Bread', 'cheese_garlic_bread.jpg'],
  ['Ice Cream', 'vanilla_ice_cream.jpg'],
  ['Indian Course Veg', 'indian_course.jpg'],
  ['Indian Course [Non Veg]', 'indian_course1.jpg'],
  ['Lunch', 'indian_course3.jpg'],
  ['Maggie', 'maggi.jpg'],
  ['Mocktails / Smoothies', 'watermelon_mocktail.jpg'],
  ['Non Veg Tandoori', 'tandoori_chicken.jpg'],
  ['Nibbles Hurry Up', 'the-spice-bazaar-starters.jpg'],
  ['Noodles', 'hakka_noodles.jpg'],
  ['Oriental Starters', 'the-spice-bazaar-starters.jpg'],
  ['Papad', 'masala_papad.jpg'],
  ['Parantha', 'mix_parantha.jpg'],
  ['Pasta', 'mix_pasta.jpg'],
  ['Rice', 'steamed_rice.jpg'],
  ['Roti', 'plain_roti.jpg'],
  ['Sandwich', 'grilled_sandwich.jpg'],
  ['Shaan - E - Basmati', 'steamed_rice1.jpg'],
  ['Sizzlers', 'veg_sizzler.jpg'],
  ['Soup Non-Veg', 'sweet-corn-soup.jpg'],
  ['Sub', 'veg_delight_sub1.jpg'],
  ['Sweets', 'sweet_deserts.jpg'],
  ['Sweets / Desserts', 'sweet_deserts.jpg'],
  ['Tea & Coffee', 'tea.jpg'],
  ['Veg Tandoori Items', 'tandoori-veg-with-spatula.jpg']
]);

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const makeStamp = () => new Date().toISOString().replace(/[:.]/g, '-');

const normalizeText = (value) => String(value || '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[\[\]\(\)'"]/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const compactText = (value) => normalizeText(value).replace(/\s+/g, '');

const singularizeToken = (token) => {
  if (!token) return '';
  if (token.endsWith('ies') && token.length > 3) return `${token.slice(0, -3)}y`;
  if (token.endsWith('es') && token.length > 3) return token.slice(0, -2);
  if (token.endsWith('s') && token.length > 2) return token.slice(0, -1);
  return token;
};

const buildTokenVariants = (value) => {
  const normalized = normalizeText(value);
  const rawTokens = normalized.split(/\s+/).filter(Boolean);
  const filtered = rawTokens.filter((token) => !stopWords.has(token));
  const singular = filtered.map(singularizeToken).filter(Boolean);
  return {
    normalized,
    compact: compactText(value),
    rawTokens,
    filteredTokens: filtered,
    singularTokens: singular
  };
};

const isExternalUrl = (value) => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return false;

  try {
    const url = new URL(trimmed);
    return !localHosts.has(url.hostname);
  } catch {
    return false;
  }
};

const extractFilename = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  let working = trimmed;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const url = new URL(trimmed);
      working = url.pathname || '';
    } catch {
      return '';
    }
  }

  return path.posix.basename(working.split('?')[0].split('#')[0].replace(/\\/g, '/'));
};

const loadUploadFiles = () => {
  if (!fs.existsSync(uploadDir)) {
    throw new Error(`Upload directory not found: ${uploadDir}`);
  }

  return fs.readdirSync(uploadDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('._'))
    .filter((name) => allowedExtensions.has(path.extname(name).toLowerCase()))
    .filter((name) => compactText(path.parse(name).name).length >= 3)
    .map((name) => {
      const stem = path.parse(name).name;
      const tokens = buildTokenVariants(stem);
      return {
        name,
        stem,
        extension: path.extname(name).toLowerCase(),
        ...tokens
      };
    });
};

const fileExistsInUploads = (value) => {
  const filename = extractFilename(value);
  if (!filename) return false;
  return fs.existsSync(path.join(uploadDir, filename));
};

const containsAllTokens = (needles, haystack) => needles.every((token) => haystack.includes(token));

const scoreCandidate = (categoryName, file) => {
  const category = buildTokenVariants(categoryName);
  const categoryTokens = category.singularTokens.length ? category.singularTokens : category.filteredTokens;
  const fileTokens = file.singularTokens.length ? file.singularTokens : file.filteredTokens;

  if (!category.compact || !file.compact) return null;

  let score = 0;

  if (category.compact === file.compact) {
    score = 100;
  } else if (category.normalized === file.normalized) {
    score = 99;
  } else if (categoryTokens.length && containsAllTokens(categoryTokens, fileTokens)) {
    score = 84 - Math.max(0, fileTokens.length - categoryTokens.length) * 3;
    if (file.compact.includes(category.compact) || category.compact.includes(file.compact)) {
      score += 6;
    }
  } else if (categoryTokens.length === 1 && fileTokens.includes(categoryTokens[0])) {
    score = 78 - Math.max(0, fileTokens.length - 1) * 2;
  } else {
    return null;
  }

  if (file.filteredTokens.some((token) => noisyTokens.has(token))) {
    score -= 25;
  }

  if (file.compact.length <= 2) {
    score -= 50;
  }

  return score >= 70 ? score : null;
};

const chooseBestCandidate = (categoryName, uploadFiles) => {
  const manualFile = manualOverrides.get(categoryName);
  if (manualFile) {
    const matchedFile = uploadFiles.find((file) => file.name.toLowerCase() === manualFile.toLowerCase());
    if (matchedFile) {
      return {
        best: { file: matchedFile.name, score: 110, manual: true },
        matches: [{ file: matchedFile.name, score: 110, manual: true }]
      };
    }
  }

  const matches = uploadFiles
    .map((file) => {
      const score = scoreCandidate(categoryName, file);
      return score == null ? null : { file: file.name, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));

  if (!matches.length) return { best: null, matches: [] };

  const [best, second] = matches;
  const isConfident = best.score >= 95 || !second || (best.score >= 80 && best.score - second.score >= 5);
  return { best: isConfident ? best : null, matches: matches.slice(0, 5) };
};

const run = async () => {
  if (!mongoUri) {
    throw new Error('Missing MONGO_URI or MONGODB_URI in environment');
  }

  const uploadFiles = loadUploadFiles();
  const outputDir = path.join(outputRoot, makeStamp());
  ensureDir(outputDir);

  await mongoose.connect(mongoUri, {
    maxPoolSize: 10,
    minPoolSize: 1,
    socketTimeoutMS: 45000,
    serverSelectionTimeoutMS: 45000
  });

  const categories = await FoodCategory.find({}, 'name image').sort({ name: 1 }).lean();
  const report = {
    generatedAt: new Date().toISOString(),
    applyChanges,
    uploadDir,
    uploadFileCount: uploadFiles.length,
    categoriesScanned: categories.length,
    categoriesEligible: 0,
    categoriesMatched: 0,
    categoriesUpdated: 0,
    unmatched: [],
    matched: []
  };

  for (const category of categories) {
    const currentImage = String(category.image || '').trim();
    const isBrokenLocal = currentImage && !isExternalUrl(currentImage) && !fileExistsInUploads(currentImage);
    const isExternal = isExternalUrl(currentImage);
    const isEmpty = !currentImage;

    if (!isBrokenLocal && !isExternal && !isEmpty) {
      continue;
    }

    report.categoriesEligible += 1;

    const { best, matches } = chooseBestCandidate(category.name, uploadFiles);
    if (!best) {
      report.unmatched.push({
        categoryId: String(category._id),
        name: category.name,
        currentImage,
        candidateMatches: matches
      });
      continue;
    }

    const nextImage = `/uploads/${best.file}`;
    report.categoriesMatched += 1;
    report.matched.push({
      categoryId: String(category._id),
      name: category.name,
      from: currentImage,
      to: nextImage,
      score: best.score,
      manual: !!best.manual,
      candidateMatches: matches
    });

    if (applyChanges && currentImage !== nextImage) {
      await FoodCategory.updateOne({ _id: category._id }, { $set: { image: nextImage } });
      report.categoriesUpdated += 1;
    }
  }

  const reportPath = path.join(outputDir, applyChanges ? 'apply-report.json' : 'preview-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({
    success: true,
    applyChanges,
    reportPath,
    categoriesScanned: report.categoriesScanned,
    categoriesEligible: report.categoriesEligible,
    categoriesMatched: report.categoriesMatched,
    categoriesUpdated: report.categoriesUpdated,
    unmatched: report.unmatched.length
  }, null, 2));

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error?.stack || error?.message || String(error));
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
