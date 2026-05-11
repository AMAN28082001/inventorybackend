/** Shown when AWS auth/setup fails (no raw SDK strings). */
export const SYS_STORAGE_CREDENTIALS_MESSAGE =
  'Server misconfiguration: AWS credentials are missing (image/storage). Configure AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION on the API server (or use an IAM role). If you use ~/.aws/config only, set AWS_SDK_LOAD_CONFIG=1.';

/** Extra guidance when uploads are optional (e.g. products without an image). */
export const SYS_STORAGE_OPTIONAL_NO_IMAGE_HINT =
  'Optional: save without an image—the API skips S3 when no file is uploaded.';

/**
 * Turn AWS SDK / network failures into a safe API error (no raw SDK strings to clients).
 */
export function toStorageUnavailableError(error: unknown): Error {
  const e = error as Record<string, unknown> & { code?: string; name?: string; message?: string };
  const awsCode = String(e?.code ?? e?.name ?? '');
  const msg = String(e?.message ?? error ?? '');
  const looksLikeConfigMissing =
    awsCode === 'S3_CONFIG_MISSING' ||
    msg.includes('AWS bucket is not configured') ||
    msg.includes('AWS_REGION is not configured');

  const looksLikeCredentials =
    awsCode === 'CredentialsError' ||
    awsCode === 'ExpiredTokenException' ||
    awsCode === 'ExpiredToken' ||
    awsCode === 'InvalidClientTokenId' ||
    awsCode === 'SignatureDoesNotMatch' ||
    awsCode === 'InvalidAccessKeyId' ||
    awsCode === 'AuthFailure' ||
    msg.includes('Missing credentials') ||
    msg.includes('Could not load credentials') ||
    msg.includes('Could not resolve credentials') ||
    msg.includes('Credential');

  const looksLikeNetwork =
    awsCode === 'NetworkingError' ||
    awsCode === 'TimeoutError' ||
    awsCode === 'ECONNRESET' ||
    awsCode === 'ENOTFOUND' ||
    msg.includes('ENOTFOUND') ||
    msg.includes('ECONNRESET');

  let clientMessage = 'File storage is not configured or unavailable.';
  let responseCode: 'SYS_STORAGE' | 'S3_CONFIG_MISSING' = 'SYS_STORAGE';
  if (looksLikeConfigMissing) {
    clientMessage = 'Storage is not configured on the server.';
    responseCode = 'S3_CONFIG_MISSING';
  } else if (looksLikeCredentials) {
    clientMessage = SYS_STORAGE_CREDENTIALS_MESSAGE;
  } else if (looksLikeNetwork && !looksLikeCredentials) {
    clientMessage = 'File storage is temporarily unavailable.';
  }

  const err = new Error(clientMessage);
  (err as { status?: number }).status = 503;
  (err as { code?: string }).code = responseCode;
  (err as { storageHint?: string }).storageHint = SYS_STORAGE_OPTIONAL_NO_IMAGE_HINT;
  return err;
}
