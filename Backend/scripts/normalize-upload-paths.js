import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import dns from 'node:dns/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(backendRoot, '.env') });

dns.setServers(['8.8.8.8', '1.1.1.1']);

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
const uploadDir = path.resolve(backendRoot, process.env.UPLOAD_DIR || process.env.UPLOAD_PATH || 'uploads');
const outputRoot = path.join(path.resolve(backendRoot, '..'), 'migration-output', 'upload-path-normalization');
const applyChanges = process.argv.includes('--apply');
const allowMissing = process.argv.includes('--allow-missing');

const supportedExtensions = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.pdf',
  '.mp4', '.webm', '.mov', '.avi', '.mkv', '.bin'
]);

const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
const externalSchemes = ['http://', 'https://'];

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const makeStamp = () => new Date().toISOString().replace(/[:.]/g, '-');

const loadUploadFiles = () => {
  if (!fs.existsSync(uploadDir)) {
    throw new Error(`Upload directory not found: ${uploadDir}`);
  }

  const files = fs.readdirSync(uploadDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  return new Set(files.map((name) => name.toLowerCase()));
};

const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';

const isExternalUrl = (value) => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!externalSchemes.some((prefix) => trimmed.startsWith(prefix))) return false;

  try {
    const url = new URL(trimmed);
    return !localHosts.has(url.hostname);
  } catch {
    return false;
  }
};

const isLikelyLocalMediaPath = (value) => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (isExternalUrl(trimmed)) return false;

  const normalized = trimmed.replace(/\\/g, '/');
  const lower = normalized.toLowerCase();

  if (lower.includes('/uploads/')) return true;
  if (lower.startsWith('uploads/')) return true;
  if (lower.startsWith('/')) return true;
  if (lower.startsWith('./') || lower.startsWith('../')) return true;

  if (externalSchemes.some((prefix) => lower.startsWith(prefix))) {
    try {
      const url = new URL(trimmed);
      return localHosts.has(url.hostname);
    } catch {
      return false;
    }
  }

  const ext = path.posix.extname(lower);
  return supportedExtensions.has(ext);
};

const extractFilename = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || isExternalUrl(trimmed)) return null;

  let working = trimmed;
  if (externalSchemes.some((prefix) => trimmed.startsWith(prefix))) {
    try {
      const url = new URL(trimmed);
      if (!localHosts.has(url.hostname)) return null;
      working = url.pathname || '';
    } catch {
      return null;
    }
  }

  working = working.split('?')[0].split('#')[0].replace(/\\/g, '/');
  const filename = path.posix.basename(working);
  if (!filename || filename === '/' || filename === '.') return null;

  const ext = path.posix.extname(filename).toLowerCase();
  if (!supportedExtensions.has(ext)) return null;

  return filename;
};

const normalizeString = (value, audit) => {
  if (typeof value !== 'string') return { value, changed: false };
  const trimmed = value.trim();
  if (!trimmed || isExternalUrl(trimmed)) return { value, changed: false };

  const filename = extractFilename(trimmed);
  if (!filename) return { value, changed: false };

  if (!isLikelyLocalMediaPath(trimmed)) return { value, changed: false };

  const normalizedPath = `/uploads/${filename}`;
  const exists = audit.uploadFiles.has(filename.toLowerCase());

  if (!exists) {
    audit.missingFiles.add(filename);
    if (!allowMissing) {
      return { value, changed: false, missing: true };
    }
  }

  if (trimmed === normalizedPath) {
    return { value, changed: false };
  }

  return { value: normalizedPath, changed: true, from: value, to: normalizedPath, missing: !exists };
};

const normalizeValue = (input, audit, currentPath = '$') => {
  if (typeof input === 'string') {
    const result = normalizeString(input, audit);
    if (result.changed) {
      audit.changes.push({ path: currentPath, from: result.from, to: result.to, missing: !!result.missing });
    }
    return { value: result.value, changed: result.changed };
  }

  if (Array.isArray(input)) {
    let changed = false;
    const next = input.map((item, index) => {
      const result = normalizeValue(item, audit, `${currentPath}[${index}]`);
      if (result.changed) changed = true;
      return result.value;
    });
    return { value: changed ? next : input, changed };
  }

  if (!isPlainObject(input)) {
    return { value: input, changed: false };
  }

  let changed = false;
  const next = {};
  for (const [key, value] of Object.entries(input)) {
    const result = normalizeValue(value, audit, `${currentPath}.${key}`);
    next[key] = result.value;
    if (result.changed) changed = true;
  }

  return { value: changed ? next : input, changed };
};

const run = async () => {
  if (!mongoUri) {
    throw new Error('Missing MONGO_URI or MONGODB_URI in environment');
  }

  const uploadFiles = loadUploadFiles();
  const stamp = makeStamp();
  const outputDir = path.join(outputRoot, stamp);
  ensureDir(outputDir);

  await mongoose.connect(mongoUri, {
    maxPoolSize: 20,
    minPoolSize: 1,
    socketTimeoutMS: 45000
  });

  const db = mongoose.connection.db;
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const report = {
    generatedAt: new Date().toISOString(),
    applyChanges,
    allowMissing,
    uploadDir,
    uploadFileCount: uploadFiles.size,
    scannedCollections: [],
    totalDocumentsScanned: 0,
    totalDocumentsChanged: 0,
    totalFieldChanges: 0,
    missingFiles: []
  };

  for (const { name } of collections) {
    const collection = db.collection(name);
    const cursor = collection.find({});
    let scanned = 0;
    let changedDocs = 0;
    let fieldChanges = 0;
    const sampleChanges = [];

    for await (const doc of cursor) {
      scanned += 1;
      report.totalDocumentsScanned += 1;

      const audit = { uploadFiles, changes: [], missingFiles: new Set() };
      const result = normalizeValue(doc, audit);

      if (!result.changed) {
        for (const missing of audit.missingFiles) {
          report.missingFiles.push({ collection: name, documentId: String(doc._id), filename: missing });
        }
        continue;
      }

      changedDocs += 1;
      fieldChanges += audit.changes.length;
      report.totalDocumentsChanged += 1;
      report.totalFieldChanges += audit.changes.length;

      for (const missing of audit.missingFiles) {
        report.missingFiles.push({ collection: name, documentId: String(doc._id), filename: missing });
      }

      if (sampleChanges.length < 10) {
        sampleChanges.push({
          documentId: String(doc._id),
          changes: audit.changes.slice(0, 10)
        });
      }

      if (applyChanges) {
        await collection.replaceOne({ _id: doc._id }, result.value);
      }
    }

    report.scannedCollections.push({
      collection: name,
      documentsScanned: scanned,
      documentsChanged: changedDocs,
      fieldChanges,
      sampleChanges
    });
  }

  report.missingFiles = report.missingFiles.sort((a, b) => {
    if (a.collection !== b.collection) return a.collection.localeCompare(b.collection);
    if (a.filename !== b.filename) return a.filename.localeCompare(b.filename);
    return a.documentId.localeCompare(b.documentId);
  });

  const reportPath = path.join(outputDir, applyChanges ? 'apply-report.json' : 'preview-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({
    success: true,
    applyChanges,
    reportPath,
    totalDocumentsScanned: report.totalDocumentsScanned,
    totalDocumentsChanged: report.totalDocumentsChanged,
    totalFieldChanges: report.totalFieldChanges,
    missingFiles: report.missingFiles.length
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
