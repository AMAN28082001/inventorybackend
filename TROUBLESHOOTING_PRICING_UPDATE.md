# Troubleshooting: "Failed to update pricing information" Error

## Issue
Frontend error: `Failed to update pricing information` at `components/quotation-details-dialog.tsx:2480:39`

## Common Causes & Solutions

### 1. Validation Error - Empty Request Body
**Problem**: The API requires at least one pricing field to be provided.

**Solution**: Ensure you're sending at least one field:
```typescript
// ❌ BAD - Empty object
await api.quotations.updatePricing(quotationId, {});

// ✅ GOOD - At least one field
await api.quotations.updatePricing(quotationId, {
  discount: 10
});
```

### 2. Invalid Data Types
**Problem**: Sending strings instead of numbers (except discount can be string).

**Solution**: Convert all values to numbers:
```typescript
// ❌ BAD - String values
{
  subtotal: "300000",
  discount: "10"
}

// ✅ GOOD - Number values
{
  subtotal: 300000,
  discount: 10  // or "10" is also OK for discount
}
```

### 3. Undefined/Null Values
**Problem**: Sending undefined or null values in the request.

**Solution**: Filter out undefined/null values:
```typescript
const pricingData: any = {};

if (subtotal !== undefined && subtotal !== null) {
  pricingData.subtotal = Number(subtotal);
}
if (discount !== undefined && discount !== null) {
  pricingData.discount = Number(discount);
}
// ... etc

// Only send if at least one field exists
if (Object.keys(pricingData).length > 0) {
  await api.quotations.updatePricing(quotationId, pricingData);
}
```

### 4. Network/API Error
**Problem**: The API call is failing due to network issues or server errors.

**Solution**: Add proper error handling:
```typescript
try {
  const response = await api.quotations.updatePricing(quotationId, pricingData);
  
  if (!response || !response.success) {
    // Check for error details
    const errorMsg = response?.error?.message || "Unknown error";
    const errorDetails = response?.error?.details || [];
    
    console.error("API Error:", errorMsg, errorDetails);
    throw new Error(errorMsg);
  }
  
  // Success handling...
} catch (error: any) {
  // Check if it's an HTTP error
  if (error.response) {
    console.error("HTTP Error:", error.response.status, error.response.data);
  } else if (error.request) {
    console.error("Network Error:", error.request);
  } else {
    console.error("Error:", error.message);
  }
  throw error;
}
```

### 5. Response Structure Mismatch
**Problem**: The response structure doesn't match what the frontend expects.

**Solution**: Check the actual response structure:
```typescript
const response = await api.quotations.updatePricing(quotationId, pricingData);

console.log("Full response:", JSON.stringify(response, null, 2));

// Expected structure:
// {
//   success: true,
//   data: {
//     id: "...",
//     pricing: { ... },
//     discount: ...,
//     subtotal: ...,
//     totalAmount: ...,
//     finalAmount: ...,
//     updatedAt: "..."
//   }
// }
```

## Debugging Steps

1. **Check Browser Console**
   - Look for the actual error message
   - Check network tab for the request/response

2. **Verify Request Payload**
   ```typescript
   console.log("Request payload:", JSON.stringify(pricingData, null, 2));
   ```

3. **Check API Response**
   ```typescript
   console.log("API Response:", response);
   console.log("Response success:", response?.success);
   console.log("Response error:", response?.error);
   ```

4. **Validate Data Before Sending**
   ```typescript
   // Ensure all numbers are valid
   const validatePricingData = (data: any) => {
     const validated: any = {};
     
     if (data.subtotal !== undefined) {
       const val = Number(data.subtotal);
       if (isNaN(val) || val < 0) {
         throw new Error("Invalid subtotal value");
       }
       validated.subtotal = val;
     }
     
     if (data.discount !== undefined) {
       const val = Number(data.discount);
       if (isNaN(val) || val < 0 || val > 100) {
         throw new Error("Invalid discount value (must be 0-100)");
       }
       validated.discount = val;
     }
     
     // ... validate other fields
     
     if (Object.keys(validated).length === 0) {
       throw new Error("At least one pricing field must be provided");
     }
     
     return validated;
   };
   
   const validatedData = validatePricingData(pricingData);
   await api.quotations.updatePricing(quotationId, validatedData);
   ```

## Quick Fix Template

Replace your current `handleSavePricing` function with this improved version:

```typescript
const handleSavePricing = async () => {
  try {
    // Build pricing data object, filtering out undefined/null values
    const pricingData: any = {};
    
    if (updatedQuotation.subtotal !== undefined && updatedQuotation.subtotal !== null) {
      pricingData.subtotal = Number(updatedQuotation.subtotal);
    }
    if (updatedQuotation.products?.stateSubsidy !== undefined && updatedQuotation.products?.stateSubsidy !== null) {
      pricingData.stateSubsidy = Number(updatedQuotation.products.stateSubsidy);
    }
    if (updatedQuotation.products?.centralSubsidy !== undefined && updatedQuotation.products?.centralSubsidy !== null) {
      pricingData.centralSubsidy = Number(updatedQuotation.products.centralSubsidy);
    }
    if (updatedQuotation.discount !== undefined && updatedQuotation.discount !== null) {
      pricingData.discount = Number(updatedQuotation.discount);
    }
    if (updatedQuotation.finalAmount !== undefined && updatedQuotation.finalAmount !== null) {
      pricingData.finalAmount = Number(updatedQuotation.finalAmount);
    }
    
    // Validate at least one field is provided
    if (Object.keys(pricingData).length === 0) {
      toast.error("Please provide at least one pricing field to update");
      return;
    }
    
    console.log("Updating pricing:", pricingData);
    
    const response = await api.quotations.updatePricing(quotationId, pricingData);
    
    if (!response) {
      throw new Error("No response from server");
    }
    
    if (!response.success) {
      const errorMsg = response.error?.message || "Failed to update pricing";
      const errorDetails = response.error?.details || [];
      console.error("API Error:", errorMsg, errorDetails);
      toast.error(errorMsg);
      throw new Error(errorMsg);
    }
    
    // Success - update local state
    setFullQuotation({
      ...fullQuotation,
      ...response.data.pricing,
      discount: response.data.discount,
      subtotal: response.data.subtotal,
      totalAmount: response.data.totalAmount,
      finalAmount: response.data.finalAmount
    });
    
    toast.success("Pricing updated successfully");
    
  } catch (error: any) {
    console.error("Pricing update error:", error);
    
    // Extract error message
    let errorMessage = "Failed to update pricing information";
    
    if (error?.response?.data?.error) {
      errorMessage = error.response.data.error.message || errorMessage;
    } else if (error?.message) {
      errorMessage = error.message;
    }
    
    toast.error(errorMessage);
    throw error;
  }
};
```

## Backend Validation Rules

The backend validates:
- ✅ `discount`: Must be between 0-100
- ✅ `subtotal`: Must be greater than 0
- ✅ `finalAmount`: Must be between 0 and subtotal
- ✅ Total subsidy (state + central) cannot exceed subtotal
- ✅ At least one field must be provided

## Still Having Issues?

1. Check the backend logs for detailed error messages
2. Verify the quotation ID is correct
3. Ensure the user has permission to update the quotation
4. Check if the quotation exists in the database
5. Verify the API endpoint URL is correct: `/api/quotations/{quotationId}/pricing`
