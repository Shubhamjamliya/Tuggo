import fs from 'fs';
import path from 'path';
import multer from 'multer';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/env.js';

// Ensure the single upload directory exists.
const baseUploadDir = config.uploadPath || path.join(process.cwd(), 'uploads');
if (!fs.existsSync(baseUploadDir)) {
    fs.mkdirSync(baseUploadDir, { recursive: true });
}

const ensureUploadDirExists = () => {
    if (!fs.existsSync(baseUploadDir)) {
        fs.mkdirSync(baseUploadDir, { recursive: true });
    }
    return baseUploadDir;
};

const uploadIndexCache = {
    expiresAt: 0,
    files: new Map()
};

const UPLOAD_INDEX_TTL_MS = 30 * 1000;
const supportedUploadExtensions = ['.webp', '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.pdf', '.mp4', '.webm', '.mov', '.avi', '.mkv', '.bin'];

const getUploadFilesIndex = () => {
    const now = Date.now();
    if (uploadIndexCache.expiresAt > now && uploadIndexCache.files.size > 0) {
        return uploadIndexCache.files;
    }

    const dir = ensureUploadDirExists();
    const nextFiles = new Map();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        nextFiles.set(entry.name.toLowerCase(), entry.name);
    }

    uploadIndexCache.files = nextFiles;
    uploadIndexCache.expiresAt = now + UPLOAD_INDEX_TTL_MS;
    return uploadIndexCache.files;
};

const normalizeUploadToken = (value, fallback = 'upload') => {
    const normalized = String(value || fallback)
        .trim()
        .replace(/[\\/]+/g, '-')
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();

    return normalized || fallback;
};

const buildFlatUploadFilename = ({ prefix = 'file', extension = '' }) => {
    const normalizedPrefix = normalizeUploadToken(prefix, 'file');
    const normalizedExtension = extension
        ? `.${String(extension).replace(/^\.+/, '').toLowerCase()}`
        : '';

    return `${normalizedPrefix}_${uuidv4().replace(/-/g, '').substring(0, 10)}${normalizedExtension}`;
};

// Multer memory storage
const storage = multer.memoryStorage();

// File filter (from SOP: jpeg, png, webp, gif)
const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.'), false);
    }
};

// Multer middleware: max 5MB (from SOP) for specific image endpoints
export const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter
});

/**
 * Processes and saves an image buffer to the single upload directory.
 * Returns the relative public path (e.g., '/uploads/food_123.webp')
 */
const processAndSaveImage = async ({ buffer, prefix, width, height, quality = 80 }) => {
    const dir = ensureUploadDirExists();
    const filename = buildFlatUploadFilename({ prefix, extension: 'webp' });
    const filepath = path.join(dir, filename);

    let sharpInstance = sharp(buffer);

    if (width || height) {
        sharpInstance = sharpInstance.resize({
            width,
            height,
            fit: 'inside',
            withoutEnlargement: true
        });
    }

    await sharpInstance
        .webp({ quality })
        .toFile(filepath);

    return `/uploads/${filename}`;
};

/**
 * Exported specific processing functions as per SOP
 */

export const uploadFoodImage = async (buffer) => {
    return processAndSaveImage({
        buffer,
        folder: 'foods',
        prefix: 'food',
        width: 800,
        height: 800,
        quality: 85
    });
};

export const uploadRestaurantImage = async (buffer) => {
    return processAndSaveImage({
        buffer,
        folder: 'restaurants',
        prefix: 'restaurant',
        width: 1200,
        height: 800,
        quality: 85
    });
};

export const uploadBannerImage = async (buffer) => {
    return processAndSaveImage({
        buffer,
        folder: 'banners',
        prefix: 'banner',
        width: 1600,
        height: 600,
        quality: 85
    });
};

export const uploadProfileImage = async (buffer) => {
    return processAndSaveImage({
        buffer,
        folder: 'users',
        prefix: 'user',
        width: 400,
        height: 400,
        quality: 85
    });
};

export const uploadDeliveryImage = async (buffer) => {
    return processAndSaveImage({
        buffer,
        folder: 'delivery',
        prefix: 'delivery',
        width: 800,
        height: 800,
        quality: 85
    });
};

export const uploadGenericImage = async (buffer, _folder = 'misc') => {
    return processAndSaveImage({
        buffer,
        prefix: 'img',
        quality: 85
    });
};

