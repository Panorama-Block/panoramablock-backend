const express = require('express');
const { ethers } = require('ethers');
const BenqiService = require('../services/benqiService');
const { 
  verifySignature, 
  createRateLimiter,
  validateNetwork,
  sanitizeInput
} = require('../middleware/auth');
const { NETWORKS, BENQI } = require('../config/constants');
const { createAvalancheProvider } = require('../lib/provider');

const router = express.Router();

// Rate limiting para rotas do Benqi
const benqiRateLimiter = createRateLimiter(100, 15 * 60 * 1000); // 100 requests por 15 minutos

/**
 * @route GET /qtokens
 * @desc Lista todos os qTokens disponíveis
 * @access Public
 */
router.get('/qtokens', benqiRateLimiter, async (req, res) => {
  try {
    const qTokens = [
      { symbol: 'qAVAX', address: BENQI.QAVAX, underlying: 'AVAX' },
      { symbol: 'qUSDC', address: BENQI.QUSDC, underlying: 'USDC' },
      { symbol: 'qUSDT', address: BENQI.QUSDT, underlying: 'USDT' },
      { symbol: 'qDAI', address: BENQI.QDAI, underlying: 'DAI' },
      { symbol: 'qWETH', address: BENQI.QWETH, underlying: 'WETH' },
      { symbol: 'qBTC', address: BENQI.QBTC, underlying: 'BTC.b' },
      { symbol: 'qLINK', address: BENQI.QLINK, underlying: 'LINK' },
      { symbol: 'qJOE', address: BENQI.QJOE, underlying: 'JOE' },
      { symbol: 'qQI', address: BENQI.QQI, underlying: 'QI' },
      { symbol: 'qCOQ', address: BENQI.QCOQ, underlying: 'COQ' }
    ];
    
    res.json({
      status: 200,
      msg: 'success',
      data: {
        qTokens: qTokens,
        total: qTokens.length,
        note: 'Lista de todos os qTokens disponíveis no Benqi'
      }
    });
  } catch (error) {
    console.error('❌ Erro ao listar qTokens:', error.message);
    res.status(500).json({
      status: 500,
      msg: 'error',
      data: {
        error: 'Erro ao listar qTokens',
        details: error.message
      }
    });
  }
});

/**
 * @route GET /qtokens/:address
 * @desc Obtém informações de um qToken específico
 * @access Public (com autenticação)
 */
