const express = require('express');
const { ethers } = require('ethers');
const TraderJoeService = require('../services/traderJoeService');
const { 
  verifySignature, 
  createRateLimiter,
  validateNetwork,
  sanitizeInput
} = require('../middleware/auth');
const { NETWORKS, TRADER_JOE, listTokens, getTokenAddress, addToken } = require('../config/constants');
const { createAvalancheProvider } = require('../lib/provider');

const router = express.Router();

// Rate limiting para rotas do Trader Joe
const traderJoeRateLimiter = createRateLimiter(100, 15 * 60 * 1000); // 100 requests por 15 minutos

/**
 * @route GET /getprice
 * @desc Retorna a cotação de swap para um par de tokens específico
 * @access Public (com autenticação)
 * 
 * COMO CHAMAR:
 * GET /dex/getprice?dexId=2100&path=0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7,0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB&amountIn=1000000000000000000
 * 
 * Headers: Content-Type: application/json
 * Body: {
 *   "privateKey": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
 * }
 * 
 * Parâmetros:
 * - dexId: ID do DEX (deve ser 2100 para Trader Joe)
 * - path: Caminho dos tokens separados por vírgula (tokenIn,tokenOut)
 * - amountIn: Quantidade de entrada em wei
 * - rpc: (opcional) URL do RPC customizado
 * 
 * Exemplo de resposta:
 * {
 *   "status": 200,
 *   "msg": "success",
 *   "data": {
 *     "amountIn": "1000000000000000000",
 *     "path": ["0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB"],
 *     "amountsOut": "1234567890123456789"
 *   }
 * }
 */
