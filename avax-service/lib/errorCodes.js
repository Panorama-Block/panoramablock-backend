const RPC_ERROR_PATTERNS = [
  /timeout/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /missing response/i,
  /could not detect network/i,
  /bad response/i,
  /server error/i,
  /rate.?limit/i,
  /too many requests/i,
  /circuit breaker/i,
  /NETWORK_ERROR/i,
  /SERVER_ERROR/i,
  /TIMEOUT/i,
];

/**
 * Check if an error is an RPC/provider failure.
 */
function isRpcError(err) {
  const msg = String(err?.message || err || '');
  return RPC_ERROR_PATTERNS.some((pattern) => pattern.test(msg));
}

/**
 * Send a standardized 503 response for RPC failures.
 */
function sendRpcUnavailable(res, err) {
  console.error('[RPC_UNAVAILABLE]', String(err?.message || err).slice(0, 200));
  return res.status(503).set({ 'Retry-After': '5' }).json({
    success: false,
    error: {
      code: 'RPC_UNAVAILABLE',
      message: 'Blockchain node temporarily unavailable. Please retry.',
      retryAfter: 5,
    },
  });
}

module.exports = { isRpcError, sendRpcUnavailable };
