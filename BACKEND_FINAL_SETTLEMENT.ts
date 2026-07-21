// @ts-nocheck
/**
 * =============================================================================
 * BACKEND REFERENCE — Account Management "Final Settlement" (Jul 2026)
 * =============================================================================
 *
 * Copy-paste-ready Express + Sequelize controllers matching the frontend client
 * `api.quotations.finalizeSettlement`. Spec: BACKEND_FINAL_SETTLEMENT.md.
 *
 * Settlement rule
 *   Settlement amount = REMAINING ONLY (e.g. ₹2,000) → written off as `discountAmount` (`d`).
 *   Installments are NEVER rewritten during settlement (paid stays as-is).
 *   NEVER hard-reject a settle because the server thinks the balance is cleared
 *   (subtotal-vs-amountAfterSubsidy mismatch). Settlement always = "mark completed, remaining 0".
 *
 * Frontend try-order (finalizeSettlement):
 *   1. POST  /api/quotations/:id/final-settlement           (preferred, atomic — postFinalSettlement)
 *   2. PATCH /api/quotations/:id/pricing                    (absolute discountAmount — patchPricingWithSettlement)
 *      + PATCH /api/quotations/:id/payment-details          (status-only, no phases — patchPaymentDetailsStatusOnly)
 *   3. PATCH /api/quotations/:id/discount                   (absolute INR fallback — patchDiscountAbsolute)
 *
 * Persistence is MANDATORY. The client no longer falls back to localStorage when the API is on:
 * if the backend does not persist, the user sees "Settlement not saved" and the button stays.
 *
 * GET must return `finalSettlementApplied: true` (and/or `finalSettlementAmount > 0`),
 * `remaining: 0`, `paymentStatus: "completed"` so the button stays hidden after refresh
 * on any device/role. See extendQuotationJsonForSettlement().
 *
 * Live implementation in this repo:
 *   controllers/quotationController.ts — submitQuotationFinalSettlement, updateQuotationPricing,
 *                                        updateQuotationPaymentDetails, updateQuotationDiscount,
 *                                        reconcilePaymentRemainingStatus
 *   validations/quotationValidations.ts — updatePricingSchema, updatePaymentDetailsSchema,
 *                                         finalSettlementSchema
 *   routes/quotationRoutes.ts — route registration (see bottom)
 *   models/Quotation.ts + migration 20260720140000-final-settlement-fields.js
 * =============================================================================
 */

import { Request, Response } from 'express';
import { Quotation, QuotationProduct } from '../models';
import {
  loadQuotationPaymentPhases,
  sumPhasePaidAmounts,
  normalizePaymentPhases,
  shouldReplacePaymentPhases,
  replaceQuotationPaymentPhases,
  upsertQuotationPaymentPhases
} from '../utils/quotationPaymentPhases';

/* -----------------------------------------------------------------------------
 * Shared money helpers
 * ---------------------------------------------------------------------------*/

/** amountAfterSubsidy = stored column, else subtotal − (central + state). */
const resolveAmountAfterSubsidy = (q, products = null): number => {
  const subtotal = Number(q.subtotal || 0);
  const stored = Number(q.amountAfterSubsidy);
  const rawStored = q.amountAfterSubsidy;
  // Prefer persisted value unless it looks unset (0 while subtotal > 0).
  if (rawStored !== undefined && rawStored !== null && Number.isFinite(stored) && !(stored === 0 && subtotal > 0)) {
    return Math.max(0, stored);
  }
  const central = Number(products?.centralSubsidy ?? q.centralSubsidy ?? 0);
  const state = Number(products?.stateSubsidy ?? q.stateSubsidy ?? 0);
  return Math.max(0, subtotal - central - state);
};

/** remaining = max(0, amountAfterSubsidy − discountAmount − totalPaid). */
const remainingAgainstAmountAfterSubsidy = (amountAfterSubsidy, totalPaid, discountAmount = 0): number => {
  const base = Number(amountAfterSubsidy) || 0;
  const discount = Math.max(0, Number(discountAmount) || 0);
  const paid = Number(totalPaid);
  return Math.max(0, base - discount - (Number.isNaN(paid) ? 0 : paid));
};

