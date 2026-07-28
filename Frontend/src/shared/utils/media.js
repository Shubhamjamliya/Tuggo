import { API_BASE_URL } from '../../services/api/config.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const FILE_LIKE_REGEX = /\.(png|jpe?g|webp|gif|bmp|svg|pdf|mp4|webm|mov|avi|mkv|bin)(\?.*)?$/i;
const UPLOADS_SEGMENT_REGEX = /(?:^|\/)(?:api\/v\d+\/)?uploads\//i;

const escapeSvgText = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const getPlaceholderImage = ({ width = 40, height = 40, text = 'Image' } = {}) => {
  const safeWidth = Number.isFinite(Number(width)) ? Number(width) : 40;
  const safeHeight = Number.isFinite(Number(height)) ? Number(height) : 40;
  const safeText = escapeSvgText(text).slice(0, 24) || 'Image';
  const fontSize = Math.max(10, Math.round(Math.min(safeWidth, safeHeight) * 0.24));

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}">
      <rect width="100%" height="100%" fill="#e2e8f0" />
      <text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" fill="#64748b">${safeText}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}`;
};

export const PLACEHOLDER_URL = getPlaceholderImage();

const getBackendOrigin = () => {
  try {
    if (API_BASE_URL && API_BASE_URL.startsWith('http')) {
      return new URL(API_BASE_URL).origin;
    }
  } catch {}

  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return 'http://localhost:5000';
  }

  return '';
};

const isFileLikePath = (value) => {
  const normalized = String(value || '').trim().split('#')[0];
  if (!normalized) return false;
  const pathname = normalized.split('?')[0];
  const fileName = pathname.split('/').filter(Boolean).pop() || '';
  return FILE_LIKE_REGEX.test(fileName);
};

const toUploadsPath = (rawPath) => {
  const trimmed = String(rawPath || '').trim();
  if (!trimmed) return '';

  const [withoutHash] = trimmed.split('#');
  const [pathnamePart, query = ''] = withoutHash.split('?');
  const normalizedPath = pathnamePart.replace(/\\/g, '/');
  const uploadsMatch = normalizedPath.match(UPLOADS_SEGMENT_REGEX);

  if (uploadsMatch) {
    const uploadIndex = uploadsMatch.index + uploadsMatch[0].lastIndexOf('uploads/');
    const uploadPath = `/${normalizedPath.slice(uploadIndex).replace(/^\/+/, '')}`;
    return `${uploadPath}${query ? `?${query}` : ''}`;
  }

  const fileName = normalizedPath.split('/').filter(Boolean).pop();
  if (!fileName || !FILE_LIKE_REGEX.test(fileName)) {
    return '';
  }

  return `/uploads/${fileName}${query ? `?${query}` : ''}`;
};

export const getMediaUrl = (path) => {
  if (!path || typeof path !== 'string') return PLACEHOLDER_URL;

  const trimmed = path.trim();
  if (!trimmed) return PLACEHOLDER_URL;
  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) return trimmed;

  let normalizedUploadsPath = '';

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const url = new URL(trimmed);
      const isLocalHost = LOCAL_HOSTS.has(url.hostname);
      const looksLikeUpload = UPLOADS_SEGMENT_REGEX.test(url.pathname);
      if (!isLocalHost && !looksLikeUpload) {
        return trimmed;
      }
      normalizedUploadsPath = toUploadsPath(`${url.pathname}${url.search}`);
      if (!normalizedUploadsPath) {
        return trimmed;
      }
    } catch {
      return trimmed;
    }
  } else {
    normalizedUploadsPath = toUploadsPath(trimmed);
    if (!normalizedUploadsPath) {
      return trimmed;
    }
  }

  const backendOrigin = getBackendOrigin();
  return backendOrigin ? `${backendOrigin}${normalizedUploadsPath}` : normalizedUploadsPath;
};

