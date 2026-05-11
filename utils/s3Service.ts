import AWS from 'aws-sdk';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import { logInfo, logError } from '../utils/loggerHelper';
import logger from '../config/logger';

let cachedS3: AWS.S3 | null = null;

type AwsStorageConfig = {
  bucketName: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
};

const createStorageConfigError = (message: string): Error => {
  const err = new Error(message) as Error & { code?: string };
  err.code = 'S3_CONFIG_MISSING';
  return err;
};

export const resolveAwsStorageConfig = (): AwsStorageConfig => {
  const region = String(process.env.AWS_REGION || '').trim();
  const bucketName = String(process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET || '').trim();
  const accessKeyId = process.env.AWS_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY;

  logger.info('AWS Storage Config', { region, bucketName, accessKeyId, secretAccessKey });

  if (!region) {
    throw createStorageConfigError('AWS_REGION is not configured.');
  }
  if (!bucketName) {
    throw createStorageConfigError('AWS bucket is not configured. Set AWS_BUCKET_NAME or AWS_S3_BUCKET.');
  }

  return {
    bucketName,
    region,
    ...(accessKeyId ? { accessKeyId } : {}),
    ...(secretAccessKey ? { secretAccessKey } : {})
  };
};

/** Lazy client so processes that never upload do not need credentials at import time. */
export const getS3Client = (): AWS.S3 => {
  if (!cachedS3) {
    const { accessKeyId, secretAccessKey, region } = resolveAwsStorageConfig();
    if (accessKeyId && secretAccessKey) {
      AWS.config.update({ accessKeyId, secretAccessKey, region });
    } else {
      AWS.config.update({ region });
    }
    cachedS3 = new AWS.S3({ region });
  }
  return cachedS3;
};

/** Undo accidental multiple URI-encoding (e.g. %2520 → space) when recovering keys from URLs. */
const decodeUrlEncodedRepeatedly = (input: string, maxPasses = 4): string => {
  let out = input;
  for (let i = 0; i < maxPasses; i++) {
    try {
      const next = decodeURIComponent(out.replace(/\+/g, ' '));
      if (next === out) break;
      out = next;
    } catch {
      break;
    }
  }
  return out;
};

/**
 * Turn multipart original filenames into safe S3 suffixes so object keys match URLs clients request
 * (avoids literal %20 / double-encoding in keys and broken public links).
 */
export const sanitizeFilenameForS3Key = (originalname: string): string => {
  const rawBase = path.basename(String(originalname || '').trim() || 'upload');
  const base = decodeUrlEncodedRepeatedly(rawBase);
  const ext = path.extname(base).toLowerCase();
  const stem = ext ? base.slice(0, -ext.length) : base;
  const safeStem = stem
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  const safe = `${safeStem || 'file'}${ext}`;
  return safe.slice(0, 200);
};

/** Decode URL path (may be partially encoded) into the canonical S3 object key. */
export const decodeS3UrlPathToKey = (rawPath: string): string | null => {
  const trimmed = rawPath.replace(/^\/+/, '').split('?')[0];
  if (!trimmed) return null;
  const segments = trimmed.split('/').filter(Boolean);
  const decoded = segments.map((seg) => decodeUrlEncodedRepeatedly(seg)).join('/');
  return decoded || null;
};

const toBool = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true';
};

// Default to signed URLs so private buckets work out-of-the-box.
const shouldUseSignedUrls = toBool(process.env.AWS_S3_USE_SIGNED_URLS, true);
const shouldUsePublicReadAcl = toBool(process.env.AWS_S3_USE_PUBLIC_READ_ACL, false);
const signedUrlTtlSeconds = Number(process.env.AWS_S3_SIGNED_URL_TTL_SECONDS || 604800); // 7 days

export const buildS3ObjectUrl = (key: string): string => {
  const { bucketName, region } = resolveAwsStorageConfig();
  const encodedKey = key
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `https://${bucketName}.s3.${region}.amazonaws.com/${encodedKey}`;
};

