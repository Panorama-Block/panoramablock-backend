const express = require('express');
const { ethers } = require('ethers');
const ValidationService = require('../services/validationService');
const BenqiService = require('../services/benqiService');
const { 
  verifySignature, 
  createRateLimiter,
  sanitizeInput,
  prepareTransactionData
} = require('../middleware/auth');
const { NETWORKS, VALIDATION } = require('../config/constants');
const { createAvalancheProvider } = require('../lib/provider');

const router = express.Router();

// Rate limiting
const benqiValidationRateLimiter = createRateLimiter(20, 15 * 60 * 1000); // 20 requests por 15 minutos
const ZERO_ADDRESS_REGEX = /^0x0{40}$/i;

function isValidationContractConfigured() {
  return (
    typeof VALIDATION.CONTRACT_ADDRESS === 'string' &&
    ethers.isAddress(VALIDATION.CONTRACT_ADDRESS) &&
    !ZERO_ADDRESS_REGEX.test(VALIDATION.CONTRACT_ADDRESS)
  );
}

function buildDirectSmartWalletResult({
  actionKey,
  actionData,
  amount,
  amountSummaryKey,
  operationLabel,
}) {
  return {
    validation: null,
    [actionKey]: {
      ...actionData,
      walletType: 'smart_wallet',
      requiresSignature: true,
    },
    summary: {
      totalAmount: amount,
      taxPaid: '0',
      [amountSummaryKey]: amount,
      finalAmount: amount,
      totalFees: '0',
    },
    walletType: 'smart_wallet',
    requiresSignature: true,
    validationBypassed: true,
    note: `Validation contract not configured. Prepared direct ${operationLabel} transaction.`,
  };
}

/**
 * @route POST /validateAndSupply
 * @desc Prepara transações de validação + supply para assinatura no frontend
 * @access Private (com transação assinada)
 *
 * COMO CHAMAR:
 * POST /benqi-validation/validateAndSupply
 *
 * Headers: Content-Type: application/json
 * Body: {
 *   "address": "0x1234567890abcdef1234567890abcdef12345678",
 *   "signature": "0xabcd...",
 *   "message": "Validate and supply\nTimestamp: 1234567890",
 *   "timestamp": 1234567890,
 *   "amount": "1000000000000000000",
 *   "qTokenAddress": "0x4A2c2838c3904D4B0B4a82eD7a3d0d3a0B4a82eD7"
 * }
 *
 * Parâmetros obrigatórios:
 * - amount: Montante em wei para validação
 * - qTokenAddress: Endereço do qToken
 *
 * Retorna dados das transações para assinatura no frontend (smart wallet)
 */
