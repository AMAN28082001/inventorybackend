import { resolveBrowsableMediaUrl } from './s3Service';

const METER_DOC_PRESIGN_TTL_SECONDS = Math.max(
  3600,
  Number(process.env.AWS_S3_SIGNED_URL_TTL_SECONDS || 604800)
);

export type MeterDocumentApiFields = {
  meterDocumentImageUrl: string | null;
  meterDocumentUrl: string | null;
  meterDocumentPublicUrl: string | null;
  meter_document_image_url: string | null;
  meter_document_url: string | null;
  meter_document_public_url: string | null;
  meterDocumentName: string | null;
  meter_document_name: string | null;
};

export const meterDocumentNameFromStored = (
  storedRef: string | null | undefined,
  fallbackName?: string | null
): string | null => {
  if (typeof fallbackName === 'string' && fallbackName.trim()) {
    return fallbackName.trim();
  }
  if (typeof storedRef !== 'string' || !storedRef.trim()) return null;
  const base = storedRef.split('?')[0].split('/').pop() || '';
  return base || null;
};

/** Presigned/public browsable meter document URLs for API responses (§J / §6.4.C.8). */
export const buildMeterDocumentApiFields = async (
  storedRef: string | null | undefined,
  fallbackName?: string | null
): Promise<MeterDocumentApiFields> => {
  const ref = typeof storedRef === 'string' && storedRef.trim() ? storedRef.trim() : null;
  const browsable = ref
    ? await resolveBrowsableMediaUrl(ref, METER_DOC_PRESIGN_TTL_SECONDS)
    : null;
  const name = meterDocumentNameFromStored(ref, fallbackName);

  return {
    meterDocumentImageUrl: browsable,
    meterDocumentUrl: browsable,
    meterDocumentPublicUrl: browsable,
    meter_document_image_url: browsable,
    meter_document_url: browsable,
    meter_document_public_url: browsable,
    meterDocumentName: name,
    meter_document_name: name
  };
};

export const getLatestMeterDocMeta = (
  docs: Record<string, unknown>[]
): { storedRef: string | null; name: string | null } => {
  const meterDocs = (docs || []).filter((doc) => doc?.docType === 'meter_doc');
  if (meterDocs.length === 0) return { storedRef: null, name: null };

  const sorted = [...meterDocs].sort((a, b) => {
    const ta = new Date(String(a.uploadedAt || a.createdAt || 0)).getTime();
    const tb = new Date(String(b.uploadedAt || b.createdAt || 0)).getTime();
    return tb - ta;
  });

  const latest = sorted[0];
  const metadata = (latest?.metadata || {}) as Record<string, unknown>;
  const originalName =
    (typeof metadata.originalName === 'string' && metadata.originalName.trim()) ||
    (typeof metadata.original_name === 'string' && metadata.original_name.trim()) ||
    null;

  const stored =
    (typeof latest?.fileUrl === 'string' && latest.fileUrl.trim()) ||
    (typeof latest?.file_url === 'string' && latest.file_url.trim()) ||
    null;

  return { storedRef: stored, name: originalName };
};

export const resolveMeterStoredRef = (
  quotationMeterRef: string | null | undefined,
  installationDocs: Record<string, unknown>[]
): string | null => {
  const fromQuotation =
    typeof quotationMeterRef === 'string' && quotationMeterRef.trim()
      ? quotationMeterRef.trim()
      : null;
  if (fromQuotation) return fromQuotation;
  return getLatestMeterDocMeta(installationDocs).storedRef;
};

export const MCO_DOC_FIELDS = [
  'workCompleteReportImage',
  'meterInstalledPhoto',
  'completeDcrReportImage'
] as const;

export type McoDocMeta = {
  workCompleteReportImageUrl: string | null;
  meterInstalledPhotoUrl: string | null;
  completeDcrReportImageUrl: string | null;
  workCompleteReportImageName: string | null;
  meterInstalledPhotoName: string | null;
  completeDcrReportImageName: string | null;
};

/** Latest MCO upload refs from installation docs (stored keys/URLs, not presigned). */
export const getLatestMcoDocMeta = (docs: Record<string, unknown>[]): McoDocMeta => {
  const latestByField: Record<string, Record<string, unknown> | null> = {};
  for (const field of MCO_DOC_FIELDS) {
    const matching = (docs || [])
      .filter((doc) => {
        const metadata = (doc?.metadata || {}) as Record<string, unknown>;
        return metadata.mcoField === field && typeof doc?.fileUrl === 'string';
      })
      .sort((a, b) => {
        const ta = new Date(String(a.uploadedAt || a.createdAt || 0)).getTime();
        const tb = new Date(String(b.uploadedAt || b.createdAt || 0)).getTime();
        return tb - ta;
      });
    latestByField[field] = (matching[0] as Record<string, unknown>) || null;
  }

  const readName = (doc: Record<string, unknown> | null): string | null => {
    const metadata = (doc?.metadata || {}) as Record<string, unknown>;
    return (
      (typeof metadata.originalName === 'string' && metadata.originalName.trim()) ||
      (typeof metadata.original_name === 'string' && metadata.original_name.trim()) ||
      null
    );
  };

  const urlOf = (doc: Record<string, unknown> | null): string | null => {
    const u = doc?.fileUrl ?? doc?.file_url;
    return typeof u === 'string' && u.trim() ? u.trim() : null;
  };

  return {
    workCompleteReportImageUrl: urlOf(latestByField.workCompleteReportImage),
    meterInstalledPhotoUrl: urlOf(latestByField.meterInstalledPhoto),
    completeDcrReportImageUrl: urlOf(latestByField.completeDcrReportImage),
    workCompleteReportImageName: readName(latestByField.workCompleteReportImage),
    meterInstalledPhotoName: readName(latestByField.meterInstalledPhoto),
    completeDcrReportImageName: readName(latestByField.completeDcrReportImage)
  };
};

