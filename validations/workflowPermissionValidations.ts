import { z } from 'zod';

/** Legacy everyone_except_dealer → everyone (§AK / §AL). */
export const modulePermissionScopeSchema = z.preprocess(
  (val) => (val === 'everyone_except_dealer' ? 'everyone' : val),
  z.enum(['everyone', 'selected_users', 'office_only'])
);

export const modulePermissionRuleSchema = z.object({
  level: z.enum(['none', 'read', 'write']),
  scope: modulePermissionScopeSchema,
  selectedUserIds: z.array(z.string()).optional().default([]),
  selected_user_ids: z.array(z.string()).optional(),
  userIds: z.array(z.string()).optional(),
  user_ids: z.array(z.string()).optional()
});

export const moduleFieldPermissionsSchema = z
  .object({
    accounts: modulePermissionRuleSchema.optional(),
    installation: modulePermissionRuleSchema.optional(),
    metering: modulePermissionRuleSchema.optional(),
    final_confirmation: modulePermissionRuleSchema.optional(),
    finalConfirmation: modulePermissionRuleSchema.optional()
  })
  .optional();

export const workflowPermissionFieldsSchema = {
  officeLocation: z.enum(['Jaipur', 'Ajmer', 'Chomu']).nullable().optional(),
  office_location: z.enum(['Jaipur', 'Ajmer', 'Chomu']).nullable().optional(),
  moduleFieldPermissions: moduleFieldPermissionsSchema,
  modulePermissions: moduleFieldPermissionsSchema,
  module_permissions: moduleFieldPermissionsSchema
};
