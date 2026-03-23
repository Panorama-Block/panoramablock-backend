const QUEUE_TIMEOUT_MS = 30_000;

/**
 * Per-user request serialization middleware.
 *
 * Ensures that concurrent requests from the same wallet address are processed
 * sequentially, preventing RPC call bursts from a single user.
 */
const locks = new Map();

function getUserKey(req) {
  const addr =
    req.verifiedAddress ||
    req.body?.userAddress ||
    req.body?.address ||
    req.query?.userAddress ||
    req.query?.address ||
    req.params?.address;

  return addr ? String(addr).toLowerCase() : null;
}

function serializeByUser(req, res, next) {
  const userKey = getUserKey(req);

  if (!userKey) {
    next();
    return;
  }

  const prev = locks.get(userKey) || Promise.resolve();

  let releaseLock;
  const currentLock = new Promise((resolve) => {
    releaseLock = resolve;
  });

  locks.set(userKey, currentLock);

  const timeout = setTimeout(() => {
    releaseLock();
  }, QUEUE_TIMEOUT_MS);

  const release = () => {
    clearTimeout(timeout);
    releaseLock();
    if (locks.get(userKey) === currentLock) {
      locks.delete(userKey);
    }
  };

  res.once('finish', release);
  res.once('close', release);

  prev.then(() => next());
}

module.exports = { serializeByUser };