router.post('/validateAndSupply',
  verifySignature,
  prepareTransactionData,
  benqiValidationRateLimiter,
  sanitizeInput,
  async (req, res) => {
    try {
      const { amount, qTokenAddress, rpc } = req.body;

      // Validação dos parâmetros obrigatórios
      if (!amount || !qTokenAddress) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'amount e qTokenAddress são obrigatórios'
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

      const benqiService = new BenqiService(provider);
      const validationConfigured = isValidationContractConfigured();

      if (!validationConfigured) {
        console.warn('[benqi-validation] Validation contract not configured. Falling back to direct supply prepare.');
        const supplyData = await benqiService.prepareSupply(qTokenAddress, amount);
        return res.json({
          status: 200,
          msg: 'success',
          data: buildDirectSmartWalletResult({
            actionKey: 'supply',
            actionData: supplyData,
            amount,
            amountSummaryKey: 'amountSupplied',
            operationLabel: 'supply',
          }),
        });
      }

      const validationService = new ValidationService(provider);

      console.log('🔄 Preparando transações de validação + supply...');

      const validationData = await validationService.preparePayAndValidate(amount);
      const supplyData = await benqiService.prepareSupply(qTokenAddress, validationData.restAmount);

      res.json({
        status: 200,
        msg: 'success',
        data: {
          validation: {
            ...validationData,
            walletType: 'smart_wallet',
            requiresSignature: true
          },
          supply: {
            ...supplyData,
            walletType: 'smart_wallet',
            requiresSignature: true
          },
          summary: {
            totalAmount: amount,
            taxPaid: validationData.taxAmount,
            amountSupplied: validationData.restAmount,
            finalAmount: validationData.restAmount,
            totalFees: (BigInt(amount) - BigInt(validationData.restAmount)).toString()
          },
          walletType: 'smart_wallet',
          requiresSignature: true
        }
      });

    } catch (error) {
      console.error('Erro no validateAndSupply:', error);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro no processo de validação + supply',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route POST /validateAndBorrow
 * @desc Prepara transações de validação + borrow para assinatura no frontend
 * @access Private (com transação assinada)
 *
 * COMO CHAMAR:
 * POST /benqi-validation/validateAndBorrow
 *
 * Headers: Content-Type: application/json
 * Body: {
 *   "address": "0x1234567890abcdef1234567890abcdef12345678",
 *   "signature": "0xabcd...",
 *   "message": "Validate and borrow\nTimestamp: 1234567890",
 *   "timestamp": 1234567890,
 *   "amount": "1000000000000000000",
 *   "qTokenAddress": "0x4A2c2838c3904D4B0B4a82eD7a3d0d3a0B4a82eD7"
 * }
 *
 * Parâmetros obrigatórios:
 * - amount: Montante em wei para validação
 * - qTokenAddress: Endereço do qToken
 *
 * Retorna dados das transações para assinatura no frontend (smart wallet)
 */
router.post('/validateAndBorrow',
  verifySignature,
  prepareTransactionData,
  benqiValidationRateLimiter,
  sanitizeInput,
  async (req, res) => {
    try {
      const { amount, qTokenAddress, rpc } = req.body;

      // Validação dos parâmetros obrigatórios
      if (!amount || !qTokenAddress) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'amount e qTokenAddress são obrigatórios'
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

      const benqiService = new BenqiService(provider);
      const validationConfigured = isValidationContractConfigured();

      if (!validationConfigured) {
        console.warn('[benqi-validation] Validation contract not configured. Falling back to direct borrow prepare.');
        const borrowData = await benqiService.prepareBorrow(qTokenAddress, amount);
        return res.json({
          status: 200,
          msg: 'success',
          data: buildDirectSmartWalletResult({
            actionKey: 'borrow',
            actionData: borrowData,
            amount,
            amountSummaryKey: 'amountBorrowed',
            operationLabel: 'borrow',
          }),
        });
      }

      const validationService = new ValidationService(provider);

      console.log('🔄 Preparando transações de validação + borrow...');

      const validationData = await validationService.preparePayAndValidate(amount);
      const borrowData = await benqiService.prepareBorrow(qTokenAddress, validationData.restAmount);

      res.json({
        status: 200,
        msg: 'success',
        data: {
          validation: {
            ...validationData,
            walletType: 'smart_wallet',
            requiresSignature: true
          },
          borrow: {
            ...borrowData,
            walletType: 'smart_wallet',
            requiresSignature: true
          },
          summary: {
            totalAmount: amount,
            taxPaid: validationData.taxAmount,
            amountBorrowed: validationData.restAmount,
            finalAmount: validationData.restAmount,
            totalFees: (BigInt(amount) - BigInt(validationData.restAmount)).toString()
          },
          walletType: 'smart_wallet',
          requiresSignature: true
        }
      });

    } catch (error) {
      console.error('Erro no validateAndBorrow:', error);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro no processo de validação + borrow',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route POST /getValidationAndSupplyQuote
 * @desc Obtém cotação para validação + supply sem executar
 * @access Public (com autenticação)
 * 
 * COMO CHAMAR:
 * POST /benqi-validation/getValidationAndSupplyQuote
 * 
 * Headers: Content-Type: application/json
 * Body: {
 *   "address": "0x1234567890abcdef1234567890abcdef12345678",
 *   "signature": "0xabcd...",
 *   "message": "Get validation and supply quote\nTimestamp: 1234567890",
 *   "timestamp": 1234567890,
 *   "amount": "1000000000000000000",
 *   "qTokenAddress": "0x4A2c2838c3904D4B0B4a82eD7a3d0d3a0B4a82eD7"
 * }
 * 
 * Exemplo de resposta:
 * {
 *   "status": 200,
 *   "msg": "success",
 *   "data": {
 *     "validation": {
 *       "taxAmount": "100000000000000000",
 *       "restAmount": "900000000000000000",
 *       "taxRate": "10"
 *     },
 *     "supply": {
 *       "amountSupplied": "900000000000000000",
 *       "qTokenAddress": "0x4A2c2838c3904D4B0B4a82eD7a3d0d3a0B4a82eD7"
 *     },
 *     "summary": {
 *       "totalAmount": "1000000000000000000",
 *       "finalAmount": "900000000000000000"
 *     }
 *   }
 * }
 */
router.post('/getValidationAndSupplyQuote', 
  verifySignature, 
  benqiValidationRateLimiter,
  sanitizeInput,
  async (req, res) => {
    try {
      const { amount, qTokenAddress, rpc } = req.body;
      
      // Validação dos parâmetros obrigatórios
      if (!amount || !qTokenAddress) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'amount e qTokenAddress são obrigatórios'
          }
        });
      }

      const provider = createAvalancheProvider({ rpcUrlOverride: rpc });

      const validationService = new ValidationService(provider);
      
      // Obtém informações do contrato e calcula taxa
      const [contractInfo, taxAmount] = await Promise.all([
        validationService.getContractInfo(),
        validationService.calculateTax(amount)
      ]);

      const restAmount = (BigInt(amount) - BigInt(taxAmount)).toString();
      
      res.json({
        status: 200,
        msg: 'success',
        data: {
          validation: {
            taxAmount: taxAmount,
            restAmount: restAmount,
            taxRate: contractInfo.taxRate
          },
          supply: {
            amountSupplied: restAmount,
            qTokenAddress: qTokenAddress
          },
          summary: {
            totalAmount: amount,
            taxPaid: taxAmount,
            amountSupplied: restAmount,
            finalAmount: restAmount,
            totalFees: (BigInt(amount) - BigInt(restAmount)).toString()
          }
        }
      });
      
    } catch (error) {
      console.error('Erro ao obter cotação:', error);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao obter cotação de validação + supply',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route POST /getValidationAndBorrowQuote
 * @desc Obtém cotação para validação + borrow sem executar
 * @access Public (com autenticação)
 * 
 * COMO CHAMAR:
 * POST /benqi-validation/getValidationAndBorrowQuote
 * 
 * Headers: Content-Type: application/json
 * Body: {
 *   "address": "0x1234567890abcdef1234567890abcdef12345678",
 *   "signature": "0xabcd...",
 *   "message": "Get validation and borrow quote\nTimestamp: 1234567890",
 *   "timestamp": 1234567890,
 *   "amount": "1000000000000000000",
 *   "qTokenAddress": "0x4A2c2838c3904D4B0B4a82eD7a3d0d3a0B4a82eD7"
 * }
 * 
 * Exemplo de resposta:
 * {
 *   "status": 200,
 *   "msg": "success",
 *   "data": {
 *     "validation": {
 *       "taxAmount": "100000000000000000",
 *       "restAmount": "900000000000000000",
 *       "taxRate": "10"
 *     },
 *     "borrow": {
 *       "amountBorrowed": "900000000000000000",
 *       "qTokenAddress": "0x4A2c2838c3904D4B0B4a82eD7a3d0d3a0B4a82eD7"
 *     },
 *     "summary": {
 *       "totalAmount": "1000000000000000000",
 *       "finalAmount": "900000000000000000"
 *     }
 *   }
 * }
 */
router.post('/getValidationAndBorrowQuote', 
  verifySignature, 
  benqiValidationRateLimiter,
  sanitizeInput,
  async (req, res) => {
    try {
      const { amount, qTokenAddress, rpc } = req.body;
      
      // Validação dos parâmetros obrigatórios
      if (!amount || !qTokenAddress) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'amount e qTokenAddress são obrigatórios'
          }
        });
      }

      const provider = createAvalancheProvider({ rpcUrlOverride: rpc });

      const validationService = new ValidationService(provider);
      
      // Obtém informações do contrato e calcula taxa
      const [contractInfo, taxAmount] = await Promise.all([
        validationService.getContractInfo(),
        validationService.calculateTax(amount)
      ]);

      const restAmount = (BigInt(amount) - BigInt(taxAmount)).toString();
      
      res.json({
        status: 200,
        msg: 'success',
        data: {
          validation: {
            taxAmount: taxAmount,
            restAmount: restAmount,
            taxRate: contractInfo.taxRate
          },
          borrow: {
            amountBorrowed: restAmount,
            qTokenAddress: qTokenAddress
          },
          summary: {
            totalAmount: amount,
            taxPaid: taxAmount,
            amountBorrowed: restAmount,
            finalAmount: restAmount,
            totalFees: (BigInt(amount) - BigInt(restAmount)).toString()
          }
        }
      });
      
    } catch (error) {
      console.error('Erro ao obter cotação:', error);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao obter cotação de validação + borrow',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route POST /validateAndWithdraw
 * @desc Prepara transações de validação + withdraw para assinatura no frontend
 * @access Private (com transação assinada)
 *
 * COMO CHAMAR:
 * POST /benqi-validation/validateAndWithdraw
 *
 * Headers: Content-Type: application/json
 * Body: {
 *   "address": "0x1234567890abcdef1234567890abcdef12345678",
 *   "signature": "0xabcd...",
 *   "message": "Validate and withdraw\nTimestamp: 1234567890",
 *   "timestamp": 1234567890,
 *   "amount": "1000000000000000000",
 *   "qTokenAddress": "0x4A2c2838c3904D4B0B4a82eD7a3d0d3a0B4a82eD7"
 * }
 *
 * Parâmetros obrigatórios:
 * - amount: Montante em wei para validação
 * - qTokenAddress: Endereço do qToken
 *
 * Retorna dados das transações para assinatura no frontend (smart wallet)
 */
router.post('/validateAndWithdraw',
  verifySignature,
  prepareTransactionData,
  benqiValidationRateLimiter,
  sanitizeInput,
  async (req, res) => {
    try {
      const { amount, qTokenAddress, rpc } = req.body;

      // Validação dos parâmetros obrigatórios
      if (!amount || !qTokenAddress) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'amount e qTokenAddress são obrigatórios'
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

      const benqiService = new BenqiService(provider);
      const validationConfigured = isValidationContractConfigured();

      if (!validationConfigured) {
        console.warn('[benqi-validation] Validation contract not configured. Falling back to direct withdraw prepare.');
        const withdrawData = await benqiService.prepareRedeem(qTokenAddress, amount, true);
        return res.json({
          status: 200,
          msg: 'success',
          data: buildDirectSmartWalletResult({
            actionKey: 'withdraw',
            actionData: withdrawData,
            amount,
            amountSummaryKey: 'amountWithdrawn',
            operationLabel: 'withdraw',
          }),
        });
      }

      const validationService = new ValidationService(provider);

      console.log('🔄 Preparando transações de validação + withdraw...');

      const validationData = await validationService.preparePayAndValidate(amount);
      const withdrawData = await benqiService.prepareRedeem(qTokenAddress, validationData.restAmount, true);

      res.json({
        status: 200,
        msg: 'success',
        data: {
          validation: {
            ...validationData,
            walletType: 'smart_wallet',
            requiresSignature: true
          },
          withdraw: {
            ...withdrawData,
            walletType: 'smart_wallet',
            requiresSignature: true
          },
          summary: {
            totalAmount: amount,
            taxPaid: validationData.taxAmount,
            amountWithdrawn: validationData.restAmount,
            finalAmount: validationData.restAmount,
            totalFees: (BigInt(amount) - BigInt(validationData.restAmount)).toString()
          },
          walletType: 'smart_wallet',
          requiresSignature: true
        }
      });

    } catch (error) {
      console.error('Erro no validateAndWithdraw:', error);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro no processo de validação + withdraw',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route POST /validateAndRepay
 * @desc Prepara transações de validação + repay para assinatura no frontend
 * @access Private (com transação assinada)
 *
 * COMO CHAMAR:
 * POST /benqi-validation/validateAndRepay
 *
 * Headers: Content-Type: application/json
 * Body: {
 *   "address": "0x1234567890abcdef1234567890abcdef12345678",
 *   "signature": "0xabcd...",
 *   "message": "Validate and repay\nTimestamp: 1234567890",
 *   "timestamp": 1234567890,
 *   "amount": "1000000000000000000",
 *   "qTokenAddress": "0x4A2c2838c3904D4B0B4a82eD7a3d0d3a0B4a82eD7"
 * }
 *
 * Parâmetros obrigatórios:
 * - amount: Montante em wei para validação
 * - qTokenAddress: Endereço do qToken
 *
 * Retorna dados das transações para assinatura no frontend (smart wallet)
 */
router.post('/validateAndRepay',
  verifySignature,
  prepareTransactionData,
  benqiValidationRateLimiter,
  sanitizeInput,
  async (req, res) => {
    try {
      const { amount, qTokenAddress, rpc } = req.body;

      // Validação dos parâmetros obrigatórios
      if (!amount || !qTokenAddress) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'amount e qTokenAddress são obrigatórios'
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

      const benqiService = new BenqiService(provider);
      const validationConfigured = isValidationContractConfigured();

      if (!validationConfigured) {
        console.warn('[benqi-validation] Validation contract not configured. Falling back to direct repay prepare.');
        const repayData = await benqiService.prepareRepay(qTokenAddress, amount);
        return res.json({
          status: 200,
          msg: 'success',
          data: buildDirectSmartWalletResult({
            actionKey: 'repay',
            actionData: repayData,
            amount,
            amountSummaryKey: 'amountRepaid',
            operationLabel: 'repay',
          }),
        });
      }

      const validationService = new ValidationService(provider);

      console.log('🔄 Preparando transações de validação + repay...');

      const validationData = await validationService.preparePayAndValidate(amount);
      const repayData = await benqiService.prepareRepay(qTokenAddress, validationData.restAmount);

      res.json({
        status: 200,
        msg: 'success',
        data: {
          validation: {
            ...validationData,
            walletType: 'smart_wallet',
            requiresSignature: true
          },
          repay: {
            ...repayData,
            walletType: 'smart_wallet',
            requiresSignature: true
          },
          summary: {
            totalAmount: amount,
            taxPaid: validationData.taxAmount,
            amountRepaid: validationData.restAmount,
            finalAmount: validationData.restAmount,
            totalFees: (BigInt(amount) - BigInt(validationData.restAmount)).toString()
          },
          walletType: 'smart_wallet',
          requiresSignature: true
        }
      });

    } catch (error) {
      console.error('Erro no validateAndRepay:', error);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro no processo de validação + repay',
          details: error.message
        }
      });
    }
  }
);

module.exports = router;
