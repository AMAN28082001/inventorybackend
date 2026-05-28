/**
 * Shared image MIME / extension rules for multipart uploads (incl. HEIC/HEIF from iOS).
 */

export const HEIC_EXTENSIONS = ['.heic', '.heif'] as const;

export const STANDARD_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
]);

export const isHeicExtension = (filename: string): boolean => {
  const lower = String(filename || '').toLowerCase();
  return HEIC_EXTENSIONS.some((ext) => lower.endsWith(ext));
};

/** True when MIME is allowed or HEIC/HEIF by extension (some clients send application/octet-stream). */
export const isAllowedStandardImageUpload = (file: {
  mimetype: string;
  originalname?: string;
}): boolean => {
  if (STANDARD_IMAGE_MIMES.has(file.mimetype)) return true;
  if (
    (file.mimetype === 'application/octet-stream' || file.mimetype === '') &&
    isHeicExtension(file.originalname || '')
  ) {
    return true;
  }
  return false;
};

export const isAllowedStandardImageOrPdfUpload = (file: {
  mimetype: string;
  originalname?: string;
}): boolean =>
  isAllowedStandardImageUpload(file) || file.mimetype === 'application/pdf';

/** Persist correct Content-Type on S3 for HEIC when the client sends a generic MIME. */
export const resolveImageContentTypeForUpload = (file: {
  mimetype: string;
  originalname?: string;
}): string => {
  if (file.mimetype === 'image/heic' || file.mimetype === 'image/heif') {
    return file.mimetype;
  }
  if (isHeicExtension(file.originalname || '')) {
    return String(file.originalname || '')
      .toLowerCase()
      .endsWith('.heif')
      ? 'image/heif'
      : 'image/heic';
  }
  return file.mimetype;
};

export const standardImageValidationMessage = (fieldName: string): string =>
  `${fieldName} must be jpeg/jpg/png/webp/heic/heif`;

export const standardImageOrPdfValidationMessage = (fieldName: string): string =>
  `${fieldName} must be jpeg/jpg/png/webp/heic/heif/pdf`;
