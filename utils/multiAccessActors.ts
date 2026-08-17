import { Request } from 'express';
import { Dealer, Visitor } from '../models/index-quotation';
import { logError } from './loggerHelper';
import { canAccessSection, resolveAccess, type AccessKey } from './userAccess';
import { cachedLookup } from './ttlCache';

type ActorUser = {
  id: string;
  username: string;
  role?: string;
  access?: unknown;
  firstName?: string;
  lastName?: string;
  email?: string;
  mobile?: string;
};

const ACTOR_TTL_MS = 60_000;

const findDealerForUser = async (user: ActorUser): Promise<Dealer | null> => {
  const username = String(user.username || '').trim();
  const id = String(user.id || '').trim();
  const email = String(user.email || '').trim();
  const mobile = String(user.mobile || '').trim();
  if (id) {
    const byId = await Dealer.findOne({
      where: { id },
      attributes: ['id', 'username', 'role']
    });
    if (byId) return byId;
  }
  if (username) {
    const byUsername = await Dealer.findOne({
      where: { username },
      attributes: ['id', 'username', 'role']
    });
    if (byUsername) return byUsername;
  }
  if (email) {
    const byEmail = await Dealer.findOne({
      where: { email },
      attributes: ['id', 'username', 'role']
    });
    if (byEmail) return byEmail;
  }
  if (mobile) {
    return Dealer.findOne({
      where: { mobile },
      attributes: ['id', 'username', 'role']
    });
  }
  return null;
};

const findVisitorForUser = async (user: ActorUser): Promise<Visitor | null> => {
  const username = String(user.username || '').trim();
  const id = String(user.id || '').trim();
  const email = String(user.email || '').trim();
  if (id) {
    const byId = await Visitor.findOne({
      where: { id },
      attributes: ['id', 'username']
    });
    if (byId) return byId;
  }
  if (username) {
    const byUsername = await Visitor.findOne({
      where: { username },
      attributes: ['id', 'username']
    });
    if (byUsername) return byUsername;
  }
  if (email) {
    return Visitor.findOne({
      where: { email },
      attributes: ['id', 'username']
    });
  }
  return null;
};

const attachDealerFromRow = (req: Request, dealer: Dealer, access: AccessKey[]): void => {
  req.dealer = {
    id: dealer.id,
    username: dealer.username,
    role: dealer.role,
    access
  };
};

const syntheticDealer = (user: ActorUser, access: AccessKey[]) => ({
  id: user.id,
  username: user.username,
  role: 'dealer' as const,
  access
});

/**
 * §G — when JWT role is hr/ops but access includes quotation/visitor,
 * attach dealer/visitor actors so existing controllers keep using req.dealer / req.visitor.
 * Actor id prefers JWT sub (req.user.id), then same-username / email link.
 */
export const attachMultiAccessActors = async (req: Request): Promise<void> => {
  const user = req.user as ActorUser | undefined;
  if (!user?.id) return;
  if (req.dealer && req.visitor) return;

  const access = resolveAccess({
    role: user.role,
    access: user.access,
    username: user.username
  });

  const needDealer = !req.dealer && canAccessSection({ role: user.role, access, username: user.username }, 'quotation');
  const needVisitor = !req.visitor && canAccessSection({ role: user.role, access, username: user.username }, 'visitor');
  if (!needDealer && !needVisitor) return;

  try {
    const [dealer, visitor] = await Promise.all([
      needDealer
        ? cachedLookup(`actor-dealer:${user.id}`, () => findDealerForUser(user), ACTOR_TTL_MS)
        : Promise.resolve(null),
      needVisitor
        ? cachedLookup(`actor-visitor:${user.id}`, () => findVisitorForUser(user), ACTOR_TTL_MS)
        : Promise.resolve(null)
    ]);

    if (needDealer) {
      if (dealer) attachDealerFromRow(req, dealer, access);
      else req.dealer = syntheticDealer(user, access);
    }

    if (needVisitor) {
      if (visitor) req.visitor = { id: visitor.id, username: visitor.username };
      else req.visitor = { id: user.id, username: user.username };
    }
  } catch (error) {
    logError('attachMultiAccessActors failed (non-fatal)', error, { userId: user.id });
    if (needDealer) req.dealer = syntheticDealer(user, access);
    if (needVisitor) req.visitor = { id: user.id, username: user.username };
  }
};
