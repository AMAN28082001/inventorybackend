import { Op } from 'sequelize';
import QuotationInstallationDoc from '../models/QuotationInstallationDoc';
import {
  extractS3KeyOrStoredPath,
  persistableMediaReference,
  resolveBrowsableMediaUrl
} from './s3Service';

/** Normalize inbound URL/key for DB persistence (store object key when possible). */
export const buildPublicWorkflowFileUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('blob:') || trimmed.startsWith('data:')) {
    return null;
  }
  const stored = persistableMediaReference(trimmed);
  if (stored) return stored;
  if (trimmed.startsWith('http://')) {
    return `https://${trimmed.slice('http://'.length)}`;
  }
  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }
  return trimmed;
};

const INSTALLATION_IMAGE_SLOTS = [
  'homeFrontPhoto',
  'homeWithPersonPhoto',
  'inverterWithCustomerPhoto',
  'plantWithCustomerPhoto',
  'inverterSerialNumberPhoto',
  'panelSerialNumberPhoto',
  'geoTagPlantPhoto',
  'otherImages',
  'piUpload',
  'installerPo'
] as const;

const INSTALLATION_PRESIGN_TTL_SECONDS = Math.max(
  3600,
  Number(process.env.AWS_S3_SIGNED_URL_TTL_SECONDS || 604800)
);

const toSnakeCase = (s: string): string =>
  s.replace(/([A-Z])/g, (_, c) => `_${c.toLowerCase()}`).replace(/^_/, '');

const enrichInstallationDoc = async (
  doc: Record<string, unknown>
): Promise<Record<string, unknown> | null> => {
  const stored = doc.fileUrl ?? doc.url ?? doc.file_url;
  const browsable = await resolveBrowsableMediaUrl(stored, INSTALLATION_PRESIGN_TTL_SECONDS);
  if (!browsable) return null;

  const metadata = (doc.metadata || {}) as Record<string, unknown>;
  const slotRaw = metadata.slot ?? metadata.field;
  const field = typeof slotRaw === 'string' && slotRaw.trim() ? slotRaw.trim() : undefined;
  return {
    id: doc.id,
    docType: doc.docType,
    quotationId: doc.quotationId,
    uploadedAt: doc.uploadedAt,
    createdAt: doc.createdAt,
    metadata: doc.metadata,
    url: browsable,
    fileUrl: browsable,
    publicUrl: browsable,
    public_url: browsable,
    mediaReady: true,
    ...(field ? { field } : {})
  };
};

const groupDocsByType = (docs: Record<string, unknown>[]): Record<string, Record<string, unknown>[]> => {
  const grouped: Record<string, Record<string, unknown>[]> = {};
  for (const doc of docs) {
    const key = String(doc.docType || 'other');
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(doc);
  }
  return grouped;
};

export type InstallationDocumentsApiPayload = {
  documents: Record<string, unknown>;
  installationDocuments: Record<string, unknown>;
  installationFieldUrls: Record<string, unknown>;
  /** Flat presigned URLs for admin/installer thumbnails (§6.4.C.8). */
  installationPhotoUrls: string[];
};

/**
 * Maps `quotation_installation_docs` rows to the admin/installer read shape with
 * presigned/public browsable URLs (§6.4.C.8 — avoids private S3 AccessDenied).
 */
