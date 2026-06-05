# Account Manager CRUD API Implementation

## Overview
This document describes the implementation of the Account Management CRUD API as requested. All endpoints have been implemented according to the specifications.

## Implemented Features

### 1. Database Models
- **AccountManager** (`models/AccountManager.ts`): Model for account managers with all required fields
- **AccountManagerHistory** (`models/AccountManagerHistory.ts`): Model for tracking account manager activity history

### 2. Database Migrations
- `database/migrations/20250108000001-create-account-managers.js`: Creates the `account_managers` table
- `database/migrations/20250108000002-create-account-manager-history.js`: Creates the `account_manager_history` table

### 3. API Endpoints

All endpoints are under `/api/admin/account-managers` and require admin authentication (super-admin or admin role).

#### 1. GET `/api/admin/account-managers`
- Retrieve all account managers with pagination, search, and filtering
- Query parameters: `page`, `limit`, `search`, `isActive`, `sortBy`, `sortOrder`
- Returns paginated list of account managers

#### 2. GET `/api/admin/account-managers/:accountManagerId`
- Get detailed information about a specific account manager
- Returns 404 if not found

#### 3. POST `/api/admin/account-managers`
- Create a new account manager
- Required fields: `username`, `password`, `firstName`, `lastName`, `email`, `mobile`
- Validates uniqueness of username and email
- Returns 201 with created account manager data

#### 4. PUT `/api/admin/account-managers/:accountManagerId`
- Update account manager information
- Username and password cannot be updated via this endpoint
- Validates email uniqueness if email is changed
- Returns updated account manager data

#### 5. PUT `/api/admin/account-managers/:accountManagerId/password`
- Update account manager password
- Requires `newPassword` in request body (minimum 8 characters)
- Returns success message

#### 6. PATCH `/api/admin/account-managers/:accountManagerId/activate`
- Activate a deactivated account manager
- Sets `isActive` to `true`
- Returns success message with account manager ID

#### 7. PATCH `/api/admin/account-managers/:accountManagerId/deactivate`
- Deactivate an account manager (soft delete)
- Sets `isActive` to `false`
- Returns success message with account manager ID

#### 8. DELETE `/api/admin/account-managers/:accountManagerId`
- Permanently delete an account manager (hard delete)
- Also deletes associated history records (CASCADE)
- Returns success message

#### 9. GET `/api/admin/account-managers/:accountManagerId/history`
- Get activity and login history for an account manager
- Query parameters: `page`, `limit`, `startDate`, `endDate`
- Returns paginated history records

### 4. Validation
- **Validations** (`validations/accountManagerValidations.ts`):
  - `createAccountManagerSchema`: Validates account manager creation
  - `updateAccountManagerSchema`: Validates account manager updates
  - `updatePasswordSchema`: Validates password updates

### 5. Controller
- **Controller** (`controllers/accountManagerController.ts`):
  - All CRUD operations implemented
  - History logging helper function for automatic activity tracking
  - Proper error handling with standardized error responses

### 6. Routes
- **Routes** (`routes/accountManagerRoutes.ts`):
  - All routes defined with Swagger documentation
  - Admin-only authentication middleware
  - Validation middleware applied

### 7. History Logging
- Automatic history logging implemented in the controller
- Helper function `logAccountManagerActivity` logs activities with IP address and user agent
- Activities logged:
  - `account_created`: When account manager is created
  - `profile_update`: When profile is updated
  - `password_change`: When password is changed
  - `account_activated`: When account is activated
  - `account_deactivated`: When account is deactivated

## Database Schema

### account_managers Table
```sql
- id (VARCHAR(255), PRIMARY KEY)
- username (VARCHAR(255), UNIQUE, NOT NULL)
- password (VARCHAR(255), NOT NULL) - bcrypt hashed
- firstName (VARCHAR(255), NOT NULL)
- lastName (VARCHAR(255), NOT NULL)
- email (VARCHAR(255), UNIQUE, NOT NULL)
- mobile (VARCHAR(20), NOT NULL)
- role (VARCHAR(50), DEFAULT 'account-management')
- isActive (BOOLEAN, DEFAULT true)
- emailVerified (BOOLEAN, DEFAULT false)
- loginCount (INTEGER, DEFAULT 0)
- lastLogin (DATE, NULLABLE)
- createdBy (VARCHAR(255), NULLABLE)
- createdAt (TIMESTAMP)
- updatedAt (TIMESTAMP)
```

### account_manager_history Table
```sql
- id (VARCHAR(255), PRIMARY KEY)
- accountManagerId (VARCHAR(255), FOREIGN KEY -> account_managers.id, CASCADE)
- action (VARCHAR(100), NOT NULL)
- details (TEXT, NULLABLE)
- ipAddress (VARCHAR(45), NULLABLE)
- userAgent (TEXT, NULLABLE)
- timestamp (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP)
```

