const { ethers } = require('ethers');
const { SECURITY } = require('../config/constants');
const axios = require('axios');
const { ERROR_CODES, sendError } = require('../lib/errorCodes');

/**
 * In-memory replay protection for signed messages.
 * Tracks signature hashes for SIGNATURE_EXPIRY duration and rejects duplicates.
 */
const usedSignatures = new Map();
const NONCE_CLEANUP_INTERVAL = 60_000; // 1 min
setInterval(() => {
  const cutoff = Date.now() - (SECURITY.SIGNATURE_EXPIRY || 300_000);
  for (const [key, ts] of usedSignatures) {
    if (ts < cutoff) usedSignatures.delete(key);
  }
}, NONCE_CLEANUP_INTERVAL);

function asNonEmptyString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveJwtAddress(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const candidates = [
    payload.address,
    payload.sub,
    payload.walletAddress,
    payload?.user?.address,
    payload?.ctx?.address,
  ];

  for (const candidate of candidates) {
    const value = asNonEmptyString(candidate);
    if (value) return value;
  }
  return null;
}

/**
 * Middleware para verificar assinatura de wallet (smart wallet)
 * Também suporta autenticação via JWT do auth-service
 */
async function verifySignature(req, res, next) {
  try {
    const body = req.body || {};
    const {
      address,
      signature,
      message,
      timestamp,
      walletType,
      isSmartWallet
    } = body;

    // Security: strip privateKey from body if present (smart wallet only mode)
    if (body.privateKey) {
      delete body.privateKey;
    }
    const requestedAddress = address || req.params?.address || req.query?.address;

    // Debug logs para frontend
    console.log('🔍 Debug verifySignature (Frontend):');
    console.log('   Address:', requestedAddress);
    console.log('   Signature:', signature ? '[PRESENT]' : '[NOT PRESENT]');
    console.log('   Message:', message ? '[PRESENT]' : '[NOT PRESENT]');
    console.log('   Timestamp:', timestamp);
    console.log('   isSmartWallet:', isSmartWallet);
    console.log('   walletType:', walletType);
    console.log('   Authorization header:', req.headers.authorization ? 'Present' : 'Missing');

    // NOVA LÓGICA: Verifica se há JWT no header Authorization
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];

      try {
        console.log('🔐 Tentando autenticação via JWT...');
        const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
        const response = await axios.post(`${authServiceUrl}/auth/validate`,
          { token },
          {
            httpsAgent: new (require('https').Agent)({
              rejectUnauthorized: false
            })
          }
        );

        if (response.data.isValid) {
          console.log('✅ JWT válido, autenticação bem-sucedida');
          const jwtAddress = resolveJwtAddress(response.data.payload);

          if (!jwtAddress || !ethers.isAddress(jwtAddress)) {
            return sendError(
              res,
              401,
              ERROR_CODES.UNAUTHORIZED,
              'JWT payload is valid but does not contain a valid EVM address.',
            );
          }

          // Verifica se o endereço do JWT corresponde ao endereço fornecido
          if (requestedAddress && jwtAddress.toLowerCase() !== String(requestedAddress).toLowerCase()) {
            return sendError(res, 401, ERROR_CODES.UNAUTHORIZED, 'JWT address does not match the provided address');
          }

          // Adiciona informações verificadas ao request
          req.verifiedAddress = jwtAddress.toLowerCase();
          req.authMode = 'jwt';
          req.user = response.data.payload;
          req.signatureData = {
            address: jwtAddress.toLowerCase(),
            message,
            timestamp: timestamp || Date.now(),
            walletType: walletType || 'smart_wallet',
            isSmartWallet: true,
            authenticatedViaJWT: true
          };

          console.log(`🔐 Autenticação via JWT para endereço: ${jwtAddress}`);
          return next();
        }
      } catch (jwtError) {
        console.error('⚠️ Falha na validação JWT:', jwtError.response?.data?.message || jwtError.message);
        // Continua para tentar autenticação por assinatura
      }
    }

    // LÓGICA ORIGINAL: Autenticação por assinatura
    console.log('🔐 Tentando autenticação via assinatura...');

    const normalizedAddress = asNonEmptyString(address);
    const normalizedSignature = asNonEmptyString(signature);
    const normalizedMessage = asNonEmptyString(message);

    // Verificação de assinatura obrigatória
    if (!normalizedAddress || !normalizedSignature || !normalizedMessage) {
      return res.status(400).json({
        error: 'Parâmetros inválidos',
        required: ['address', 'signature', 'message'],
        received: {
          address: !!normalizedAddress,
          signature: !!normalizedSignature,
          message: !!normalizedMessage
        }
      });
    }

    // Verifica se o timestamp não expirou
    if (timestamp && Date.now() - timestamp > SECURITY.SIGNATURE_EXPIRY) {
      return sendError(res, 401, ERROR_CODES.TOKEN_EXPIRED, 'Signature expired. Must be used within 5 minutes.');
    }

    // Verifica se o endereço é válido
    if (!ethers.isAddress(normalizedAddress)) {
      return res.status(400).json({
        error: 'Endereço de wallet inválido',
        address: normalizedAddress
      });
    }

    // Recupera o endereço da assinatura
    let recoveredAddress;
    try {
      recoveredAddress = ethers.verifyMessage(normalizedMessage, normalizedSignature);
    } catch (error) {
      return sendError(res, 400, ERROR_CODES.INVALID_SIGNATURE, 'Invalid signature format.');
    }

    // Verifica se o endereço recuperado corresponde ao endereço fornecido
    if (recoveredAddress.toLowerCase() !== normalizedAddress.toLowerCase()) {
      return sendError(res, 401, ERROR_CODES.INVALID_SIGNATURE, 'Signature does not match the provided address.');
    }

    // Replay protection: reject reused signatures
    const sigKey = normalizedSignature.toLowerCase();
    if (usedSignatures.has(sigKey)) {
      return sendError(res, 401, ERROR_CODES.INVALID_SIGNATURE, 'Signature already used (replay detected).');
    }
    usedSignatures.set(sigKey, Date.now());

    // Adiciona informações verificadas ao request (smart wallet only)
    req.verifiedAddress = normalizedAddress.toLowerCase();
    req.authMode = 'smart_wallet';
    req.signatureData = {
      address: normalizedAddress.toLowerCase(),
      message: normalizedMessage,
      timestamp: timestamp || Date.now(),
      walletType: 'smart_wallet',
      isSmartWallet: true
    };

    console.log(`🔐 Autenticação via smart_wallet para endereço: ${normalizedAddress}`);
    next();
  } catch (error) {
    console.error('Erro na verificação de assinatura:', error);
    res.status(500).json({
      error: 'Erro interno na verificação de assinatura',
      details: error.message
    });
  }
}