/** Effective payable after subsidy + discount write-off (cap for paid totals). */
const effectivePayableCap = (amountAfterSubsidy, discountAmount = 0): number =>
  Math.max(0, (Number(amountAfterSubsidy) || 0) - Math.max(0, Number(discountAmount) || 0));

/**
 * Resolve remaining + status for API. NEVER claim completed / remaining 0
 * while an unpaid gap still exists WITHOUT discount covering it.
 * paid 150000 of 185000, no discount → { remaining: 35000, paymentStatus: 'partial' }.
 */
const reconcilePaymentRemainingStatus = (storedStatus, amountAfterSubsidy, totalPaid, discountAmount) => {
  const remaining = remainingAgainstAmountAfterSubsidy(amountAfterSubsidy, totalPaid, discountAmount);
  const paid = Number(totalPaid) || 0;
  if (remaining > 0.01) {
    return { remaining, paymentStatus: paid <= 0.01 ? 'pending' : 'partial' };
  }
  if (storedStatus === 'completed') {
    return { remaining: 0, paymentStatus: 'completed' };
  }
  const payable = effectivePayableCap(amountAfterSubsidy, discountAmount);
  const derived = paid >= payable - 0.01 && payable > 0 ? 'completed' : paid > 0 ? 'partial' : 'pending';
  return { remaining: 0, paymentStatus: derived };
};

/* -----------------------------------------------------------------------------
 * 1) POST /api/quotations/:id/final-settlement   (PREFERRED — atomic, idempotent)
 * ---------------------------------------------------------------------------*/
/**
 * One DB write: adds `amount` (= remaining) to discountAmount, sets remaining = 0,
 * paymentStatus = completed, and persists finalSettlementApplied / finalSettlementAmount /
 * finalSettlementAt / finalSettlementBy. Idempotent — if already applied, does not double-add.
 *
 * Body the frontend sends (all amount aliases = remaining; extras are echoed/ignored):
 *   {
 *     "amount": 2000, "settlementAmount": 2000, "discountAmount": 2000,
 *     "finalAmount": 290000, "paymentStatus": "completed",
 *     "remaining": 0, "remainingAmount": 0, "finalSettlementApplied": true
 *   }
 */