router.get('/qtokens/:address', 
  verifySignature, 
  benqiRateLimiter,
  async (req, res) => {
    try {
      const { address } = req.params;
      const { rpc } = req.body;
      
      if (!ethers.isAddress(address)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'Endereço do qToken inválido',
            address
          }
        });
      }

      const provider = createAvalancheProvider({ rpcUrlOverride: rpc });

      const benqiService = new BenqiService(provider);
      const qTokenInfo = await benqiService.getQTokenInfo(address);
      
      res.json({
        status: 200,
        msg: 'success',
        data: qTokenInfo
      });
    } catch (error) {
      console.error('❌ Erro ao obter informações do qToken:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao obter informações do qToken',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route GET /qtokens/:address/rates
 * @desc Obtém taxas de juros de um qToken
 * @access Public (com autenticação)
 */
router.get('/qtokens/:address/rates', 
  verifySignature, 
  benqiRateLimiter,
  async (req, res) => {
    try {
      const { address } = req.params;
      const { rpc } = req.body;
      
      if (!ethers.isAddress(address)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'Endereço do qToken inválido',
            address
          }
        });
      }

      const provider = createAvalancheProvider({ rpcUrlOverride: rpc });

      const benqiService = new BenqiService(provider);
      const rates = await benqiService.getInterestRates(address);
      
      res.json({
        status: 200,
        msg: 'success',
        data: rates
      });
    } catch (error) {
      console.error('❌ Erro ao obter taxas de juros:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao obter taxas de juros',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route GET /account/:address/liquidity
 * @desc Obtém liquidez da conta
 * @access Public (com autenticação)
 */
router.get('/account/:address/liquidity', 
  verifySignature, 
  benqiRateLimiter,
  async (req, res) => {
    try {
      const { address } = req.params;
      const { rpc } = req.body;
      
      if (!ethers.isAddress(address)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'Endereço da conta inválido',
            address
          }
        });
      }

      const provider = createAvalancheProvider({ rpcUrlOverride: rpc });

      const benqiService = new BenqiService(provider);
      const liquidity = await benqiService.getAccountLiquidity(address);
      
      res.json({
        status: 200,
        msg: 'success',
        data: liquidity
      });
    } catch (error) {
      console.error('❌ Erro ao obter liquidez da conta:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao obter liquidez da conta',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route GET /account/:address/assets
 * @desc Obtém ativos em uso pela conta
 * @access Public (com autenticação)
 */
router.get('/account/:address/assets', 
  verifySignature, 
  benqiRateLimiter,
  async (req, res) => {
    try {
      const { address } = req.params;
      const { rpc } = req.body;
      
      if (!ethers.isAddress(address)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'Endereço da conta inválido',
            address
          }
        });
      }

      const provider = createAvalancheProvider({ rpcUrlOverride: rpc });

      const benqiService = new BenqiService(provider);
      const assets = await benqiService.getAssetsIn(address);
      
      res.json({
        status: 200,
        msg: 'success',
        data: assets
      });
    } catch (error) {
      console.error('❌ Erro ao obter ativos da conta:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao obter ativos da conta',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route GET /account/:address/balance/:qTokenAddress
 * @desc Obtém saldo de um qToken para uma conta
 * @access Public (com autenticação)
 */
router.get('/account/:address/balance/:qTokenAddress', 
  verifySignature, 
  benqiRateLimiter,
  async (req, res) => {
    try {
      const { address, qTokenAddress } = req.params;
      const { rpc } = req.body;
      
      if (!ethers.isAddress(address) || !ethers.isAddress(qTokenAddress)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'Endereços inválidos',
            address,
            qTokenAddress
          }
        });
      }

      const provider = createAvalancheProvider({ rpcUrlOverride: rpc });

      const benqiService = new BenqiService(provider);
      const balance = await benqiService.getQTokenBalance(qTokenAddress, address);
      
      res.json({
        status: 200,
        msg: 'success',
        data: balance
      });
    } catch (error) {
      console.error('❌ Erro ao obter saldo do qToken:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao obter saldo do qToken',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route GET /account/:address/borrow/:qTokenAddress
 * @desc Obtém saldo de empréstimo de um qToken
 * @access Public (com autenticação)
 */
router.get('/account/:address/borrow/:qTokenAddress', 
  verifySignature, 
  benqiRateLimiter,
  async (req, res) => {
    try {
      const { address, qTokenAddress } = req.params;
      const { rpc } = req.body;
      
      if (!ethers.isAddress(address) || !ethers.isAddress(qTokenAddress)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'Endereços inválidos',
            address,
            qTokenAddress
          }
        });
      }

      const provider = createAvalancheProvider({ rpcUrlOverride: rpc });

      const benqiService = new BenqiService(provider);
      const borrowBalance = await benqiService.getBorrowBalance(qTokenAddress, address);
      
      res.json({
        status: 200,
        msg: 'success',
        data: borrowBalance
      });
    } catch (error) {
      console.error('❌ Erro ao obter saldo de empréstimo:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao obter saldo de empréstimo',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route GET /account/:address/info
 * @desc Obtém informações completas da conta
 * @access Public (com autenticação)
 */
router.get('/account/:address/info', 
  verifySignature, 
  benqiRateLimiter,
  async (req, res) => {
    try {
      const { address } = req.params;
      const { rpc } = req.body;
      
      if (!ethers.isAddress(address)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'Endereço da conta inválido',
            address
          }
        });
      }

      const provider = createAvalancheProvider({ rpcUrlOverride: rpc });

      const benqiService = new BenqiService(provider);
      const accountInfo = await benqiService.getAccountInfo(address);
      
      res.json({
        status: 200,
        msg: 'success',
        data: accountInfo
      });
    } catch (error) {
      console.error('❌ Erro ao obter informações da conta:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao obter informações da conta',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route POST /supply
 * @desc Prepara transação de supply (depósito)
 * @access Private (com transação assinada)
 */
router.post('/supply', 
  verifySignature, 
  benqiRateLimiter,
  validateNetwork(NETWORKS.AVALANCHE),
  sanitizeInput,
  async (req, res) => {
    try {
      const { qTokenAddress, amount, rpc } = req.body;
      
      // Validação dos parâmetros obrigatórios
      if (!qTokenAddress || !amount) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'qTokenAddress e amount são obrigatórios'
          }
        });
      }

      // Valida o formato do amount
      if (!/^\d+$/.test(amount)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'amount deve ser um número inteiro em wei'
          }
        });
      }

      const provider = createAvalancheProvider({ rpcUrlOverride: rpc });

      const benqiService = new BenqiService(provider, req.verifiedAddress);
      const transactionData = await benqiService.prepareSupply(qTokenAddress, amount);
      
      res.json({
        status: 200,
        msg: 'success',
        data: transactionData
      });
    } catch (error) {
      console.error('❌ Erro ao preparar supply:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao preparar supply',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route POST /redeem
 * @desc Prepara transação de redeem (saque)
 * @access Private (com transação assinada)
 */
router.post('/redeem', 
  verifySignature, 
  benqiRateLimiter,
  validateNetwork(NETWORKS.AVALANCHE),
  sanitizeInput,
  async (req, res) => {
    try {
      const { qTokenAddress, amount, isUnderlying, rpc } = req.body;
      
      // Validação dos parâmetros obrigatórios
      if (!qTokenAddress || !amount) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'qTokenAddress e amount são obrigatórios'
          }
        });
      }

      // Valida o formato do amount
      if (!/^\d+$/.test(amount)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'amount deve ser um número inteiro em wei'
          }
        });
      }

      const provider = createAvalancheProvider({ rpcUrlOverride: rpc });

      const benqiService = new BenqiService(provider, req.verifiedAddress);
      const transactionData = await benqiService.prepareRedeem(qTokenAddress, amount, isUnderlying || false);
      
      res.json({
        status: 200,
        msg: 'success',
        data: transactionData
      });
    } catch (error) {
      console.error('❌ Erro ao preparar redeem:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao preparar redeem',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route POST /borrow
 * @desc Prepara transação de borrow (empréstimo)
 * @access Private (com transação assinada)
 */
router.post('/borrow', 
  verifySignature, 
  benqiRateLimiter,
  validateNetwork(NETWORKS.AVALANCHE),
  sanitizeInput,
  async (req, res) => {
    try {
      const { qTokenAddress, amount, rpc } = req.body;
      
      // Validação dos parâmetros obrigatórios
      if (!qTokenAddress || !amount) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'qTokenAddress e amount são obrigatórios'
          }
        });
      }

      // Valida o formato do amount
      if (!/^\d+$/.test(amount)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'amount deve ser um número inteiro em wei'
          }
        });
      }

      const provider = createAvalancheProvider({ rpcUrlOverride: rpc });

      const benqiService = new BenqiService(provider, req.verifiedAddress);
      const transactionData = await benqiService.prepareBorrow(qTokenAddress, amount);
      
      res.json({
        status: 200,
        msg: 'success',
        data: transactionData
      });
    } catch (error) {
      console.error('❌ Erro ao preparar borrow:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao preparar borrow',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route POST /repay
 * @desc Prepara transação de repay (pagamento de empréstimo)
 * @access Private (com transação assinada)
 */
router.post('/repay', 
  verifySignature, 
  benqiRateLimiter,
  validateNetwork(NETWORKS.AVALANCHE),
  sanitizeInput,
  async (req, res) => {
    try {
      const { qTokenAddress, amount, rpc } = req.body;
      
      // Validação dos parâmetros obrigatórios
      if (!qTokenAddress || !amount) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'qTokenAddress e amount são obrigatórios'
          }
        });
      }

      // Valida o formato do amount
      if (!/^\d+$/.test(amount)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'amount deve ser um número inteiro em wei'
          }
        });
      }

      const provider = createAvalancheProvider({ rpcUrlOverride: rpc });

      const benqiService = new BenqiService(provider, req.verifiedAddress);
      const transactionData = await benqiService.prepareRepay(qTokenAddress, amount);
      
      res.json({
        status: 200,
        msg: 'success',
        data: transactionData
      });
    } catch (error) {
      console.error('❌ Erro ao preparar repay:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao preparar repay',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route POST /enterMarkets
 * @desc Prepara transação de enterMarkets
 * @access Private (com transação assinada)
 */
router.post('/enterMarkets', 
  verifySignature, 
  benqiRateLimiter,
  validateNetwork(NETWORKS.AVALANCHE),
  sanitizeInput,
  async (req, res) => {
    try {
      const { qTokenAddresses, rpc } = req.body;
      
      // Validação dos parâmetros obrigatórios
      if (!qTokenAddresses || !Array.isArray(qTokenAddresses) || qTokenAddresses.length === 0) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'qTokenAddresses deve ser um array não vazio'
          }
        });
      }

      // Valida todos os endereços
      for (const address of qTokenAddresses) {
        if (!ethers.isAddress(address)) {
          return res.status(400).json({
            status: 400,
            msg: 'error',
            data: {
              error: 'Endereço de qToken inválido',
              address
            }
          });
        }
      }

      const provider = createAvalancheProvider({ rpcUrlOverride: rpc });

      const benqiService = new BenqiService(provider, req.verifiedAddress);
      const transactionData = await benqiService.prepareEnterMarkets(qTokenAddresses);
      
      res.json({
        status: 200,
        msg: 'success',
        data: transactionData
      });
    } catch (error) {
      console.error('❌ Erro ao preparar enterMarkets:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao preparar enterMarkets',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route POST /exitMarket
 * @desc Prepara transação de exitMarket
 * @access Private (com transação assinada)
 */
router.post('/exitMarket', 
  verifySignature, 
  benqiRateLimiter,
  validateNetwork(NETWORKS.AVALANCHE),
  sanitizeInput,
  async (req, res) => {
    try {
      const { qTokenAddress, rpc } = req.body;
      
      // Validação dos parâmetros obrigatórios
      if (!qTokenAddress) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'qTokenAddress é obrigatório'
          }
        });
      }

      if (!ethers.isAddress(qTokenAddress)) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'Endereço de qToken inválido',
            qTokenAddress
          }
        });
      }

      const provider = createAvalancheProvider({ rpcUrlOverride: rpc });

      const benqiService = new BenqiService(provider, req.verifiedAddress);
      const transactionData = await benqiService.prepareExitMarket(qTokenAddress);
      
      res.json({
        status: 200,
        msg: 'success',
        data: transactionData
      });
    } catch (error) {
      console.error('❌ Erro ao preparar exitMarket:', error.message);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao preparar exitMarket',
          details: error.message
        }
      });
    }
  }
);

module.exports = router;