router.get('/getprice', 
  verifySignature, 
  traderJoeRateLimiter,
  async (req, res) => {
    try {
      const { rpc, dexId, path, amountIn } = req.query;
      
      // Validação dos parâmetros obrigatórios
      if (!dexId || !path || !amountIn) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'dexId, path e amountIn são obrigatórios'
          }
        });
      }

      // Validação do dexId (deve ser 2100 para Trader Joe)
      if (dexId !== '2100') {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'dexId deve ser 2100 para Trader Joe'
          }
        });
      }

      // Parse do path (comma separated values)
      const tokenPath = path.split(',').map(addr => addr.trim());
      
      if (tokenPath.length < 2) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'path deve conter pelo menos 2 endereços de token'
          }
        });
      }

      // Usa RPC fornecido ou padrão
      const provider = createAvalancheProvider({ rpcUrlOverride: rpc });
      
      // Usa o endereço verificado pela assinatura
      const traderJoeService = new TraderJoeService(provider, req.verifiedAddress);

      // Obtém o preço usando o primeiro e último token do path
      const tokenIn = tokenPath[0];
      const tokenOut = tokenPath[tokenPath.length - 1];
      
      const price = await traderJoeService.getPrice(tokenIn, tokenOut, amountIn);
      
      res.json({
        status: 200,
        msg: 'success',
        data: {
          amountIn: price.amountIn,
          path: tokenPath,
          amountsOut: price.amountOut
        }
      });
    } catch (error) {
      console.error('Erro ao obter preço:', error);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao obter preço',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route GET /getuserliquidity
 * @desc Retorna o saldo de liquidez de um par de tokens específico para uma conta
 * @access Public (com autenticação)
 * 
 * COMO CHAMAR:
 * GET /dex/getuserliquidity?tokenA=0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7&tokenB=0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB&dexId=2100&address=0x6B509c04e3caA2207b8f2A60A067a8ddED03b8d0&id=1
 * 
 * Headers: Content-Type: application/json
 * Body: {
 *   "privateKey": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
 * }
 * 
 * Parâmetros:
 * - tokenA: Endereço do primeiro token do par
 * - tokenB: Endereço do segundo token do par
 * - dexId: ID do DEX (deve ser 2100 para Trader Joe)
 * - address: Endereço da wallet para verificar liquidez
 * - id: ID do pool (opcional)
 * - rpc: (opcional) URL do RPC customizado
 * 
 * Exemplo de resposta:
 * {
 *   "status": 200,
 *   "msg": "success",
 *   "data": {
 *     "pairAddress": "0x0000000000000000000000000000000000000000",
 *     "liquidity": "0",
 *     "tokenA": "0",
 *     "tokenB": "0"
 *   }
 * }
 */
router.get('/getuserliquidity', 
  verifySignature, 
  traderJoeRateLimiter,
  async (req, res) => {
    try {
      const { rpc, tokenA, dexId, tokenB, address, id } = req.query;
      
      // Validação dos parâmetros obrigatórios
      if (!tokenA || !dexId || !tokenB || !address || !id) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'tokenA, dexId, tokenB, address e id são obrigatórios'
          }
        });
      }

      // Validação do dexId
      if (dexId !== '2100') {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'dexId deve ser 2100 para Trader Joe'
          }
        });
      }

      // Usa RPC fornecido ou padrão
      const provider = createAvalancheProvider({ rpcUrlOverride: rpc });
      
      // Usa o endereço verificado pela assinatura
      const traderJoeService = new TraderJoeService(provider, req.verifiedAddress);

      // Obtém informações de liquidez do usuário
      // Nota: Esta é uma implementação simplificada
      // Em produção, você precisaria integrar com a API do Trader Joe para obter dados reais de liquidez
      const liquidityInfo = await traderJoeService.getUserLiquidity(tokenA, tokenB, address, id);
      
      res.json({
        status: 200,
        msg: 'success',
        data: liquidityInfo
      });
    } catch (error) {
      console.error('Erro ao obter liquidez do usuário:', error);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao obter liquidez do usuário',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route GET /getpoolliquidity
 * @desc Retorna a liquidez total de um pool específico
 * @access Public (com autenticação)
 * 
 * COMO CHAMAR:
 * GET /dex/getpoolliquidity?poolAddress=0x0000000000000000000000000000000000000000&dexId=2100&id=1
 * 
 * Headers: Content-Type: application/json
 * Body: {
 *   "privateKey": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
 * }
 * 
 * Parâmetros:
 * - poolAddress: Endereço do pool de liquidez
 * - dexId: ID do DEX (deve ser 2100 para Trader Joe)
 * - id: ID do pool
 * - rpc: (opcional) URL do RPC customizado
 * 
 * Exemplo de resposta:
 * {
 *   "status": 200,
 *   "msg": "success",
 *   "data": {
 *     "totalLiquidity": "0"
 *   }
 * }
 */
router.get('/getpoolliquidity', 
  verifySignature, 
  traderJoeRateLimiter,
  async (req, res) => {
    try {
      const { rpc, poolAddress, dexId, id } = req.query;
      
      // Validação dos parâmetros obrigatórios
      if (!poolAddress || !dexId || !id) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'poolAddress, dexId e id são obrigatórios'
          }
        });
      }

      // Validação do dexId
      if (dexId !== '2100') {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'dexId deve ser 2100 para Trader Joe'
          }
        });
      }

      // Usa RPC fornecido ou padrão
      const provider = createAvalancheProvider({ rpcUrlOverride: rpc });
      // Usa o endereço verificado pela assinatura
      const traderJoeService = new TraderJoeService(provider, req.verifiedAddress);

      // Obtém liquidez total do pool
      const poolLiquidity = await traderJoeService.getPoolLiquidity(poolAddress, id);
      
      res.json({
        status: 200,
        msg: 'success',
        data: poolLiquidity
      });
    } catch (error) {
      console.error('Erro ao obter liquidez do pool:', error);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao obter liquidez do pool',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route GET /gettokenliquidity
 * @desc Retorna a liquidez individual dos tokens dentro de um pool específico
 * @access Public (com autenticação)
 * 
 * COMO CHAMAR:
 * GET /dex/gettokenliquidity?poolAddress=0x0000000000000000000000000000000000000000&dexId=2100
 * 
 * Headers: Content-Type: application/json
 * Body: {
 *   "privateKey": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
 * }
 * 
 * Parâmetros:
 * - poolAddress: Endereço do pool de liquidez
 * - dexId: ID do DEX (deve ser 2100 para Trader Joe)
 * - rpc: (opcional) URL do RPC customizado
 * 
 * Exemplo de resposta:
 * {
 *   "status": 200,
 *   "msg": "success",
 *   "data": {
 *     "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7": "0",
 *     "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB": "0"
 *   }
 * }
 */
router.get('/gettokenliquidity', 
  verifySignature, 
  traderJoeRateLimiter,
  async (req, res) => {
    try {
      const { rpc, poolAddress, dexId } = req.query;
      
      // Validação dos parâmetros obrigatórios
      if (!poolAddress || !dexId) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'poolAddress e dexId são obrigatórios'
          }
        });
      }

      // Validação do dexId
      if (dexId !== '2100') {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'dexId deve ser 2100 para Trader Joe'
          }
        });
      }

      // Usa RPC fornecido ou padrão
      const provider = createAvalancheProvider({ rpcUrlOverride: rpc });
      // Usa o endereço verificado pela assinatura
      const traderJoeService = new TraderJoeService(provider, req.verifiedAddress);

      // Obtém liquidez individual dos tokens
      const tokenLiquidity = await traderJoeService.getTokenLiquidity(poolAddress);
      
      res.json({
        status: 200,
        msg: 'success',
        data: tokenLiquidity
      });
    } catch (error) {
      console.error('Erro ao obter liquidez dos tokens:', error);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao obter liquidez dos tokens',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route POST /swap
 * @desc Inicia uma transação de swap em um DEX específico
 * @access Private (com transação assinada)
 * 
 * COMO CHAMAR:
 * POST /dex/swap
 * 
 * Headers: Content-Type: application/json
 * Body: {
 *   "privateKey": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
 *   "dexId": "2100",
 *   "path": "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7,0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB",
 *   "amountIn": "1000000000000000000",
 *   "amountOutMin": "950000000000000000",
 *   "to": "0x6B509c04e3caA2207b8f2A60A067a8ddED03b8d0",
 *   "from": "0x6B509c04e3caA2207b8f2A60A067a8ddED03b8d0",
 *   "deadline": 1735689600,
 *   "gas": "500000",
 *   "gasPriority": "medium",
 *   "slippage": 1.0
 *   // A transação será assinada automaticamente usando a privateKey
 * }
 * 
 * Parâmetros obrigatórios:
 * - dexId: ID do DEX (deve ser 2100 para Trader Joe)
 * - path: Caminho dos tokens separados por vírgula
 * - amountIn: Quantidade de entrada em wei
 * - amountOutMin: Quantidade mínima de saída em wei
 * - to: Endereço de destino dos tokens
 * - from: Endereço de origem
 * - deadline: Timestamp de expiração da transação
 * - privateKey: Private key para executar a transação
 * 
 * Parâmetros opcionais:
 * - gas: Limite de gas
 * - gasPriority: Prioridade do gas (low, medium, high)
 * - slippage: Percentual de slippage
 * - rpc: URL do RPC customizado
 * 
 * Exemplo de resposta:
 * {
 *   "status": 200,
 *   "msg": "success",
 *   "data": {
 *     "chainId": "43114",
 *     "from": "0x6B509c04e3caA2207b8f2A60A067a8ddED03b8d0",
 *     "to": "0x60aE616a2155Ee3d9A68541Ba4544862310933d4",
 *     "value": "0",
 *     "gas": "100000",
 *     "data": "0x",
 *     "referenceId": "abc123def456"
 *   }
 * }
 */
router.post('/swap', 
  verifySignature, 
  traderJoeRateLimiter,
  validateNetwork(NETWORKS.AVALANCHE),
  sanitizeInput,
  async (req, res) => {
    try {
      const { 
        dexId, 
        path, 
        amountIn, 
        amountOutMin, 
        to, 
        from, 
        gas, 
        rpc, 
        gasPriority, 
        slippage, 
        deadline,
      } = req.body;
      
      // Validação dos parâmetros obrigatórios
      if (!dexId || !path || !amountIn || !amountOutMin || !to || !from || !deadline) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'dexId, path, amountIn, amountOutMin, to, from e deadline são obrigatórios'
          }
        });
      }

      // Validação do dexId
      if (dexId !== '2100') {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'dexId deve ser 2100 para Trader Joe'
          }
        });
      }

      // Usa RPC fornecido ou padrão
      const provider = createAvalancheProvider({ rpcUrlOverride: rpc });
      // Usa o endereço verificado pela assinatura
      const traderJoeService = new TraderJoeService(provider, req.verifiedAddress);

      // Para smart wallet, a assinatura já foi verificada no middleware

      // Executa o swap
      const swapResult = await traderJoeService.executeSwap({
        path,
        amountIn,
        amountOutMin,
        to,
        from,
        gas,
        gasPriority,
        slippage,
        deadline,
      });
      
      res.json({
        status: 200,
        msg: 'success',
        data: swapResult
      });
    } catch (error) {
      console.error('Erro ao executar swap:', error);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao executar swap',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route POST /addliquidity
 * @desc Adiciona liquidez a um pool específico em um DEX específico
 * @access Private (com transação assinada)
 * 
 * COMO CHAMAR:
 * POST /dex/addliquidity
 * 
 * Headers: Content-Type: application/json
 * Body: {
 *   "privateKey": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
 *   "dexId": "2100",
 *   "tokenA": "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
 *   "tokenB": "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB",
 *   "amountA": "1000000000000000000",
 *   "amountB": "2000000000000000000",
 *   "amountAMin": "950000000000000000",
 *   "amountBMin": "1900000000000000000",
 *   "deadline": 1735689600,
 *   "to": "0x6B509c04e3caA2207b8f2A60A067a8ddED03b8d0",
 *   "from": "0x6B509c04e3caA2207b8f2A60A067a8ddED03b8d0",
 *   "gas": "530000",
 *   "gasPriority": "medium",
 *   "slippage": 1.0,
 *   "strategy": "standard"
 *   // A transação será assinada automaticamente usando a privateKey
 * }
 * 
 * Parâmetros obrigatórios:
 * - dexId: ID do DEX (deve ser 2100 para Trader Joe)
 * - tokenA: Endereço do primeiro token
 * - tokenB: Endereço do segundo token
 * - amountA: Quantidade do token A em wei
 * - amountB: Quantidade do token B em wei
 * - amountAMin: Quantidade mínima do token A
 * - amountBMin: Quantidade mínima do token B
 * - deadline: Timestamp de expiração da transação
 * - to: Endereço de destino
 * - from: Endereço de origem
 * - privateKey: Private key para executar a transação
 * 
 * Parâmetros opcionais:
 * - gas: Limite de gas
 * - gasPriority: Prioridade do gas (low, medium, high)
 * - slippage: Percentual de slippage
 * - strategy: Estratégia de adição de liquidez
 * - rpc: URL do RPC customizado
 * 
 * Exemplo de resposta:
 * {
 *   "status": 200,
 *   "msg": "success",
 *   "data": {
 *     "chainId": "43114",
 *     "from": "0x6B509c04e3caA2207b8f2A60A067a8ddED03b8d0",
 *     "to": "0x60aE616a2155Ee3d9A68541Ba4544862310933d4",
 *     "value": "0",
 *     "gas": "530000",
 *     "data": "0x",
 *     "referenceId": "abc123def456"
 *   }
 * }
 */
router.post('/addliquidity', 
  verifySignature, 
  traderJoeRateLimiter,
  validateNetwork(NETWORKS.AVALANCHE),
  sanitizeInput,
  async (req, res) => {
    try {
      const { 
        dexId, 
        tokenA, 
        tokenB, 
        amountA, 
        amountB, 
        amountAMin, 
        amountBMin, 
        deadline, 
        to, 
        from, 
        gas, 
        rpc, 
        gasPriority, 
        slippage, 
        strategy,
      } = req.body;
      
      // Validação dos parâmetros obrigatórios
      if (!dexId || !tokenA || !tokenB || !amountA || !amountB || !amountAMin || !amountBMin || !deadline || !to || !from) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'Todos os parâmetros obrigatórios devem ser fornecidos'
          }
        });
      }

      // Validação do dexId
      if (dexId !== '2100') {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'dexId deve ser 2100 para Trader Joe'
          }
        });
      }

      // Usa RPC fornecido ou padrão
      const provider = createAvalancheProvider({ rpcUrlOverride: rpc });
      // Usa o endereço verificado pela assinatura
      const traderJoeService = new TraderJoeService(provider, req.verifiedAddress);

      // Para smart wallet, a assinatura já foi verificada no middleware

      // Adiciona liquidez
      const addLiquidityResult = await traderJoeService.addLiquidity({
        tokenA,
        tokenB,
        amountA,
        amountB,
        amountAMin,
        amountBMin,
        deadline,
        to,
        from,
        gas,
        gasPriority,
        slippage,
        strategy,
      });
      
      res.json({
        status: 200,
        msg: 'success',
        data: addLiquidityResult
      });
    } catch (error) {
      console.error('Erro ao adicionar liquidez:', error);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao adicionar liquidez',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route POST /removeliquidity
 * @desc Remove liquidez de um pool específico em um DEX específico
 * @access Private (com transação assinada)
 * 
 * COMO CHAMAR:
 * POST /dex/removeliquidity
 * 
 * Headers: Content-Type: application/json
 * Body: {
 *   "privateKey": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
 *   "dexId": "2100",
 *   "tokenA": "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
 *   "tokenB": "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB",
 *   "amountAMin": "950000000000000000",
 *   "amountBMin": "1900000000000000000",
 *   "deadline": 1735689600,
 *   "from": "0x6B509c04e3caA2207b8f2A60A067a8ddED03b8d0",
 *   "to": "0x6B509c04e3caA2207b8f2A60A067a8ddED03b8d0",
 *   "gas": "500000",
 *   "gasPriority": "medium",
 *   "binStep": "25",
 *   "ids": ["1", "2", "3"],
 *   "amounts": ["1000000000000000000", "2000000000000000000", "3000000000000000000"],
 *   "slippage": 1.0
 *   // A transação será assinada automaticamente usando a privateKey
 * }
 * 
 * Parâmetros obrigatórios:
 * - dexId: ID do DEX (deve ser 2100 para Trader Joe)
 * - tokenA: Endereço do primeiro token
 * - tokenB: Endereço do segundo token
 * - amountAMin: Quantidade mínima do token A
 * - amountBMin: Quantidade mínima do token B
 * - deadline: Timestamp de expiração da transação
 * - from: Endereço de origem
 * - to: Endereço de destino
 * - binStep: Passo do bin (para Trader Joe v2)
 * - ids: Array de IDs dos bins
 * - amounts: Array de quantidades para cada bin
 * - privateKey: Private key para executar a transação
 * 
 * Parâmetros opcionais:
 * - gas: Limite de gas
 * - gasPriority: Prioridade do gas (low, medium, high)
 * - slippage: Percentual de slippage
 * - rpc: URL do RPC customizado
 * 
 * Exemplo de resposta:
 * {
 *   "status": 200,
 *   "msg": "success",
 *   "data": {
 *     "chainId": "43114",
 *     "from": "0x6B509c04e3caA2207b8f2A60A067a8ddED03b8d0",
 *     "to": "0x60aE616a2155Ee3d9A68541Ba4544862310933d4",
 *     "value": "0",
 *     "gas": "0",
 *     "data": "0x",
 *     "referenceId": "abc123def456"
 *   }
 * }
 */
router.post('/removeliquidity', 
  verifySignature, 
  traderJoeRateLimiter,
  validateNetwork(NETWORKS.AVALANCHE),
  sanitizeInput,
  async (req, res) => {
    try {
      const { 
        dexId, 
        amountAMin, 
        deadline, 
        from, 
        gas, 
        rpc, 
        tokenA, 
        tokenB, 
        amountBMin, 
        gasPriority, 
        binStep, 
        ids, 
        amounts, 
        to, 
        slippage,
      } = req.body;
      
      // Validação dos parâmetros obrigatórios
      if (!dexId || !amountAMin || !deadline || !from || !tokenA || !tokenB || !amountBMin || !binStep || !ids || !amounts || !to) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'Todos os parâmetros obrigatórios devem ser fornecidos'
          }
        });
      }

      // Validação do dexId
      if (dexId !== '2100') {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'dexId deve ser 2100 para Trader Joe'
          }
        });
      }

      // Usa RPC fornecido ou padrão
      const provider = createAvalancheProvider({ rpcUrlOverride: rpc });
      // Usa o endereço verificado pela assinatura
      const traderJoeService = new TraderJoeService(provider, req.verifiedAddress);

      // Para smart wallet, a assinatura já foi verificada no middleware

      // Remove liquidez
      const removeLiquidityResult = await traderJoeService.removeLiquidity({
        tokenA,
        tokenB,
        amountAMin,
        amountBMin,
        deadline,
        to,
        from,
        gas,
        gasPriority,
        binStep,
        ids,
        amounts,
        slippage,
      });
      
      res.json({
        status: 200,
        msg: 'success',
        data: removeLiquidityResult
      });
    } catch (error) {
      console.error('Erro ao remover liquidez:', error);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao remover liquidez',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route GET /tokens
 * @desc Lista todos os tokens disponíveis
 * @access Public
 */
router.get('/tokens', traderJoeRateLimiter, async (req, res) => {
  try {
    const tokens = listTokens();
    
    res.json({
      status: 200,
      msg: 'success',
      data: {
        tokens: tokens,
        total: tokens.length,
        note: 'Lista de todos os tokens disponíveis na API'
      }
    });
  } catch (error) {
    console.error('❌ Erro ao listar tokens:', error.message);
    res.status(500).json({
      status: 500,
      msg: 'error',
      data: {
        error: 'Erro ao listar tokens',
        details: error.message
      }
    });
  }
});

/**
 * @route GET /tokens/:symbol
 * @desc Obtém o endereço de um token específico
 * @access Public
 */
router.get('/tokens/:symbol', traderJoeRateLimiter, async (req, res) => {
  try {
    const { symbol } = req.params;
    const address = getTokenAddress(symbol);
    
    if (!address) {
      return res.status(404).json({
        status: 404,
        msg: 'error',
        data: {
          error: 'Token não encontrado',
          details: `Token ${symbol} não está disponível`
        }
      });
    }
    
    res.json({
      status: 200,
      msg: 'success',
      data: {
        symbol: symbol.toUpperCase(),
        address: address,
        note: 'Endereço do token solicitado'
      }
    });
  } catch (error) {
    console.error('❌ Erro ao obter token:', error.message);
    res.status(500).json({
      status: 500,
      msg: 'error',
      data: {
        error: 'Erro ao obter token',
        details: error.message
      }
    });
  }
});

module.exports = router;