/**
 * Upload a file from disk to S3
 * @param filePath - Path to the file on disk
 * @param folder - Folder name in S3 (default: 'photos')
 * @returns File info with S3 key and URL
 */
export async function uploadFileToS3(filePath: string, folder: string = 'photos'): Promise<{
  fileName: string;
  fileType: string;
  filePath: string;
  key: string;
}> {
  try {
    logInfo('📤 Initiating S3 upload', { filePath, folder });
    const { bucketName } = resolveAwsStorageConfig();

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileStream = fs.createReadStream(filePath);
    const fileName = sanitizeFilenameForS3Key(path.basename(filePath));
    const fileExtension = path.extname(fileName);
    const contentType = mime.lookup(fileExtension) || 'application/octet-stream';
    const s3Key = `${folder}/${Date.now()}_${fileName}`;

    const uploadParams: AWS.S3.PutObjectRequest = {
      Bucket: bucketName,
      Key: s3Key,
      Body: fileStream,
      ContentType: contentType,
    };
    if (shouldUsePublicReadAcl) {
      uploadParams.ACL = 'public-read';
    }

    const uploadResult = await getS3Client().upload(uploadParams).promise();
    const finalFileUrl = shouldUseSignedUrls
      ? await generatePublicUrl(uploadResult.Key, signedUrlTtlSeconds)
      : uploadResult.Location || buildS3ObjectUrl(uploadResult.Key);

    const fileInfo = {
      fileName: uploadResult.Key.split('/').pop() || fileName,
      fileType: contentType,
      filePath: finalFileUrl,
      key: uploadResult.Key,
    };

    logInfo('✅ S3 Upload Successful', {
      s3Key: fileInfo.key,
      fileName: fileInfo.fileName,
      contentType: fileInfo.fileType,
      location: fileInfo.filePath,
    });

    return fileInfo;
  } catch (error) {
    logError('❌ S3 Upload Failed', error, { filePath, folder });
    throw error;
  }
}

/**
 * Upload a file buffer to S3 (from memory, no disk file)
 * @param fileBuffer - File buffer (can be base64 string or Buffer)
 * @param filename - Original filename
 * @param folder - Folder name in S3 (default: 'photos')
 * @returns S3 key
 */
export async function uploadFileToS3FromBuffer(
  fileBuffer: Buffer | string,
  filename: string,
  folder: string = 'photos'
): Promise<string> {
  try {
    logInfo('📤 Initiating S3 upload from buffer', { filename, folder });
    const { bucketName } = resolveAwsStorageConfig();

    const buffer = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer, 'base64');
    const safeFilename = sanitizeFilenameForS3Key(filename);
    const fileExtension = path.extname(safeFilename);
    const contentType = mime.lookup(fileExtension) || 'application/octet-stream';
    const s3Key = `${folder}/${Date.now()}_${safeFilename}`;

    const uploadParams: AWS.S3.PutObjectRequest = {
      Bucket: bucketName,
      Key: s3Key,
      Body: buffer,
      ContentType: contentType,
    };
    if (shouldUsePublicReadAcl) {
      uploadParams.ACL = 'public-read';
    }

    const uploadResult = await getS3Client().upload(uploadParams).promise();

    logInfo('✅ S3 Upload Successful (from buffer)', {
      s3Key: uploadResult.Key,
      fileName: filename,
      contentType,
      location: uploadResult.Location,
    });

    return uploadResult.Key;
  } catch (error) {
    logError('❌ S3 Upload Failed (from buffer)', error, { filename, folder });
    throw error;
  }
}

/**
 * Upload a file with public read access
 * @param filePath - Path to the file on disk
 * @param folder - Folder name in S3 (default: 'photos')
 * @returns File info with S3 key and URL
 */