export const postFinalSettlement = async (req: Request, res: Response): Promise<void> => {
  try {
    const role = req.user?.role;
    const isAccountManager = role === 'account-management' || role === 'hr';
    const isInventoryAdmin = role === 'admin' || role === 'super-admin' || role === 'super-admin-manager';
    const isQuotationAdmin = req.dealer && req.dealer.role === 'admin';
    if (!isAccountManager && !isInventoryAdmin && !isQuotationAdmin) {
      res.status(403).json({ success: false, error: { code: 'AUTH_004', message: 'Insufficient permissions' } });
      return;
    }

    const { quotationId } = req.params;
    // Client sends amount / settlementAmount / discountAmount (all = remaining) — accept any.
    const amountRaw =
      req.body?.amount ?? req.body?.settlementAmount ?? req.body?.discountAmount ?? req.body?.finalSettlementAmount;
    const amount = amountRaw !== undefined && amountRaw !== null ? Number(amountRaw) : NaN;
    if (!Number.isFinite(amount) || amount < 0) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: 'amount must be a non-negative number (settlement = remaining only)' }
      });
      return;
    }

    const quotation = await Quotation.findOne({
      where: { id: quotationId, status: 'approved' },
      include: [{ model: QuotationProduct, as: 'products' }]
    });
    if (!quotation) {
      res.status(404).json({ success: false, error: { code: 'RES_001', message: 'Quotation not found' } });
      return;
    }

    // Idempotency: if already settled, echo current state instead of double-adding.
    if (quotation.finalSettlementApplied === true) {
      const phasesEcho = await loadQuotationPaymentPhases(quotation.id);
      res.json({ success: true, data: buildSettlementResponse(quotation, phasesEcho) });
      return;
    }

    const phases = await loadQuotationPaymentPhases(quotation.id);
    const paid = phases.length > 0 ? sumPhasePaidAmounts(phases) : Number(quotation.paidAmount || 0);
    const amountAfterSubsidy = resolveAmountAfterSubsidy(quotation, quotation.products);
    const existingDiscount = Number(quotation.discountAmount || 0);
    const currentRemaining = remainingAgainstAmountAfterSubsidy(amountAfterSubsidy, paid, existingDiscount);

    // DO NOT reject when the server thinks the balance is already cleared.
    // Settlement = "mark completed, remaining 0". The subtotal-vs-amountAfterSubsidy mismatch
    // (AM shows a small gap the server's amountAfterSubsidy does not) must NOT block the write.
    // Store the requested amount for audit, but only grow discount up to (amountAfterSubsidy − paid)
    // so payable never drops below paid (avoids creating paid > payable).
    const requestedSettlement = amount > 0 ? amount : currentRemaining;
    const maxDiscountAddable = Math.max(0, currentRemaining); // amountAfterSubsidy − paid − existingDiscount, floored at 0
    const discountAdded = Math.min(requestedSettlement, maxDiscountAddable);
    const newDiscountAmount = existingDiscount + discountAdded;
    const newTotalAmount = Math.max(0, amountAfterSubsidy - newDiscountAmount);
    const actorId = req.user?.id ?? req.dealer?.id ?? null;

    await quotation.update({
      discountAmount: newDiscountAmount,
      discount: newDiscountAmount, // convention: > 100 ⇒ absolute INR
      totalAmount: newTotalAmount,
      finalAmount: newTotalAmount,
      remainingAmount: 0,
      paymentStatus: 'completed',
      finalSettlementAmount: requestedSettlement, // audit: what AM asked to write off
      finalSettlementApplied: true,
      finalSettlementAt: new Date(),
      finalSettlementBy: actorId
      // NOTE: installments are NOT touched — paidAmount / phases unchanged.
    });

    await quotation.reload();
    const responsePhases = await loadQuotationPaymentPhases(quotation.id);
    res.json({ success: true, data: buildSettlementResponse(quotation, responsePhases) });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'SYS_001', message: 'Internal server error' } });
  }
};

/* -----------------------------------------------------------------------------
 * 2a) PATCH /api/quotations/:id/pricing   (absolute discountAmount, no subtotal)
 * ---------------------------------------------------------------------------*/
/**
 * Body (Final Settlement): { "discountAmount": 2000, "totalAmount": 183000, "finalAmount": 183000 }
 * - discountAmount is ABSOLUTE INR — do NOT recompute from %.
 * - subtotal is OPTIONAL — keep the stored package amount.
 * - Validate finalAmount against stored/computed amountAfterSubsidy (kills the
 *   "Final amount must be between 0 and amount after subsidy" error).
 */
