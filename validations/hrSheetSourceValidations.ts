import { z } from 'zod';

export const discoverHrSheetTabsSchema = z
  .object({
    spreadsheetId: z.string().optional(),
    spreadsheet_id: z.string().optional()
  })
  .passthrough();

export const patchHrSheetSourceSchema = z
  .object({
    enabled: z.union([z.boolean(), z.string(), z.number()]).optional(),
    dealerIds: z.union([z.array(z.string()), z.string()]).optional(),
    dealer_ids: z.union([z.array(z.string()), z.string()]).optional(),
    activeLimitPerDealer: z.union([z.number(), z.string()]).optional(),
    active_limit_per_dealer: z.union([z.number(), z.string()]).optional(),
    displayName: z.string().optional(),
    display_name: z.string().optional()
  })
  .passthrough();

export const hrSheetSourceLeadsQuerySchema = z
  .object({
    page: z.union([z.string(), z.number()]).optional(),
    limit: z.union([z.string(), z.number()]).optional()
  })
  .passthrough();
