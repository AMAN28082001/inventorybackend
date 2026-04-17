import AWS from 'aws-sdk';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import { logInfo, logError } from '../utils/loggerHelper';

// Configure AWS SDK with credentials from environment variables
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY,
  secretAccessKey: process.env.AWS_SECRET_KEY,
  region: process.env.AWS_REGION || 'ap-south-1',
});

const s3 = new AWS.S3();

const BUCKET_NAME = process.env.AWS_BUCKET_NAME || 'cbpl-bajaj-node';
const AWS_REGION = process.env.AWS_REGION || 'ap-south-1';

const toBool = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true';
};

// Default to signed URLs so private buckets work out-of-the-box.
const shouldUseSignedUrls = toBool(process.env.AWS_S3_USE_SIGNED_URLS, true);
const shouldUsePublicReadAcl = toBool(process.env.AWS_S3_USE_PUBLIC_READ_ACL, false);
const signedUrlTtlSeconds = Number(process.env.AWS_S3_SIGNED_URL_TTL_SECONDS || 604800); // 7 days

export const buildS3ObjectUrl = (key: string): string =>
  `https://${BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${key}`;

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

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileStream = fs.createReadStream(filePath);
    const fileName = path.basename(filePath);
    const fileExtension = path.extname(fileName);
    const contentType = mime.lookup(fileExtension) || 'application/octet-stream';
    const s3Key = `${folder}/${Date.now()}_${fileName}`;

    const uploadParams: AWS.S3.PutObjectRequest = {
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: fileStream,
      ContentType: contentType,
    };
    if (shouldUsePublicReadAcl) {
      uploadParams.ACL = 'public-read';
    }

    const uploadResult = await s3.upload(uploadParams).promise();
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

    const buffer = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer, 'base64');
    const fileExtension = path.extname(filename);
    const contentType = mime.lookup(fileExtension) || 'application/octet-stream';
    const s3Key = `${folder}/${Date.now()}_${filename}`;

    const uploadParams: AWS.S3.PutObjectRequest = {
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: buffer,
      ContentType: contentType,
    };
    if (shouldUsePublicReadAcl) {
      uploadParams.ACL = 'public-read';
    }

    const uploadResult = await s3.upload(uploadParams).promise();

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

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileStream = fs.createReadStream(filePath);
    const fileName = path.basename(filePath);
    const fileExtension = path.extname(fileName);
    const contentType = mime.lookup(fileExtension) || 'application/octet-stream';
    const s3Key = `${folder}/${Date.now()}_${fileName}`;

    const uploadParams: AWS.S3.PutObjectRequest = {
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: fileStream,
      ContentType: contentType,
      ACL: 'public-read',
    };

    const uploadResult = await s3.upload(uploadParams).promise();

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
    const url = s3.getSignedUrl('getObject', {
      Bucket: BUCKET_NAME,
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

    const deleteParams: AWS.S3.DeleteObjectRequest = {
      Bucket: BUCKET_NAME,
      Key: key,
    };

    await s3.deleteObject(deleteParams).promise();

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
  // Check if it's an S3 URL
  if (urlOrPath.includes('amazonaws.com') || urlOrPath.includes('s3.')) {
    // Extract key from URL (format: https://bucket.s3.region.amazonaws.com/key)
    const urlParts = urlOrPath.split('.com/');
    if (urlParts.length > 1) {
      return urlParts[1].split('?')[0]; // Remove query params
    }
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

