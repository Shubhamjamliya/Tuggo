const FILE_SIZE_LIMIT_RE = /(file size|too large|max(?:imum)?(?: allowed)?(?: file)? size|limit exceeded)/i;
const INVALID_TYPE_RE = /(invalid file type|only .* allowed|unsupported media type|mime|format not supported)/i;

export const DEFAULT_IMAGE_UPLOAD_LIMIT_MB = 5;

export const getImageValidationError = (file, { maxSizeMb = DEFAULT_IMAGE_UPLOAD_LIMIT_MB } = {}) => {
  if (!file) return 'Please select an image file';

  if (!String(file.type || '').startsWith('image/')) {
    return 'Please select a valid image file.';
  }

  if (Number(file.size || 0) > maxSizeMb * 1024 * 1024) {
    return `Image size should be less than ${maxSizeMb}MB.`;
  }

  return '';
};

export const getUploadErrorMessage = (error, { fallback = 'Failed to upload image.', maxSizeMb = DEFAULT_IMAGE_UPLOAD_LIMIT_MB } = {}) => {
  const status = Number(error?.response?.status || 0);
  const candidates = [
    error?.userMessage,
    error?.response?.data?.message,
    error?.response?.data?.error,
    error?.message,
  ].filter(Boolean).map((value) => String(value).trim());

  for (const message of candidates) {
    if (FILE_SIZE_LIMIT_RE.test(message) || message.includes('LIMIT_FILE_SIZE')) {
      return `Image size should be less than ${maxSizeMb}MB.`;
    }
    if (INVALID_TYPE_RE.test(message)) {
      return 'Invalid image format. Please upload JPG, PNG, WEBP, or GIF.';
    }
  }

  if (status === 413) {
    return `Image size should be less than ${maxSizeMb}MB.`;
  }

  if (status === 415) {
    return 'Invalid image format. Please upload JPG, PNG, WEBP, or GIF.';
  }

  if (status >= 500) {
    return 'Upload failed on the server. Please try again.';
  }

  return candidates.length > 0 ? candidates[0] : fallback;
};