export const patchPricingWithSettlement = async (req: Request, res: Response): Promise<void> => {
  try {
    const isAccountManager = req.user && (req.user.role === 'account-management' || req.user.role === 'hr');
    const isInventoryAdmin =
      req.user && ['admin', 'super-admin', 'super-admin-manager'].includes(req.user.role);
    if (!req.dealer && !isAccountManager && !isInventoryAdmin) {
      res.status(401).json({ success: false, error: { code: 'AUTH_003', message: 'User not authenticated' } });
      return;
    }

    const { quotationId } = req.params;
    const { subtotal, stateSubsidy, centralSubsidy, discount, discountAmount, finalAmount, totalAmount } = req.body;

    const where: any = { id: quotationId };
    if (isAccountManager) where.status = 'approved';
    else if (req.dealer && req.dealer.role !== 'admin') where.dealerId = req.dealer.id;

    const quotation = await Quotation.findOne({ where, include: [{ model: QuotationProduct, as: 'products' }] });
    if (!quotation) {
      res.status(404).json({ success: false, error: { code: 'RES_001', message: 'Quotation not found' } });
      return;
    }
    const products = quotation.products || {};

    // subtotal optional — fall back to stored package amount.
    const newSubtotal = subtotal !== undefined ? Number(subtotal) : Number(quotation.subtotal || 0);
    const newStateSubsidy = stateSubsidy !== undefined ? Number(stateSubsidy) : Number(products.stateSubsidy ?? quotation.stateSubsidy ?? 0);
    const newCentralSubsidy = centralSubsidy !== undefined ? Number(centralSubsidy) : Number(products.centralSubsidy ?? quotation.centralSubsidy ?? 0);

    // Prefer stored amountAfterSubsidy when only discount/finalAmount are patched.
    const patchedBase = subtotal !== undefined || stateSubsidy !== undefined || centralSubsidy !== undefined;
    const amountAfterSubsidy = patchedBase
      ? Math.max(0, newSubtotal - newStateSubsidy - newCentralSubsidy)
      : resolveAmountAfterSubsidy(quotation, { centralSubsidy: newCentralSubsidy, stateSubsidy: newStateSubsidy });

    // Absolute discountAmount; else % of amountAfterSubsidy; else keep existing.
    let effectiveDiscountAmount;
    if (discountAmount !== undefined && discountAmount !== null && discountAmount !== '') {
      effectiveDiscountAmount = Number(discountAmount);
    } else if (discount !== undefined && Number(discount) > 100) {
      effectiveDiscountAmount = Number(discount); // > 100 ⇒ absolute INR
    } else if (discount !== undefined) {
      effectiveDiscountAmount = (amountAfterSubsidy * Number(discount)) / 100;
    } else {
      effectiveDiscountAmount = Number(quotation.discountAmount || 0);
    }
    if (!Number.isFinite(effectiveDiscountAmount) || effectiveDiscountAmount < 0) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: 'Discount amount must be a non-negative number' }
      });
      return;
    }

    const newFinalAmount = finalAmount !== undefined ? Number(finalAmount) : undefined;
    // Validate finalAmount against amountAfterSubsidy (allow float tolerance).
    if (newFinalAmount !== undefined && (Number.isNaN(newFinalAmount) || newFinalAmount < 0 || newFinalAmount > amountAfterSubsidy + 0.01)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Final amount must be between 0 and amount after subsidy',
          details: [{ field: 'finalAmount', message: `Final amount must be between 0 and ${amountAfterSubsidy}` }]
        }
      });
      return;
    }

    const calculatedTotal = Math.max(0, amountAfterSubsidy - effectiveDiscountAmount);
    const persistedTotalAmount = totalAmount !== undefined ? Number(totalAmount) : calculatedTotal;
    const persistedFinalAmount = newFinalAmount !== undefined ? newFinalAmount : calculatedTotal;

    const paid = Number(quotation.paidAmount || 0);
    const remaining = remainingAgainstAmountAfterSubsidy(amountAfterSubsidy, paid, effectiveDiscountAmount);

    await quotation.update({
      subtotal: newSubtotal,
      discount: effectiveDiscountAmount, // store INR on discount too (> 100 ⇒ INR)
      discountAmount: effectiveDiscountAmount,
      totalAmount: persistedTotalAmount,
      finalAmount: persistedFinalAmount,
      remainingAmount: remaining
    });
    await quotation.reload();

    res.json({
      success: true,
      data: {
        id: quotation.id,
        subtotal: newSubtotal,
        discountAmount: effectiveDiscountAmount,
        discount_amount: effectiveDiscountAmount,
        totalAmount: persistedTotalAmount,
        finalAmount: persistedFinalAmount,
        remaining,
        remainingAmount: remaining,
        pricing: {
          subtotal: newSubtotal,
          amountAfterSubsidy,
          discountAmount: effectiveDiscountAmount,
          totalAmount: persistedTotalAmount,
          finalAmount: persistedFinalAmount
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'SYS_001', message: 'Internal server error' } });
  }
};

/* -----------------------------------------------------------------------------
 * 2b) PATCH /api/quotations/:id/payment-details   (status-only, NO phases)
 * ---------------------------------------------------------------------------*/