export type McoDocApiFields = McoDocMeta & {
  work_complete_report_image_url: string | null;
  meter_installed_photo_url: string | null;
  complete_dcr_report_image_url: string | null;
  work_complete_report_image_name: string | null;
  meter_installed_photo_name: string | null;
  complete_dcr_report_image_name: string | null;
};

/** Presigned/public browsable MCO document URLs for list/detail responses. */
export const buildMcoDocApiFields = async (
  docs: Record<string, unknown>[]
): Promise<McoDocApiFields> => {
  const meta = getLatestMcoDocMeta(docs);
  const presign = async (ref: string | null): Promise<string | null> =>
    ref ? await resolveBrowsableMediaUrl(ref, METER_DOC_PRESIGN_TTL_SECONDS) : null;

  const workCompleteReportImageUrl = await presign(meta.workCompleteReportImageUrl);
  const meterInstalledPhotoUrl = await presign(meta.meterInstalledPhotoUrl);
  const completeDcrReportImageUrl = await presign(meta.completeDcrReportImageUrl);

  return {
    workCompleteReportImageUrl,
    meterInstalledPhotoUrl,
    completeDcrReportImageUrl,
    workCompleteReportImageName: meta.workCompleteReportImageName,
    meterInstalledPhotoName: meta.meterInstalledPhotoName,
    completeDcrReportImageName: meta.completeDcrReportImageName,
    work_complete_report_image_url: workCompleteReportImageUrl,
    meter_installed_photo_url: meterInstalledPhotoUrl,
    complete_dcr_report_image_url: completeDcrReportImageUrl,
    work_complete_report_image_name: meta.workCompleteReportImageName,
    meter_installed_photo_name: meta.meterInstalledPhotoName,
    complete_dcr_report_image_name: meta.completeDcrReportImageName
  };
};

export type MeterInstallationPendingPhotoApiFields = {
  meterInstallationPhotoUrl: string | null;
  meterInstallationPhotoPublicUrl: string | null;
  meterInstallationPhotoName: string | null;
  meter_installation_photo_url: string | null;
  meter_installation_photo_public_url: string | null;
  meter_installation_photo_name: string | null;
  plantLivePhotoUrl: string | null;
  plantLivePhotoPublicUrl: string | null;
  plantLivePhotoName: string | null;
  plant_live_photo_url: string | null;
  plant_live_photo_public_url: string | null;
  plant_live_photo_name: string | null;
};

/** Meter Installation Pending photos — browsable public/presigned URLs for GET/POST echo. */
export const buildMeterInstallationPendingPhotoApiFields = async (q: {
  meterInstallationPhotoUrl?: string | null;
  meterInstallationPhotoName?: string | null;
  plantLivePhotoUrl?: string | null;
  plantLivePhotoName?: string | null;
}): Promise<MeterInstallationPendingPhotoApiFields> => {
  const meterRef =
    typeof q.meterInstallationPhotoUrl === 'string' && q.meterInstallationPhotoUrl.trim()
      ? q.meterInstallationPhotoUrl.trim()
      : null;
  const plantRef =
    typeof q.plantLivePhotoUrl === 'string' && q.plantLivePhotoUrl.trim()
      ? q.plantLivePhotoUrl.trim()
      : null;

  const meterUrl = meterRef
    ? await resolveBrowsableMediaUrl(meterRef, METER_DOC_PRESIGN_TTL_SECONDS)
    : null;
  const plantUrl = plantRef
    ? await resolveBrowsableMediaUrl(plantRef, METER_DOC_PRESIGN_TTL_SECONDS)
    : null;

  const meterName =
    (typeof q.meterInstallationPhotoName === 'string' && q.meterInstallationPhotoName.trim()) ||
    meterDocumentNameFromStored(meterRef);
  const plantName =
    (typeof q.plantLivePhotoName === 'string' && q.plantLivePhotoName.trim()) ||
    meterDocumentNameFromStored(plantRef);

  return {
    meterInstallationPhotoUrl: meterUrl,
    meterInstallationPhotoPublicUrl: meterUrl,
    meterInstallationPhotoName: meterName,
    meter_installation_photo_url: meterUrl,
    meter_installation_photo_public_url: meterUrl,
    meter_installation_photo_name: meterName,
    plantLivePhotoUrl: plantUrl,
    plantLivePhotoPublicUrl: plantUrl,
    plantLivePhotoName: plantName,
    plant_live_photo_url: plantUrl,
    plant_live_photo_public_url: plantUrl,
    plant_live_photo_name: plantName
  };
};
