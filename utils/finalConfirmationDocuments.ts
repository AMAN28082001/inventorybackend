import { resolveBrowsableMediaUrl } from './s3Service';

/** Final confirmation multipart keys (§M / HANDOFF §20). */
export const FINAL_CONFIRMATION_DOCUMENT_FIELDS = [
  'customerFinalBillFile',
  'panelWarrantyFile',
  'inverterWarrantyFile',
  'workCompletionWarrantyFile'
] as const;

export type FinalConfirmationDocumentField = (typeof FINAL_CONFIRMATION_DOCUMENT_FIELDS)[number];

export const isFinalConfirmationDocumentField = (
  field: string
): field is FinalConfirmationDocumentField =>
  (FINAL_CONFIRMATION_DOCUMENT_FIELDS as readonly string[]).includes(field);

export const FINAL_CONFIRMATION_DOCUMENT_URL_KEYS = FINAL_CONFIRMATION_DOCUMENT_FIELDS.map(
  (field) => `${field}Url` as const
);

const toSnakeCase = (field: string): string =>
  field.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);

const fileNameFromUrl = (value: string | null): string | null => {
  if (!value) return null;
  const clean = value.split('?')[0];
  const base = clean.split('/').pop() || null;
  return base || null;
};

const plainDocuments = (
  documents: Record<string, unknown> | null | undefined
): Record<string, unknown> => {
  if (!documents) return {};
  if (typeof (documents as { toJSON?: () => Record<string, unknown> }).toJSON === 'function') {
    return (documents as { toJSON: () => Record<string, unknown> }).toJSON();
  }
  return documents;
};

/**
 * Resolve the four final-confirmation slots to browsable URLs + name aliases
 * for POST response and GET list/detail / Baldev queue (§M preview).
 */
export const buildFinalConfirmationApiFields = async (
  documents: Record<string, unknown> | null | undefined
): Promise<Record<string, string | null>> => {
  const src = plainDocuments(documents);
  const out: Record<string, string | null> = {};

  for (const field of FINAL_CONFIRMATION_DOCUMENT_FIELDS) {
    const raw = src[field];
    let url: string | null = null;
    if (typeof raw === 'string' && raw.trim()) {
      url = (await resolveBrowsableMediaUrl(raw.trim())) || raw.trim();
    }
    const name = fileNameFromUrl(url);
    const snake = toSnakeCase(field);
    out[field] = url;
    out[`${field}Url`] = url;
    out[`${field}Name`] = name;
    out[snake] = url;
    out[`${snake}_url`] = url;
    out[`${snake}_name`] = name;
  }

  return out;
};