export const mapInstallationDocumentsForApi = async (
  rawDocs: unknown[]
): Promise<InstallationDocumentsApiPayload> => {
  const docs = (rawDocs || []).map((d) => {
    const row = d as Record<string, unknown> & { toJSON?: () => Record<string, unknown> };
    return typeof row.toJSON === 'function' ? row.toJSON() : row;
  });

  const enriched = (await Promise.all(docs.map((d) => enrichInstallationDoc(d)))).filter(
    (d): d is Record<string, unknown> => d !== null
  );

  const grouped = groupDocsByType(enriched);
  const siteCompletionImages = grouped.site_completion_image || [];
  const installerPo = grouped.installer_po || [];
  const installerPi = grouped.installer_pi || [];
  const additionalExpense = grouped.additional_expense || [];
  const warrantyDocs = grouped.warranty_doc || [];
  const meterDocs = grouped.meter_doc || [];

  const slotToUrls: Record<string, string[]> = {};
  for (const doc of siteCompletionImages) {
    const metadata = (doc.metadata || {}) as Record<string, unknown>;
    const slotRaw = metadata.slot ?? metadata.field ?? doc.field;
    const slot = typeof slotRaw === 'string' ? slotRaw.trim() : '';
    const url = typeof doc.publicUrl === 'string' ? doc.publicUrl : String(doc.url || '');
    if (!slot || !url) continue;
    if (!slotToUrls[slot]) slotToUrls[slot] = [];
    slotToUrls[slot].push(url);
  }

  const piUploadUrl =
    slotToUrls.piUpload?.[slotToUrls.piUpload.length - 1] ??
    (installerPi.length ? String(installerPi[installerPi.length - 1].publicUrl || installerPi[installerPi.length - 1].url) : null);
  const installerPoUrl =
    slotToUrls.installerPo?.[slotToUrls.installerPo.length - 1] ??
    (installerPo.length ? String(installerPo[installerPo.length - 1].publicUrl || installerPo[installerPo.length - 1].url) : null);

  const installationFieldUrls: Record<string, unknown> = {
    piUploadUrl,
    pi_upload_url: piUploadUrl,
    installerPoUrl,
    installer_po_url: installerPoUrl
  };

  for (const slot of INSTALLATION_IMAGE_SLOTS) {
    const urls = slotToUrls[slot] || [];
    installationFieldUrls[`${slot}Url`] = urls[0] ?? null;
    installationFieldUrls[`${slot}Urls`] = urls;
    installationFieldUrls[`${toSnakeCase(slot)}_url`] = urls[0] ?? null;
    installationFieldUrls[`${toSnakeCase(slot)}_urls`] = urls;
  }

  const existingInstallationImageUrlsJson: Record<string, string[]> = {};
  for (const slot of INSTALLATION_IMAGE_SLOTS) {
    const urls = slotToUrls[slot];
    if (urls?.length) existingInstallationImageUrlsJson[slot] = urls;
  }

  const documents: Record<string, unknown> = {
    site_completion_image: siteCompletionImages,
    siteCompletionImages,
    installer_po: installerPo,
    installerPo,
    installer_pi: installerPi,
    installerPi,
    additional_expense: additionalExpense,
    additionalExpense,
    warranty_doc: warrantyDocs,
    warrantyDocs,
    meter_doc: meterDocs,
    meterDocs,
    piUploadUrl,
    installerPoUrl,
    existingInstallationImageUrlsJson,
    ...installationFieldUrls
  };

  const installationDocuments: Record<string, unknown> = {
    ...grouped,
    siteCompletionImages,
    installerPo,
    installerPi,
    additionalExpense,
    warrantyDocs,
    meterDocs
  };

  const installationPhotoUrls = siteCompletionImages
    .map((doc) => (typeof doc.publicUrl === 'string' ? doc.publicUrl : String(doc.url || '')))
    .filter((u) => u.length > 0);

  return {
    documents,
    installationDocuments,
    installationPhotoUrls,
    installationFieldUrls: {
      ...installationFieldUrls,
      installationPhotoUrls,
      installation_photo_urls: installationPhotoUrls,
      existingInstallationImageUrlsJson,
      existing_installation_image_urls_json: existingInstallationImageUrlsJson
    }
  };
};

export const batchLoadInstallationDocsByQuotationId = async (
  quotationIds: string[]
): Promise<Map<string, Record<string, unknown>[]>> => {
  const map = new Map<string, Record<string, unknown>[]>();
  if (quotationIds.length === 0) return map;

  const rows = await QuotationInstallationDoc.findAll({
    where: { quotationId: { [Op.in]: quotationIds } },
    order: [
      ['uploadedAt', 'ASC'],
      ['createdAt', 'ASC']
    ]
  });

  for (const row of rows) {
    const qid = String(row.quotationId);
    const plain =
      typeof (row as { toJSON?: () => Record<string, unknown> }).toJSON === 'function'
        ? (row as { toJSON: () => Record<string, unknown> }).toJSON()
        : (row as unknown as Record<string, unknown>);
    if (!map.has(qid)) map.set(qid, []);
    map.get(qid)!.push(plain);
  }

  return map;
};

/** Resolve a private S3 URL or object key to a short-lived presigned GET URL (§6.4.C.8). */
export const resolveInstallationMediaViewUrl = async (
  urlOrKey: unknown,
  ttlSeconds: number = INSTALLATION_PRESIGN_TTL_SECONDS
): Promise<string | null> => resolveBrowsableMediaUrl(urlOrKey, ttlSeconds);

export const quotationIdFromInstallationMediaRef = (
  urlOrKey: string,
  quotationId: string
): boolean => {
  const key = extractS3KeyOrStoredPath(urlOrKey);
  if (!key) return false;
  return (
    key.includes(`quotation-workflow/${quotationId}/`) ||
    key.includes(`quotations/${quotationId}/`) ||
    key.startsWith(`quotation-documents/${quotationId}/`)
  );
};
