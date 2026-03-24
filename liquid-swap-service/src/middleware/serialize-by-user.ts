import { Request, Response, NextFunction } from "express";

const QUEUE_TIMEOUT_MS = 30_000;
const MAX_QUEUE_SIZE = 10;

/**
 * Per-user request serialization middleware.
 *
 * Ensures that concurrent requests from the same wallet address are processed
 * sequentially, preventing RPC call bursts from a single user.
 *
 * User is identified by: req.verifiedAddress (set by auth middleware),
 * req.body.userAddress, req.query.userAddress, or req.params.userAddress.
 */
const locks = new Map<string, Promise<void>>();

function getUserKey(req: Request): string | null {
  const addr =
    (req as any).verifiedAddress ||
    req.body?.userAddress ||
    (req.query?.userAddress as string) ||
    req.params?.userAddress;

  return addr ? String(addr).toLowerCase() : null;
}

export function serializeByUser(req: Request, res: Response, next: NextFunction): void {
  const userKey = getUserKey(req);

  // No user identified — pass through (health checks, public routes)
  if (!userKey) {
    next();
    return;
  }

  const prev = locks.get(userKey) ?? Promise.resolve();

  // Create a deferred so we can control when this request's slot is released
  let releaseLock: () => void;
  const currentLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  locks.set(userKey, currentLock);

  // Timeout to prevent deadlocks from stuck requests
  const timeout = setTimeout(() => {
    releaseLock!();
  }, QUEUE_TIMEOUT_MS);

  // Release the lock when the response finishes (or closes prematurely)
  const release = () => {
    clearTimeout(timeout);
    releaseLock!();
    // Clean up if this is the last pending request for the user
    if (locks.get(userKey) === currentLock) {
      locks.delete(userKey);
    }
  };

  res.once("finish", release);
  res.once("close", release);

  // Wait for previous request from same user to complete
  prev.then(() => next());
}