/**
 * Body (status-only): { "paymentStatus": "completed", "remaining": 0,
 *                       "finalSettlementAmount": 2000, "finalSettlementApplied": true,
 *                       "replaceInstallments": false }
 *
 * When NO phases/installments array is present:
 *   - update status / remaining / finalSettlement flags ONLY
 *   - NEVER run the "total paid cannot exceed payable after discount" check
 *     (that VAL_012 caused the 290000-vs-212000 error when phases were re-sent)
 *   - NEVER delete/replace installment rows (paid stays 290000)
 *
 * When phases ARE present: delegate to the existing replace/upsert flow (§AB).
 * Refuse `completed` when an unpaid gap still exists without discount (VAL_013).
 */
export const patchPaymentDetailsStatusOnly = async (req: Request, res: Response): Promise<void> => {
  try {
    const role = req.user?.role;
    const isAccountManager = role === 'account-management';
    const isInventoryAdmin = role === 'admin';
    const isQuotationAdmin = req.dealer && req.dealer.role === 'admin';
    if (!isAccountManager && !isInventoryAdmin && !isQuotationAdmin) {
      res.status(403).json({ success: false, error: { code: 'AUTH_004', message: 'Insufficient permissions' } });
      return;
    }

    const { quotationId } = req.params;
    const {
      paymentMode,
      paymentType,
      paymentStatus: paymentStatusFromBody,
      remaining: remainingFromBody,
      remainingAmount: remainingAmountFromBody,
      finalSettlementAmount,
      finalSettlementApplied
    } = req.body;

    const phasePayload = req.body.phases ?? req.body.installments ?? req.body.paymentPhases;
    const hasPhasePayload = Array.isArray(phasePayload); // Final Settlement omits this.

    const quotation = await Quotation.findOne({ where: { id: quotationId, status: 'approved' } });
    if (!quotation) {
      res.status(404).json({ success: false, error: { code: 'RES_001', message: 'Quotation not found' } });
      return;
    }

    const discountAmt = Number(quotation.discountAmount || 0);
    const amountAfterSubsidy = resolveAmountAfterSubsidy(quotation);

    const settlementFields = {
      ...(finalSettlementAmount !== undefined ? { finalSettlementAmount: Number(finalSettlementAmount) } : {}),
      ...(finalSettlementApplied !== undefined
        ? { finalSettlementApplied: !!finalSettlementApplied, ...(finalSettlementApplied ? { finalSettlementAt: new Date() } : {}) }
        : {})
    };

    if (hasPhasePayload) {
      // --- Phases present: existing replace/upsert path (VAL_012 still enforced here) ---
      const normalized = normalizePaymentPhases(phasePayload, req.user?.id);
      if (shouldReplacePaymentPhases(req, true)) {
        await replaceQuotationPaymentPhases(quotation.id, normalized, req.user?.id);
      } else {
        await upsertQuotationPaymentPhases(quotation.id, normalized, req.user?.id);
      }
      const merged = await loadQuotationPaymentPhases(quotation.id);
      const totalPaid = sumPhasePaidAmounts(merged);
      const payableCap = effectivePayableCap(amountAfterSubsidy, discountAmt);
      if (totalPaid > payableCap + 0.01) {
        res.status(400).json({
          success: false,
          error: { code: 'VAL_012', message: `Total paid (${totalPaid}) cannot exceed payable after discount (${payableCap})` }
        });
        return;
      }
      const rec = reconcilePaymentRemainingStatus(paymentStatusFromBody ?? quotation.paymentStatus, amountAfterSubsidy, totalPaid, discountAmt);
      if (paymentStatusFromBody === 'completed' && rec.remaining > 0.01) {
        res.status(400).json({ success: false, error: { code: 'VAL_013', message: `Cannot mark completed while remaining (${rec.remaining}) exists. Apply discount via PATCH /pricing first.` } });
        return;
      }
      await quotation.update({
        paymentMode: paymentMode ?? quotation.paymentMode,
        paymentType: paymentType ?? quotation.paymentType,
        paymentStatus: paymentStatusFromBody === 'completed' && rec.remaining <= 0.01 ? 'completed' : rec.paymentStatus,
        paidAmount: totalPaid,
        paymentPhases: merged,
        remainingAmount: rec.remaining,
        ...settlementFields
      });
    } else {
      // --- STATUS-ONLY: do not touch installments; skip VAL_012 entirely ---
      const paid = Number(quotation.paidAmount || 0);
      const rec = reconcilePaymentRemainingStatus(paymentStatusFromBody ?? quotation.paymentStatus, amountAfterSubsidy, paid, discountAmt);

      if (paymentStatusFromBody === 'completed' && rec.remaining > 0.01) {
        res.status(400).json({
          success: false,
          error: { code: 'VAL_013', message: `Cannot mark completed while remaining (${rec.remaining}) exists. Apply remaining as discountAmount via PATCH /pricing first.` }
        });
        return;
      }

      const bodyRemaining =
        remainingFromBody !== undefined ? Number(remainingFromBody)
        : remainingAmountFromBody !== undefined ? Number(remainingAmountFromBody)
        : undefined;

      const remainingStored =
        paymentStatusFromBody === 'completed' || (bodyRemaining !== undefined && bodyRemaining <= 0.01) ? 0
        : bodyRemaining !== undefined ? Math.max(0, bodyRemaining)
        : rec.remaining;

      const resolvedStatus =
        paymentStatusFromBody === 'completed' && remainingStored <= 0.01 ? 'completed'
        : paymentStatusFromBody !== undefined ? paymentStatusFromBody
        : rec.paymentStatus;

      await quotation.update({
        paymentMode: paymentMode ?? quotation.paymentMode,
        paymentType: paymentType ?? quotation.paymentType,
        ...(paymentStatusFromBody !== undefined || bodyRemaining !== undefined || finalSettlementApplied !== undefined
          ? { paymentStatus: resolvedStatus, remainingAmount: remainingStored }
          : {}),
        ...settlementFields
      });
    }

    await quotation.reload();
    const responsePhases = await loadQuotationPaymentPhases(quotation.id);
    res.json({ success: true, data: buildSettlementResponse(quotation, responsePhases) });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'SYS_001', message: 'Internal server error' } });
  }
};

