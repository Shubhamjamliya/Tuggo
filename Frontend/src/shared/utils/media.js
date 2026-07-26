import { API_BASE_URL } from '../../services/api/config.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const FILE_LIKE_REGEX = /\.(png|jpe?g|webp|gif|bmp|svg|pdf|mp4|webm|mov|avi|mkv|bin)(\?.*)?$/i;

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

const buildUploadUrl = (rawPath) => {
  const trimmed = String(rawPath || '').trim();
  if (!trimmed) return PLACEHOLDER_URL;

  const withoutHash = trimmed.split('#')[0];
  const [pathnamePart, query = ''] = withoutHash.split('?');
  const normalizedPath = pathnamePart.replace(/\\/g, '/');
  const fileName = normalizedPath.split('/').filter(Boolean).pop();

  if (!fileName || !FILE_LIKE_REGEX.test(fileName)) {
    return trimmed;
  }

  const suffix = query ? `?${query}` : '';
  return `/uploads/${fileName}${suffix}`;
};

export const getMediaUrl = (path) => {
  if (!path || typeof path !== 'string') return PLACEHOLDER_URL;

  const trimmed = path.trim();
  if (!trimmed) return PLACEHOLDER_URL;

  let normalizedPath = trimmed;

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const url = new URL(trimmed);
      if (!LOCAL_HOSTS.has(url.hostname)) {
        return trimmed;
      }
      normalizedPath = buildUploadUrl(`${url.pathname}${url.search}`);
    } catch {
      return trimmed;
    }
  } else if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) {
    return trimmed;
  } else if (trimmed.startsWith('/uploads/')) {
    normalizedPath = trimmed;
  } else if (trimmed.startsWith('uploads/')) {
    normalizedPath = `/${trimmed}`;
  } else if (FILE_LIKE_REGEX.test(trimmed) || trimmed.includes('/admin/food/')) {
    normalizedPath = buildUploadUrl(trimmed);
  } else {
    return trimmed;
  }

  if (!normalizedPath.startsWith('/uploads/')) {
    return normalizedPath;
  }

  const backendOrigin = getBackendOrigin();
  return backendOrigin ? `${backendOrigin}${normalizedPath}` : normalizedPath;
};
