import bcrypt from 'bcryptjs';
import { User } from '../models';
import { Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';

export class InventoryCreatedByError extends Error {
  code = 'INV_USER_MISSING';
  constructor(message: string) {
    super(message);
    this.name = 'InventoryCreatedByError';
  }
}

/** Alias used by stock-request dispatch (same INV_USER_MISSING contract). */
export class InventoryUserMissingError extends InventoryCreatedByError {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryUserMissingError';
  }
}

type ResolveActor = {
  id?: string | null;
  username?: string | null;
  name?: string | null;
  role?: string | null;
  authSource?: string | null;
};

const trimId = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const pickBodyUserIds = (
  body: Record<string, unknown> | null | undefined,
  keys: string[]
): string[] => {
  if (!body) return [];
  const out: string[] = [];
  for (const key of keys) {
    const id = trimId(body[key]);
    if (id) out.push(id);
  }
  return out;
};

/**
 * Upsert Quotation Admin (or other JWT actor) into inventory `users`
 * so FK columns (created_by, dispatched_by_id, …) never point at a missing id.
 */
export async function upsertQuotationAdminInventoryUser(
  actor: ResolveActor | null | undefined
): Promise<string | null> {
  const actorId = trimId(actor?.id);
  if (!actorId) return null;

  const existing = await User.findByPk(actorId, { attributes: ['id'] });
  if (existing) return existing.id;

  const username =
    (actor?.username ? String(actor.username).trim() : '') ||
    `user_${actorId.slice(0, 8)}`;
  const displayName =
    String(actor?.name || actor?.username || 'Quotation Admin').trim() ||
    'Quotation Admin';

  try {
    const password = await bcrypt.hash(`qa-bridge-${uuidv4()}`, 10);
    const created = await User.create({
      id: actorId,
      username: username.slice(0, 100),
      password,
      name: displayName.slice(0, 255),
      role: 'super-admin',
      is_active: true,
      created_by_id: null,
      created_by_name: 'quotation-admin-bridge'
    });
    return created.id;
  } catch {
    const againId = await User.findByPk(actorId, { attributes: ['id'] });
    if (againId) return againId.id;

    if (username) {
      const byUsername = await User.findOne({
        where: { username },
        attributes: ['id']
      });
      if (byUsername) return byUsername.id;
    }

    try {
      const altUsername = `${username}_qa_${actorId.slice(0, 8)}`.slice(0, 100);
      const password = await bcrypt.hash(`qa-bridge-${uuidv4()}`, 10);
      const created = await User.create({
        id: actorId,
        username: altUsername,
        password,
        name: displayName.slice(0, 255),
        role: 'super-admin',
        is_active: true,
        created_by_id: null,
        created_by_name: 'quotation-admin-bridge'
      });
      return created.id;
    } catch {
      return null;
    }
  }
}

/**
 * Resolve a valid inventory `users.id` for products.created_by FK.
 * Quotation Admin JWT uses Dealer.id, which is often absent from `users`.
 *
 * Order:
 * 1. jwt.sub / actor.id exists in users
 * 2. body created_by / createdBy is a valid inventory user
 * 3. same username exists in users
 * 4. upsert inventory user with id = actor.id, role = super-admin
 * 5. fall back to any active super-admin
 * 6. else throw INV_USER_MISSING
 */
export async function resolveInventoryCreatedBy(
  actor: ResolveActor | null | undefined,
  bodyCreatedBy?: string | null
): Promise<string> {
  const actorId = trimId(actor?.id);
  const bodyId = trimId(bodyCreatedBy);

  if (actorId) {
    const byId = await User.findByPk(actorId, { attributes: ['id'] });
    if (byId) return byId.id;
  }

  if (bodyId) {
    const byBody = await User.findByPk(bodyId, { attributes: ['id'] });
    if (byBody) return byBody.id;
  }

  const username = actor?.username ? String(actor.username).trim() : '';
  if (username) {
    const byUsername = await User.findOne({
      where: { username },
      attributes: ['id']
    });
    if (byUsername) return byUsername.id;
  }

  const upserted = await upsertQuotationAdminInventoryUser(actor);
  if (upserted) return upserted;

  const fallback = await User.findOne({
    where: {
      is_active: true,
      role: { [Op.in]: ['super-admin', 'super-admin-manager', 'admin'] }
    },
    order: [['created_at', 'ASC']],
    attributes: ['id']
  });
  if (fallback) return fallback.id;

  throw new InventoryCreatedByError(
    'No inventory user available for products.created_by. Create a super-admin in inventory users, or send a valid created_by.'
  );
}

/**
 * Resolve inventory `users.id` for stock_requests.dispatched_by_id.
 * Never returns a JWT id that is not present in `users`.
 *
 * Order (HANDOFF §16 / BACKEND_STOCK_REQUESTS_DISPATCHED_BY.ts):
 * 1. body dispatched_by_id / dispatched_by / dispatchedById / dispatchedBy (if in users)
 * 2. JWT id if in users
 * 3. upsert JWT user into users (same bridge as §14 created_by)
 * 4. else throw INV_USER_MISSING
 */
export async function resolveInventoryDispatchedBy(
  actor: ResolveActor | null | undefined,
  body?: Record<string, unknown> | null
): Promise<string> {
  const bodyIds = pickBodyUserIds(body, [
    'dispatched_by_id',
    'dispatched_by',
    'dispatchedById',
    'dispatchedBy'
  ]);

  for (const bodyId of bodyIds) {
    const byBody = await User.findByPk(bodyId, { attributes: ['id'] });
    if (byBody) return byBody.id;
  }

  const actorId = trimId(actor?.id);
  if (actorId) {
    const byId = await User.findByPk(actorId, { attributes: ['id'] });
    if (byId) return byId.id;
  }

  const upserted = await upsertQuotationAdminInventoryUser(actor);
  if (upserted) return upserted;

  throw new InventoryUserMissingError(
    'No inventory user available for stock_requests.dispatched_by_id. Send a valid dispatched_by_id, or ensure the JWT user can be upserted into inventory users.'
  );
}

/**
 * Resolve inventory `users.id` for sales.created_by.
 * Never returns a JWT id that is not present in `users`.
 *
 * Order (HANDOFF §20 / BACKEND_SALES_CREATED_BY.ts):
 * 1. body created_by / createdBy / created_by_id / createdById (if in users)
 * 2. JWT id if in users
 * 3. upsert JWT user into users
 * 4. else throw INV_USER_MISSING
 */
export async function resolveInventorySaleCreatedBy(
  actor: ResolveActor | null | undefined,
  body?: Record<string, unknown> | null
): Promise<string> {
  const bodyIds = pickBodyUserIds(body, [
    'created_by',
    'createdBy',
    'created_by_id',
    'createdById'
  ]);

  for (const bodyId of bodyIds) {
    const byBody = await User.findByPk(bodyId, { attributes: ['id'] });
    if (byBody) return byBody.id;
  }

  const actorId = trimId(actor?.id);
  if (actorId) {
    const byId = await User.findByPk(actorId, { attributes: ['id'] });
    if (byId) return byId.id;
  }

  const upserted = await upsertQuotationAdminInventoryUser(actor);
  if (upserted) return upserted;

  throw new InventoryUserMissingError(
    'No inventory user available for sales.created_by. Upsert quotation Admin into inventory users, or send a valid created_by.'
  );
}