/* -----------------------------------------------------------------------------
 * 3) PATCH /api/quotations/:id/discount   (last fallback — absolute INR)
 * ---------------------------------------------------------------------------*/
/** Body: { "discount": 2000 }  →  discount > 100 = absolute INR (stored on discountAmount). */
export const patchDiscountAbsolute = async (req: Request, res: Response): Promise<void> => {
  try {
    const isAccountManager = req.user && (req.user.role === 'account-management' || req.user.role === 'hr');
    const isInventoryAdmin = req.user && ['admin', 'super-admin', 'super-admin-manager'].includes(req.user.role);
    if (!req.dealer && !isAccountManager && !isInventoryAdmin) {
      res.status(401).json({ success: false, error: { code: 'AUTH_003', message: 'User not authenticated' } });
      return;
    }

    const { quotationId } = req.params;
    const where: any = { id: quotationId };
    if (isAccountManager) where.status = 'approved';
    else if (req.dealer && req.dealer.role !== 'admin') where.dealerId = req.dealer.id;

    const quotation = await Quotation.findOne({ where, include: [{ model: QuotationProduct, as: 'products' }] });
    if (!quotation) {
      res.status(404).json({ success: false, error: { code: 'RES_001', message: 'Quotation not found' } });
      return;
    }

    const raw = req.body.discountAmount ?? req.body.discount;
    const value = raw !== undefined && raw !== null && raw !== '' ? Number(raw) : NaN;
    if (!Number.isFinite(value) || value < 0) {
      res.status(400).json({ success: false, error: { code: 'VAL_001', message: 'Discount must be a non-negative number' } });
      return;
    }

    const amountAfterSubsidy = resolveAmountAfterSubsidy(quotation, quotation.products);
    // discount ≤ 100 = percentage; > 100 (or discountAmount) = absolute INR.
    const isAbsolute = req.body.discountAmount !== undefined || value > 100;
    const discountAmount = isAbsolute ? value : (amountAfterSubsidy * value) / 100;
    const newTotal = Math.max(0, amountAfterSubsidy - discountAmount);
    const remaining = remainingAgainstAmountAfterSubsidy(amountAfterSubsidy, Number(quotation.paidAmount || 0), discountAmount);

    await quotation.update({
      discount: isAbsolute ? discountAmount : value,
      discountAmount,
      totalAmount: newTotal,
      finalAmount: newTotal,
      remainingAmount: remaining
    });
    await quotation.reload();

    res.json({
      success: true,
      data: {
        id: quotation.id,
        discount: quotation.discount,
        discountAmount,
        discount_amount: discountAmount,
        totalAmount: newTotal,
        finalAmount: newTotal,
        remaining,
        remainingAmount: remaining
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'SYS_001', message: 'Internal server error' } });
  }
};

