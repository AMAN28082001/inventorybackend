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

type ResolveActor = {
  id?: string | null;
  username?: string | null;
  name?: string | null;
  role?: string | null;
  authSource?: string | null;
};

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
  const actorId = actor?.id ? String(actor.id).trim() : '';
  const bodyId = bodyCreatedBy ? String(bodyCreatedBy).trim() : '';

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

  if (actorId && username) {
    try {
      const password = await bcrypt.hash(`qa-bridge-${uuidv4()}`, 10);
      const displayName = String(actor?.name || username).trim() || username;
      const created = await User.create({
        id: actorId,
        username,
        password,
        name: displayName,
        role: 'super-admin',
        is_active: true,
        created_by_id: null,
        created_by_name: 'quotation-admin-bridge'
      });
      return created.id;
    } catch (err: any) {
      // Username unique collision — pick existing username row if present
      if (username) {
        const again = await User.findOne({ where: { username }, attributes: ['id'] });
        if (again) return again.id;
      }
      // id collision race — re-read
      const againId = await User.findByPk(actorId, { attributes: ['id'] });
      if (againId) return againId.id;

      // Try alternate username for bridge user
      try {
        const altUsername = `${username}_qa_${actorId.slice(0, 8)}`.slice(0, 100);
        const password = await bcrypt.hash(`qa-bridge-${uuidv4()}`, 10);
        const created = await User.create({
          id: actorId,
          username: altUsername,
          password,
          name: String(actor?.name || username).trim() || username,
          role: 'super-admin',
          is_active: true,
          created_by_id: null,
          created_by_name: 'quotation-admin-bridge'
        });
        return created.id;
      } catch {
        // fall through to active super-admin
      }
    }
  }

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
