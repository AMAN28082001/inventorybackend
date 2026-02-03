import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Request, Response, NextFunction } from 'express';
import { uploadFileToS3, deleteFileFromS3, extractS3Key } from '../utils/s3Service';
import { logInfo, logError } from '../utils/loggerHelper';

// Create uploads directory if it doesn't exist
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter
const fileFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback): void => {
  const allowedTypes = /jpeg|jpg|png|gif|pdf|xlsx|xls|csv/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only image files (jpeg, jpg, png, gif), PDF, and Excel/CSV files are allowed'));
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '5242880', 10) // 5MB default
  },
  fileFilter: fileFilter
});

// Middleware to upload file to S3 after multer processes it
export const uploadToS3 = (folder: string = 'photos') => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const skipFields = new Set(['serial_number_excel']);
      const uploadFile = async (file: Express.Multer.File) => {
        if (skipFields.has(file.fieldname)) {
          return;
        }
        const localFilePath = file.path;

        try {
          const s3FileInfo = await uploadFileToS3(localFilePath, folder);
          (file as any).s3Location = s3FileInfo.filePath;
          (file as any).s3Key = s3FileInfo.key;

          if (process.env.DELETE_LOCAL_AFTER_S3_UPLOAD === 'true') {
            fs.unlinkSync(localFilePath);
            logInfo('🗑️ Deleted local file after S3 upload', { localFilePath });
          }

          logInfo('✅ File uploaded to S3', {
            originalName: file.originalname,
            s3Key: s3FileInfo.key,
            s3Url: s3FileInfo.filePath
          });
        } catch (s3Error) {
          logError('❌ Failed to upload to S3, keeping local file', s3Error, {
            localFilePath,
            originalName: file.originalname
          });
          (file as any).s3Location = `/uploads/${file.filename}`;
        }
      };

      if (req.file) {
        await uploadFile(req.file);
      }

      const files = (req as any).files;
      if (files && typeof files === 'object') {
        const fileArrays = Array.isArray(files) ? files : Object.values(files).flat();
        for (const file of fileArrays) {
          await uploadFile(file as Express.Multer.File);
        }
      }

      next();
    } catch (error) {
      logError('Upload to S3 middleware error', error);
      next(); // Continue even if middleware fails
    }
  };
};

// Middleware to handle file deletion from S3 when updating/deleting records
export const deleteFileFromS3IfExists = async (filePathOrUrl: string | null | undefined): Promise<void> => {
  if (!filePathOrUrl) return;
  
  try {
    // Check if it's an S3 URL
    const s3Key = extractS3Key(filePathOrUrl);
    if (s3Key) {
      await deleteFileFromS3(s3Key);
      logInfo('🗑️ Deleted file from S3', { s3Key });
    } else {
      // It's a local file, check if we should delete it
      const localPath = path.join(process.cwd(), filePathOrUrl);
      if (fs.existsSync(localPath) && process.env.DELETE_LOCAL_AFTER_S3_UPLOAD === 'true') {
        fs.unlinkSync(localPath);
        logInfo('🗑️ Deleted local file', { localPath });
      }
    }
  } catch (error) {
    logError('Failed to delete file', error, { filePathOrUrl });
    // Don't throw - file deletion failure shouldn't break the main operation
  }
};

export default upload;

