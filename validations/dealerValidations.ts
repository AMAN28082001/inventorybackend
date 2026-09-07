import { z } from 'zod';
import { ACCESS_KEYS } from '../utils/userAccess';
import { workflowPermissionFieldsSchema } from './workflowPermissionValidations';

const addressSchema = z.object({
  street: z.string().min(1, 'Street is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  pincode: z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits')
});

// Indian states list for validation
const indianStates = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'
];

export const registerDealerSchema = z.object({
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/^(?=.*[a-zA-Z])(?=.*\d)/, 'Password must contain at least one letter and one number'),
  firstName: z.string().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().min(2, 'Last name must be at least 2 characters'),
  email: z.string().email('Invalid email format'),
  mobile: z.string().regex(/^\d{10}$/, 'Mobile must be 10 digits'),
  gender: z.enum(['Male', 'Female', 'Other']),
  dateOfBirth: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be in YYYY-MM-DD format')
    .refine((date) => {
      const birthDate = new Date(date);
      const today = new Date();
      const age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        return age - 1 >= 18;
      }
      return age >= 18;
    }, 'You must be at least 18 years old'),
  fatherName: z.string().min(2, 'Father name must be at least 2 characters'),
  fatherContact: z.string().regex(/^\d{10}$/, 'Father contact must be 10 digits'),
  governmentIdType: z.enum(['Aadhaar Card', 'PAN Card', 'Voter ID', 'Driving License', 'Passport']),
  governmentIdNumber: z.string().min(1, 'Government ID number is required'),
  governmentIdImage: z.string().optional(),
  address: addressSchema.refine((addr) => {
    if (!addr) return false;
    return indianStates.includes(addr.state);
  }, {
    message: 'State must be a valid Indian state'
  })
});

export const updateDealerSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  mobile: z.string().min(10).max(15).optional(),
  company: z.string().max(255).optional()
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update'
});

// Admin update dealer schema (includes all fields)
export const adminUpdateDealerSchema = z.object({
  firstName: z.string().min(2).max(100).optional(),
  lastName: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  mobile: z.string().regex(/^\d{10}$/, 'Mobile must be 10 digits').optional(),
  gender: z.enum(['Male', 'Female', 'Other']).optional(),
  dateOfBirth: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be in YYYY-MM-DD format')
    .refine((date) => {
      const birthDate = new Date(date);
      const today = new Date();
      const age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        return age - 1 >= 18;
      }
      return age >= 18;
    }, 'You must be at least 18 years old')
    .optional(),
  fatherName: z.string().min(2).optional(),
  fatherContact: z.string().regex(/^\d{10}$/, 'Father contact must be 10 digits').optional(),
  governmentIdType: z.enum(['Aadhaar Card', 'PAN Card', 'Voter ID', 'Driving License', 'Passport']).optional(),
  governmentIdNumber: z.string().optional(),
  governmentIdImage: z.string().optional(),
  address: addressSchema.optional(),
  company: z.string().max(255).optional(),
  isActive: z.boolean().optional(),
  emailVerified: z.boolean().optional(),
  access: z.array(z.enum(ACCESS_KEYS)).min(1).optional(),
  permissions: z.array(z.enum(ACCESS_KEYS)).min(1).optional(),
  ...workflowPermissionFieldsSchema
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update'
});