/* -----------------------------------------------------------------------------
 * GET extension — keep the button hidden after refresh
 * ---------------------------------------------------------------------------*/
/**
 * Merge into every approved list-row and detail payload for GET /api/quotations
 * and GET /api/quotations/:id. Ensures the settled flag + reconciled remaining
 * survive reload on any device/role.
 */
export const extendQuotationJsonForSettlement = (quotation, phases = []) => {
  const totalPaid = phases.length > 0 ? sumPhasePaidAmounts(phases) : Number(quotation.paidAmount || 0);
  const amountAfterSubsidy = resolveAmountAfterSubsidy(quotation, quotation.products);
  const discountAmount = Number(quotation.discountAmount || 0);
  const { remaining, paymentStatus } = reconcilePaymentRemainingStatus(
    quotation.paymentStatus,
    amountAfterSubsidy,
    totalPaid,
    discountAmount
  );
  return {
    discountAmount,
    discount_amount: discountAmount,
    remaining,
    remainingAmount: remaining,
    paymentStatus,
    // Persisted audit flags — the frontend hides the button when either is truthy.
    finalSettlementApplied: !!quotation.finalSettlementApplied,
    finalSettlementAmount: quotation.finalSettlementAmount != null ? Number(quotation.finalSettlementAmount) : null,
    finalSettlementAt: quotation.finalSettlementAt || null,
    finalSettlementBy: quotation.finalSettlementBy || null,
    pricing: {
      amountAfterSubsidy,
      discountAmount,
      totalAmount: Number(quotation.totalAmount || 0),
      finalAmount: Number(quotation.finalAmount || 0)
    }
  };
};

/** Shared response builder for settlement + payment-details write endpoints. */
const buildSettlementResponse = (quotation, phases = []) => {
  const qAny = quotation as any;
  return {
    id: quotation.id,
    quotationId: quotation.id,
    subtotal: Number(quotation.subtotal || 0),
    ...extendQuotationJsonForSettlement(quotation, phases),
    installments: phases,
    paymentPhases: phases,
    payment_phases: phases,
    paidAmount: qAny.paidAmount != null ? Number(qAny.paidAmount) : (phases.length ? sumPhasePaidAmounts(phases) : 0),
    updatedAt: quotation.updatedAt
  };
};

/* -----------------------------------------------------------------------------
 * ROUTE REGISTRATION (routes/quotationRoutes.ts)
 * ---------------------------------------------------------------------------*/
/*
import { validate } from '../middleware/validate';
import {
  finalSettlementSchema,
  updatePricingSchema,
  updatePaymentDetailsSchema,
  updateDiscountSchema
} from '../validations/quotationValidations';

// authorizeDealerOrAccountManager allows dealer JWT, account-management, hr, inventory admin.
router.post ('/:quotationId/final-settlement', authorizeDealerOrAccountManager, validate(finalSettlementSchema),     postFinalSettlement);
router.patch('/:quotationId/pricing',          authorizeDealerOrAccountManager, validate(updatePricingSchema),        patchPricingWithSettlement);
router.patch('/:quotationId/payment-details',  authorizeDealerOrAccountManager, validate(updatePaymentDetailsSchema), patchPaymentDetailsStatusOnly);
router.patch('/:quotationId/discount',         authorizeDealerOrAccountManager, validate(updateDiscountSchema),       patchDiscountAbsolute);
*/

/* -----------------------------------------------------------------------------
 * VALIDATION (validations/quotationValidations.ts) — key points
 * ---------------------------------------------------------------------------*/