/**
 * Middleware para verificar se o usuário tem saldo suficiente
 */
function checkBalance(requiredAmount, tokenAddress = null) {
  return async (req, res, next) => {
    try {
      const { address } = req.body;
      
      if (!address) {
        return res.status(400).json({
          error: 'Endereço de wallet é obrigatório'
        });
      }

      // Aqui você pode implementar a lógica para verificar o saldo
      // Por enquanto, apenas passa para o próximo middleware
      req.requiredAmount = requiredAmount;
      req.tokenAddress = tokenAddress;
      
      next();
    } catch (error) {
      console.error('Erro na verificação de saldo:', error);
      res.status(500).json({
        error: 'Erro ao verificar saldo',
        details: error.message
      });
    }
  };
}

/**
 * Middleware para validar parâmetros de swap
 */
function validateSwapParams(req, res, next) {
  try {
    const { tokenIn, tokenOut, amountIn, slippage } = req.body;

    // Validação dos parâmetros obrigatórios
    if (!tokenIn || !tokenOut || !amountIn) {
      return res.status(400).json({
        error: 'Parâmetros obrigatórios ausentes',
        required: ['tokenIn', 'tokenOut', 'amountIn'],
        received: { tokenIn: !!tokenIn, tokenOut: !!tokenOut, amountIn: !!amountIn }
      });
    }

    // Validação dos endereços dos tokens
    if (!ethers.isAddress(tokenIn)) {
      return res.status(400).json({
        error: 'Endereço do token de entrada inválido',
        tokenIn
      });
    }

    if (!ethers.isAddress(tokenOut)) {
      return res.status(400).json({
        error: 'Endereço do token de saída inválido',
        tokenOut
      });
    }

    // Validação do valor de entrada
    if (isNaN(amountIn) || parseFloat(amountIn) <= 0) {
      return res.status(400).json({
        error: 'Valor de entrada deve ser um número positivo',
        amountIn
      });
    }

    // Validação do slippage
    if (slippage !== undefined) {
      if (isNaN(slippage) || slippage < 0 || slippage > 50) {
        return res.status(400).json({
          error: 'Slippage deve estar entre 0 e 50%',
          slippage
        });
      }
    }

    // Validação de valores mínimos e máximos
    const amountInFloat = parseFloat(amountIn);
    if (amountInFloat < parseFloat(SECURITY.MIN_AMOUNT)) {
      return sendError(res, 400, ERROR_CODES.AMOUNT_TOO_SMALL, `Minimum amount is ${SECURITY.MIN_AMOUNT}`);
    }

    if (amountInFloat > parseFloat(SECURITY.MAX_AMOUNT)) {
      return sendError(res, 400, ERROR_CODES.AMOUNT_TOO_LARGE, `Maximum amount is ${SECURITY.MAX_AMOUNT}`);
    }

    next();
  } catch (error) {
    console.error('Erro na validação dos parâmetros de swap:', error);
    res.status(500).json({
      error: 'Erro interno na validação',
      details: error.message
    });
  }
}