export async function uploadFileWithPublicAccess(
  filePath: string,
  folder: string = 'photos'
): Promise<{
  fileName: string;
  fileType: string;
  filePath: string;
  key: string;
}> {
  try {
    logInfo('📤 Initiating S3 upload with public access', { filePath, folder });
    const { bucketName } = resolveAwsStorageConfig();

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileStream = fs.createReadStream(filePath);
    const fileName = sanitizeFilenameForS3Key(path.basename(filePath));
    const fileExtension = path.extname(fileName);
    const contentType = mime.lookup(fileExtension) || 'application/octet-stream';
    const s3Key = `${folder}/${Date.now()}_${fileName}`;

    const uploadParams: AWS.S3.PutObjectRequest = {
      Bucket: bucketName,
      Key: s3Key,
      Body: fileStream,
      ContentType: contentType,
      ACL: 'public-read',
    };

    const uploadResult = await getS3Client().upload(uploadParams).promise();

    const fileInfo = {
      fileName: uploadResult.Key.split('/').pop() || fileName,
      fileType: contentType,
      filePath: uploadResult.Location,
      key: uploadResult.Key,
    };

    logInfo('✅ S3 Upload Successful (public)', {
      s3Key: fileInfo.key,
      fileName: fileInfo.fileName,
      contentType: fileInfo.fileType,
      location: fileInfo.filePath,
    });

    return fileInfo;
  } catch (error) {
    logError('❌ S3 Upload Failed (public)', error, { filePath, folder });
    throw error;
  }
}

/**
 * Generate a signed URL for a file in S3 (temporary access)
 * @param key - S3 key of the file
 * @param expiresIn - Expiration time in seconds (default: 3600 = 1 hour)
 * @returns Signed URL
 */
export async function generatePublicUrl(key: string, expiresIn: number = 3600): Promise<string> {
  try {
    const { bucketName } = resolveAwsStorageConfig();
    const url = getS3Client().getSignedUrl('getObject', {
      Bucket: bucketName,
      Key: key,
      Expires: expiresIn,
    });

    logInfo('🔗 Generated S3 signed URL', {
      s3Key: key,
      expiresIn: `${expiresIn}s`,
    });

    return url;
  } catch (error) {
    logError('❌ Failed to generate S3 signed URL', error, { key });
    throw error;
  }
}

/**
 * Delete a file from S3
 * @param key - S3 key of the file to delete
 */
export async function deleteFileFromS3(key: string): Promise<void> {
  try {
    logInfo('🗑️ Initiating S3 file deletion', { key });
    const { bucketName } = resolveAwsStorageConfig();

    const deleteParams: AWS.S3.DeleteObjectRequest = {
      Bucket: bucketName,
      Key: key,
    };

    await getS3Client().deleteObject(deleteParams).promise();

    logInfo('✅ S3 File Deleted', { s3Key: key });
  } catch (error) {
    logError('❌ Failed to delete S3 file', error, { key });
    throw error;
  }
}

/**
 * Extract S3 key from a URL or path
 * @param urlOrPath - S3 URL or local path
 * @returns S3 key if it's an S3 URL, null otherwise
 */
export function extractS3Key(urlOrPath: string): string | null {
  const trimmed = String(urlOrPath || '').trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      const isS3Host = parsed.hostname.includes('amazonaws.com') || parsed.hostname.startsWith('s3.');
      if (isS3Host) {
        return decodeS3UrlPathToKey(parsed.pathname);
      }
      return null;
    } catch {
      // Non-standard URL string; fall back below
    }
    if (trimmed.includes('amazonaws.com') || trimmed.includes('s3.')) {
      const urlParts = trimmed.split('.com/');
      if (urlParts.length > 1) {
        return decodeS3UrlPathToKey(urlParts[1]);
      }
    }
    return null;
  }

  return null;
}

/**
 * Check if a URL/path is an S3 URL
 * @param urlOrPath - URL or path to check
 * @returns true if it's an S3 URL
 */
export function isS3Url(urlOrPath: string): boolean {
  return urlOrPath.includes('amazonaws.com') || urlOrPath.includes('s3.');
}

