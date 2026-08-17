import { z } from 'zod';
import { ACCESS_KEYS } from '../utils/userAccess';

const accessArraySchema = z
  .array(z.enum(ACCESS_KEYS))
  .min(1, 'Select at least one dashboard access')
  .optional();

const optionalProfileFields = {
  gender: z.enum(['Male', 'Female', 'Other']).optional(),
  dateOfBirth: z.string().optional(),
  fatherName: z.string().optional(),
  fatherContact: z.string().optional(),
  governmentIdType: z.string().optional(),
  governmentIdNumber: z.string().optional(),
  employeeId: z.string().optional().nullable(),
  address: z
    .object({
      street: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      pincode: z.string().optional()
    })
    .optional()
};

const opsRoleEnum = z.enum([
  'account-management',
  'installer',
  'baldev',
  'hr',
  'metering',
  'admin',
  'confirmation'
]);

export const createAccountManagerSchema = z.object({
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be at most 50 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters'),
  firstName: z.string()
    .min(1, 'First name is required')
    .max(100, 'First name must be at most 100 characters'),
  lastName: z.string()
    .min(1, 'Last name is required')
    .max(100, 'Last name must be at most 100 characters'),
  email: z.string()
    .email('Invalid email format'),
  mobile: z.string()
    .regex(/^\d{10}$/, 'Mobile must be exactly 10 digits'),
  role: opsRoleEnum.optional(),
  access: accessArraySchema,
  permissions: accessArraySchema,
  ...optionalProfileFields
}).refine((data) => data.role || (data.access && data.access.length) || (data.permissions && data.permissions.length), {
  message: 'role or access is required'
});

export const updateAccountManagerSchema = z.object({
  firstName: z.string()
    .min(1)
    .max(100)
    .optional(),
  lastName: z.string()
    .min(1)
    .max(100)
    .optional(),
  email: z.string()
    .email('Invalid email format')
    .optional(),
  mobile: z.string()
    .regex(/^\d{10}$/, 'Mobile must be exactly 10 digits')
    .optional(),
  password: z.union([
    z.string().min(8, 'Password must be at least 8 characters'),
    z.literal('') // Allow empty string (frontend sends empty to keep current)
  ]).optional(),
  role: opsRoleEnum.optional(),
  access: accessArraySchema,
  permissions: accessArraySchema,
  isActive: z.boolean().optional(),
  emailVerified: z.boolean().optional(),
  ...optionalProfileFields
}).refine((data) => {
  // Filter out password if it's empty string - don't count it as a field
  const fieldsWithoutEmptyPassword = { ...data };
  if (fieldsWithoutEmptyPassword.password === '') {
    delete fieldsWithoutEmptyPassword.password;
  }
  return Object.keys(fieldsWithoutEmptyPassword).length > 0;
}, {
  message: 'At least one field must be provided for update'
});

export const updatePasswordSchema = z.object({
  newPassword: z.string()
    .min(8, 'Password must be at least 8 characters')
});