/**
 * Middleware para rate limiting personalizado
 */
function createRateLimiter(maxRequests, windowMs) {
  const requests = new Map();

  return (req, res, next) => {
    const clientId = req.verifiedAddress || req.ip;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Limpa requisições antigas
    if (requests.has(clientId)) {
      requests.set(clientId, requests.get(clientId).filter(timestamp => timestamp > windowStart));
    } else {
      requests.set(clientId, []);
    }

    const clientRequests = requests.get(clientId);

    if (clientRequests.length >= maxRequests) {
      return sendError(res, 429, ERROR_CODES.RATE_LIMITED,
        `Rate limit exceeded. Max ${maxRequests} requests per ${windowMs / 1000}s`,
        { retryAfter: Math.ceil(windowMs / 1000) }
      );
    }

    // Adiciona timestamp da requisição atual
    clientRequests.push(now);
    next();
  };
}

/**
 * Middleware para logging de requisições
 */
function requestLogger(req, res, next) {
  const start = Date.now();
  
  // Log da requisição
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${req.ip}`);
  
  // Log da resposta
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
  });

  next();
}

/**
 * Middleware para validação de rede
 */
function validateNetwork(network) {
  return (req, res, next) => {
    const { chainId } = req.body;
    
    if (chainId && chainId !== network.chainId) {
      return res.status(400).json({
        error: 'Rede incorreta',
        expected: network.chainId,
        received: chainId,
        networkName: network.name
      });
    }

    next();
  };
}

/**
 * Middleware para sanitização de dados
 */
function sanitizeInput(req, res, next) {
  // Sanitiza endereços de wallet
  if (req.body.address) {
    req.body.address = req.body.address.toLowerCase();
  }

  // Sanitiza endereços de tokens
  if (req.body.tokenIn) {
    req.body.tokenIn = req.body.tokenIn.toLowerCase();
  }

  if (req.body.tokenOut) {
    req.body.tokenOut = req.body.tokenOut.toLowerCase();
  }

  // Converte valores numéricos
  if (req.body.amountIn) {
    req.body.amountIn = parseFloat(req.body.amountIn);
  }

  if (req.body.slippage) {
    req.body.slippage = parseFloat(req.body.slippage);
  }

  next();
}

/**
 * Middleware para preparar dados de transação (smart wallet only)
 */
function prepareTransactionData(req, res, next) {
  req.walletType = 'smart_wallet';
  req.isSmartWallet = true;

  // Security: strip privateKey if present
  if (req.body.privateKey) {
    delete req.body.privateKey;
  }

  next();
}

module.exports = {
  verifySignature,
  checkBalance,
  validateSwapParams,
  createRateLimiter,
  requestLogger,
  validateNetwork,
  sanitizeInput,
  prepareTransactionData
};
