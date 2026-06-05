export type SubsidyChequeApiRow = {
  id: string;
  details: string;
  amount: number;
  status: 'pending' | 'cleared';
  clearedAt?: string;
};

/**
 * Normalize subsidy cheque rows from PATCH body (Account Management).
 * Returns [] if array is empty; undefined if input is not an array (caller: skip DB update).
 */
export function normalizeSubsidyChequesFromRequestBody(raw: unknown): SubsidyChequeApiRow[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SubsidyChequeApiRow[] = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const o = c as Record<string, unknown>;
    const id =
      String(o.id ?? '').trim() ||
      `sc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const details = String(o.details ?? o.chequeDetails ?? '').trim();
    const amount = Math.round((Number(o.amount) || 0) * 100) / 100;
    const status = o.status === 'cleared' ? 'cleared' : 'pending';
    const clearedAtRaw = o.clearedAt ?? o.cleared_at;
    const clearedAt =
      typeof clearedAtRaw === 'string' && clearedAtRaw.trim()
        ? clearedAtRaw.trim()
        : status === 'cleared'
          ? new Date().toISOString()
          : undefined;
    out.push({ id, details, amount, status, clearedAt });
  }
  return out;
}

export function readSubsidyChequesFromRow(q: Record<string, unknown>): SubsidyChequeApiRow[] {
  let raw: unknown = q.subsidyCheques ?? q.subsidy_cheques;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e) => e && typeof e === 'object')
    .map((e) => {
      const o = e as Record<string, unknown>;
      return {
        id: String(o.id ?? ''),
        details: String(o.details ?? o.chequeDetails ?? ''),
        amount: Math.round((Number(o.amount) || 0) * 100) / 100,
        status: o.status === 'cleared' ? ('cleared' as const) : ('pending' as const),
        clearedAt:
          typeof o.clearedAt === 'string'
            ? o.clearedAt
            : typeof o.cleared_at === 'string'
              ? o.cleared_at
              : undefined
      };
    })
    .filter((row) => row.id);
}
