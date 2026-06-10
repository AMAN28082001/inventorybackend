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