export const uploadFileBuffer = async (buffer, _folder = 'misc', options = {}) => {
    const dir = ensureUploadDirExists();
    const prefix = normalizeUploadToken(options.fileName ? options.fileName.split('.')[0] : 'file', 'file');
    const filename = buildFlatUploadFilename({
        prefix,
        extension: options.format || 'bin'
    });
    const filepath = path.join(dir, filename);

    fs.writeFileSync(filepath, buffer);
    return `/uploads/${filename}`;
};

export const uploadVideoBuffer = async (buffer, _folder = 'videos', options = {}) => {
    const dir = ensureUploadDirExists();
    const filename = buildFlatUploadFilename({
        prefix: 'video',
        extension: options.format ? normalizeUploadToken(options.format, 'mp4') : 'mp4'
    });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);
    return `/uploads/${filename}`;
};

export const buildRawDownloadUrlFromFileUrl = (fileUrl, options = {}) => {
    return fileUrl;
};

export const normalizeStoredUploadPath = (value) => {
    if (value === null || value === undefined) return '';

    const trimmed = String(value).trim();
    if (!trimmed) return '';

    const externalSchemes = ['http://', 'https://'];
    const localHosts = new Set(['localhost', '127.0.0.1', '::1']);

    if (externalSchemes.some((prefix) => trimmed.startsWith(prefix))) {
        try {
            const url = new URL(trimmed);
            if (!localHosts.has(url.hostname)) {
                return trimmed;
            }
            const localPath = url.pathname || '';
            return normalizeStoredUploadPath(localPath);
        } catch {
            return trimmed;
        }
    }

    const normalized = trimmed
        .split('?')[0]
        .split('#')[0]
        .replace(/\\/g, '/');

    const filename = path.posix.basename(normalized);
    if (!filename || filename === '.' || filename === '/') return '';

    return `/uploads/${filename}`;
};

export const resolveStoredUploadPath = (value) => {
    const normalized = normalizeStoredUploadPath(value);
    if (!normalized) return '';
    if (/^https?:\/\//i.test(String(value || '').trim())) return String(value).trim();

    const filename = path.posix.basename(normalized);
    if (!filename) return normalized;

    const uploadFiles = getUploadFilesIndex();
    const parsed = path.posix.parse(filename);
    const stem = parsed.name.toLowerCase();
    if (!stem) return normalized;

    const webpCandidate = uploadFiles.get(`${stem}.webp`);
    if (webpCandidate) {
        return `/uploads/${webpCandidate}`;
    }

    const exact = uploadFiles.get(filename.toLowerCase());
    if (exact) {
        return `/uploads/${exact}`;
    }

    for (const ext of supportedUploadExtensions) {
        const candidate = uploadFiles.get(`${stem}${ext}`);
        if (candidate) {
            return `/uploads/${candidate}`;
        }
    }

    const prefixMatches = Array.from(uploadFiles.entries())
        .filter(([lowerName]) => {
            const parsedName = path.posix.parse(lowerName);
            return parsedName.name === stem || parsedName.name.startsWith(`${stem}_`);
        })
        .map(([, actualName]) => actualName)
        .sort((a, b) => {
            const aExt = path.posix.extname(a).toLowerCase();
            const bExt = path.posix.extname(b).toLowerCase();
            const aRank = supportedUploadExtensions.indexOf(aExt);
            const bRank = supportedUploadExtensions.indexOf(bExt);
            if (aRank !== bRank) return aRank - bRank;
            return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        });

    if (prefixMatches.length > 0) {
        return `/uploads/${prefixMatches[0]}`;
    }

    return normalized;
};

// --- Generic Production-Ready File Upload System ---

const genericStorage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, ensureUploadDirExists());
    },
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || '';
        const name = normalizeUploadToken(path.basename(file.originalname, ext), file.mimetype.split('/')[0] || 'file');
        const normalizedExt = ext ? ext.replace(/^\.+/, '').toLowerCase() : '';
        cb(null, buildFlatUploadFilename({ prefix: name, extension: normalizedExt }));
    }
});

const genericFileFilter = (req, file, cb) => {
    const allowed = [
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'video/mp4', 'video/webm',
        'application/pdf'
    ];
    if (allowed.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`Invalid file type: ${file.mimetype}. Only images, videos, and PDFs are supported.`), false);
    }
};

export const genericUpload = multer({
    storage: genericStorage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
    fileFilter: genericFileFilter
});

