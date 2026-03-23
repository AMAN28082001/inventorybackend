import { z } from 'zod';

const roleEnum = z.enum([
  'super-admin',
  'super-admin-manager',
  'admin',
  'agent',
  'account',
  'installer',
  'baldev',
  'confirmation',
  'hr'
]);

export const createUserSchema = z.object({
  username: z.string().min(1, 'Username is required').max(100, 'Username must be less than 100 characters'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  name: z.string().min(1, 'Name is required').max(255, 'Name must be less than 255 characters'),
  role: roleEnum
});

export const updateUserSchema = z.object({
  username: z.string().min(1).max(100).optional(),
  password: z.string().min(6).optional(),
  name: z.string().min(1).max(255).optional(),
  role: roleEnum.optional(),
  is_active: z.boolean().optional()
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update'
});