/*
// finalSettlementSchema: { amount? , finalSettlementAmount? } — at least one required.
// updatePricingSchema:   subtotal OPTIONAL; discountAmount / finalAmount / totalAmount optional numbers.
// updatePaymentDetailsSchema:
//   - phases/installments/paymentPhases OPTIONAL
//   - accept status-only payload: paymentStatus / remaining / remainingAmount /
//     finalSettlementAmount / finalSettlementApplied
//   - CRITICAL: when no phase array is sent, OMIT `phases` from the parsed output
//     (do not coerce to []), so the controller takes the status-only branch and skips VAL_012.
*/

/* -----------------------------------------------------------------------------
 * MIGRATION (database/migrations/XXXXXXXXXXXXXX-final-settlement-fields.js)
 * ---------------------------------------------------------------------------*/
/*
'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('quotations');
    const add = async (col, spec) => { if (!table[col]) await queryInterface.addColumn('quotations', col, spec); };
    await add('finalSettlementAmount',  { type: Sequelize.DECIMAL(14, 2), allowNull: true });
    await add('finalSettlementApplied', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    await add('finalSettlementAt',      { type: Sequelize.DATE, allowNull: true });
    await add('finalSettlementBy',      { type: Sequelize.STRING(50), allowNull: true });
  },
  async down(queryInterface) {
    for (const col of ['finalSettlementBy', 'finalSettlementAt', 'finalSettlementApplied', 'finalSettlementAmount']) {
      await queryInterface.removeColumn('quotations', col).catch(() => {});
    }
  }
};

// This repo uses camelCase (quoted) columns. If your DB uses snake_case, the equivalent is:
//   ALTER TABLE quotations
//     ADD COLUMN IF NOT EXISTS final_settlement_applied BOOLEAN DEFAULT FALSE,
//     ADD COLUMN IF NOT EXISTS final_settlement_amount  NUMERIC(12,2) DEFAULT 0,
//     ADD COLUMN IF NOT EXISTS final_settlement_at      TIMESTAMPTZ NULL,
//     ADD COLUMN IF NOT EXISTS final_settlement_by      UUID NULL,
//     ADD COLUMN IF NOT EXISTS remaining_amount         NUMERIC(12,2) DEFAULT 0;
//
// Sequelize model attrs (models/Quotation.ts):
//   finalSettlementAmount:  { type: DataTypes.DECIMAL(14, 2), allowNull: true }
//   finalSettlementApplied: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
//   finalSettlementAt:      { type: DataTypes.DATE, allowNull: true }
//   finalSettlementBy:      { type: DataTypes.STRING(50), allowNull: true }
*/

/* -----------------------------------------------------------------------------
 * QA CHECKLIST
 * ---------------------------------------------------------------------------*/
/*
1. Remaining ₹2,000 → POST /final-settlement { amount: 2000 } → discountAmount +2000, remaining 0,
   paymentStatus completed, finalSettlementApplied true.
2. Call POST /final-settlement twice → discountAmount does NOT double (idempotent).
2b. SUSHILA mismatch: server amountAfterSubsidy 189000, paid 189000 (remaining 0), settle 1000
    → 200, NO "Settlement amount (1000) cannot exceed remaining (0)"; marks completed, remaining 0,
    finalSettlementApplied true, finalSettlementAmount 1000 (audit). discount capped at
    amountAfterSubsidy − paid (= 0 here), so paid never exceeds payable.
3. PATCH /pricing { discountAmount: 2000 } with NO subtotal → 200 (no "subtotal required").
4. PATCH /pricing with finalAmount ≤ amountAfterSubsidy → no "Final amount must be between 0 and
   amount after subsidy".
5. PATCH /payment-details status-only (no phases) → 200; NEVER returns VAL_012 (290000 vs 212000);
   installment rows unchanged (paid stays 290000).
6. Paid 150000 of 185000, no discount → GET remaining 35000, paymentStatus partial
   (NOT remaining 0 / completed).
7. After settle → hard refresh (any device/role) → GET returns finalSettlementApplied true,
   remaining 0, completed → button stays hidden.
8. API on but not persisted → frontend shows "Settlement not saved" and button remains
   (no localStorage fallback). Backend MUST persist.
*/

export {};
