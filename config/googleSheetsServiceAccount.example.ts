/**
 * Copy to `config/googleSheetsServiceAccount.ts` (gitignored) and fill in the SA JSON.
 * Or set `GOOGLE_SERVICE_ACCOUNT_JSON` in `.env`.
 */
export const GOOGLE_SHEETS_SERVICE_ACCOUNT = {
  type: 'service_account',
  project_id: 'YOUR_PROJECT_ID',
  private_key_id: 'YOUR_PRIVATE_KEY_ID',
  private_key: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n',
  client_email: 'your-sa@your-project.iam.gserviceaccount.com',
  client_id: 'YOUR_CLIENT_ID',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  client_x509_cert_url: 'https://www.googleapis.com/robot/v1/metadata/x509/...',
  universe_domain: 'googleapis.com'
} as const;
