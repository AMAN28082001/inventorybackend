# AWS S3 Integration Guide

This document describes the AWS S3 integration for file uploads in the inventory backend.

## Overview

All file uploads (images, PDF) are now automatically uploaded to AWS S3 after being processed by multer. The system maintains backward compatibility with local file storage as a fallback.

## Environment Variables

Add the following variables to your `.env` file:

```env
# AWS S3 Configuration
AWS_ACCESS_KEY=your_access_key_here
AWS_SECRET_KEY=your_secret_key_here
AWS_BUCKET_NAME=cbpl-bajaj-node
AWS_REGION=ap-south-1

# Optional: Delete local files after S3 upload (default: false)
DELETE_LOCAL_AFTER_S3_UPLOAD=false
```

## How It Works

1. **File Upload Flow**:
   - Multer saves file to local disk (`./uploads` directory)
   - `uploadToS3` middleware automatically uploads to S3
   - S3 URL is stored in database instead of local path
   - Local file is optionally deleted (if `DELETE_LOCAL_AFTER_S3_UPLOAD=true`)

2. **File Organization in S3**:
   - Products: `products/` folder
   - Sales: `sales/` folder
   - Stock Requests: `stock-requests/` folder
   - Default: `photos/` folder

3. **File Deletion**:
   - When updating/deleting records, old files are automatically deleted from S3
   - Supports both S3 URLs and local paths

## API Changes

### No Frontend Changes Required!

The API endpoints remain the same. The backend automatically:
- Uploads files to S3
- Returns S3 URLs in responses
- Handles file deletion

### Response Format

Image URLs in API responses will now be S3 URLs instead of local paths:

**Before:**
```json
{
  "image": "/uploads/image-1234567890.jpg"
}
```

**After:**
```json
{
  "image": "https://cbpl-bajaj-node.s3.ap-south-1.amazonaws.com/products/1234567890_image-1234567890.jpg"
}
```

## S3 Service Functions

The `utils/s3Service.ts` provides the following functions:

- `uploadFileToS3(filePath, folder)` - Upload file from disk
- `uploadFileToS3FromBuffer(buffer, filename, folder)` - Upload from memory
- `uploadFileWithPublicAccess(filePath, folder)` - Upload with public read access
- `generatePublicUrl(key, expiresIn)` - Generate signed URL
- `deleteFileFromS3(key)` - Delete file from S3
- `extractS3Key(urlOrPath)` - Extract S3 key from URL
- `isS3Url(urlOrPath)` - Check if URL is S3 URL

## Routes Updated

The following routes now use S3 upload:

1. **Products**:
   - `POST /api/products` - Create product with image
   - `PUT /api/products/:id` - Update product image

2. **Stock Requests**:
   - `POST /api/stock-requests/:id/dispatch` - Dispatch with image
   - `POST /api/stock-requests/:id/confirm` - Confirm with image

3. **Sales**:
   - `POST /api/sales` - Create sale with image
   - `PUT /api/sales/:id` - Update sale image
   - `POST /api/sales/:id/confirm-bill` - Confirm bill with image

## Error Handling

- If S3 upload fails, the system falls back to local file storage
- Errors are logged but don't break the main operation
- Local files are kept if S3 upload fails (unless explicitly configured to delete)

## Security Notes

⚠️ **Important**: Never commit AWS credentials to version control!

1. Add `.env` to `.gitignore`
2. Use environment variables or AWS IAM roles in production
3. Consider using AWS Secrets Manager for production deployments

## Testing

1. Set up AWS credentials in `.env`
2. Upload a file through any endpoint (e.g., create product)
3. Check the response - image URL should be an S3 URL
4. Verify file exists in S3 bucket
5. Update/delete the record - old file should be deleted from S3

## Troubleshooting

### Files not uploading to S3

1. Check AWS credentials in `.env`
2. Verify bucket name and region
3. Check IAM permissions (needs `s3:PutObject`, `s3:DeleteObject`)
4. Check server logs for S3 errors

### Files still using local paths

- S3 upload might have failed - check logs
- System falls back to local storage automatically
- Verify AWS credentials are correct

### Old files not being deleted

- Check if file path is an S3 URL (contains `amazonaws.com`)
- Verify IAM permissions include `s3:DeleteObject`
- Check server logs for deletion errors

## Migration Notes

Existing records with local file paths (`/uploads/...`) will continue to work. When these records are updated with new files, the new files will be uploaded to S3, and the old local files will be handled according to your configuration.

To migrate existing files to S3, you would need to:
1. Read existing file paths from database
2. Upload files to S3 using `uploadFileToS3()`
3. Update database records with S3 URLs

This migration is not included in this implementation but can be added as a separate script if needed.