## Response Format

All endpoints follow the standard response format:

**Success Response:**
```json
{
  "success": true,
  "data": { /* response data */ },
  "message": "Optional success message"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": [
      {
        "field": "fieldName",
        "message": "Field-specific error message"
      }
    ]
  }
}
```

## Error Codes

- `AUTH_003`: Invalid or expired token (401)
- `AUTH_004`: Insufficient permissions. Admin access required (403)
- `VAL_001`: Validation error (400)
- `RES_001`: Resource not found (404)
- `RES_002`: Resource already exists (400)
- `SYS_001`: Internal server error (500)

## Authentication & Authorization

- All endpoints require JWT authentication via `Authorization: Bearer <token>` header
- Only users with `super-admin` or `admin` role can access these endpoints
- Unauthorized requests return 401
- Insufficient permissions return 403

## Running Migrations

To create the database tables, run:

```bash
# Using Sequelize CLI
npx sequelize-cli db:migrate

# Or manually run the SQL migrations
psql -U postgres -d chairbord_solar -f database/migrations/20250108000001-create-account-managers.js
psql -U postgres -d chairbord_solar -f database/migrations/20250108000002-create-account-manager-history.js
```

## Testing

The API endpoints can be tested using:
- Swagger UI: `http://localhost:3000/api-docs`
- Postman/Insomnia
- cURL commands

Example cURL for creating an account manager:
```bash
curl -X POST http://localhost:3000/api/admin/account-managers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "username": "accountmgr",
    "password": "securePassword123",
    "firstName": "Arjun",
    "lastName": "Singh",
    "email": "arjun.singh@accountmanagement.com",
    "mobile": "9876543215"
  }'
```

## Frontend Integration

The backend API matches the frontend requirements:

1. **Response Structure**: All endpoints return `{ success, data, message }` format
2. **Field Names**: Uses camelCase (firstName, lastName, isActive, etc.)
3. **Password Updates**: Update endpoint accepts optional password - if provided and not empty, updates password; if empty or omitted, keeps current password
4. **History Format**: History endpoint returns array with all required fields (action, timestamp, details, ipAddress, etc.)
5. **Pagination**: All list endpoints support pagination with standard structure

### Password Update Behavior

The `PUT /api/admin/account-managers/:id` endpoint now supports optional password updates:
- If `password` field is provided and not empty: password is updated
- If `password` field is empty string or omitted: current password is kept
- This matches the frontend behavior where password field can be left blank to keep current password

## Notes

### Login Endpoint
The account managers use a separate table (`account_managers`) from the regular users table (`users`). Currently, there is no dedicated login endpoint for account managers. 

**Option 1:** If account managers should use the existing `/api/auth/login` endpoint, you'll need to modify the authentication controller to:
1. Check the `account_managers` table in addition to the `users` table
2. Log login history when an account manager logs in
3. Update `loginCount` and `lastLogin` fields

**Option 2:** Create a separate login endpoint `/api/auth/account-manager-login` that:
1. Authenticates against the `account_managers` table
2. Logs login history automatically
3. Updates `loginCount` and `lastLogin`

The login endpoint implementation should be added based on your authentication requirements.

### Logout History
Currently, logout events are not automatically logged. If you need logout history:
1. Create a logout endpoint that logs the logout action
2. Or use middleware to detect when a session ends (requires session management)

### Email Verification
The `emailVerified` field is included but email verification functionality is not implemented. This should be added if email verification is required.

## Files Created/Modified

### New Files:
1. `models/AccountManager.ts`
2. `models/AccountManagerHistory.ts`
3. `controllers/accountManagerController.ts`
4. `routes/accountManagerRoutes.ts`
5. `validations/accountManagerValidations.ts`
6. `database/migrations/20250108000001-create-account-managers.js`
7. `database/migrations/20250108000002-create-account-manager-history.js`
8. `ACCOUNT_MANAGER_API_IMPLEMENTATION.md` (this file)

### Modified Files:
1. `models/index.ts` - Added AccountManager and AccountManagerHistory exports and associations
2. `server.ts` - Added account manager routes

## Next Steps

1. **Run migrations** to create the database tables
2. **Test all endpoints** to ensure they work correctly
3. **Implement login endpoint** for account managers (if separate from user login)
4. **Add email verification** functionality if required
5. **Implement logout tracking** if needed
6. **Add rate limiting** for create/update endpoints (optional)
7. **Configure automatic history logging** for view quotations events (if needed)
