const express = require('express');
const { ethers } = require('ethers');
const ValidationService = require('../services/validationService');
const { 
  verifySignature, 
  createRateLimiter,
  sanitizeInput
} = require('../middleware/auth');
const { NETWORKS } = require('../config/constants');
const { createAvalancheProvider } = require('../lib/provider');

const router = express.Router();

// Rate limiting
const validationSwapRateLimiter = createRateLimiter(20, 15 * 60 * 1000); // 20 requests por 15 minutos

/**
 * @route POST /validateAndSwap
 * @desc Prepara transações de validação + swap para assinatura no frontend
 * @access Private (com transação assinada)
 *
 * COMO CHAMAR:
 * POST /validation-swap/validateAndSwap
 *
 * Headers: Content-Type: application/json
 * Body: {
 *   "address": "0x1234567890abcdef1234567890abcdef12345678",
 *   "signature": "0xabcd...",
 *   "message": "Validate and swap\nTimestamp: 1234567890",
 *   "timestamp": 1234567890,
 *   "amount": "1000000000000000000",
 *   "tokenIn": "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
 *   "tokenOut": "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"
 * }
 *
 * Parâmetros obrigatórios:
 * - amount: Montante em wei para validação
 * - tokenIn: Endereço do token de entrada
 * - tokenOut: Endereço do token de saída
 *
 * Retorna dados das transações para assinatura no frontend (smart wallet)
 */
router.post('/validateAndSwap',
  verifySignature,
  validationSwapRateLimiter,
  sanitizeInput,
  async (req, res) => {
    try {
      const { amount, tokenIn, tokenOut, rpc } = req.body;

      // Validação dos parâmetros obrigatórios
      if (!amount || !tokenIn || !tokenOut) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'amount, tokenIn e tokenOut são obrigatórios'
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

      const validationService = new ValidationService(provider);

      console.log('🔄 Preparando transações de validação + swap...');

      // Prepara transação de validação
      const validationData = await validationService.preparePayAndValidate(amount);

      res.json({
        status: 200,
        msg: 'success',
        data: {
          validation: {
            ...validationData,
            walletType: 'smart_wallet',
            requiresSignature: true
          },
          swap: {
            tokenIn,
            tokenOut,
            amountIn: validationData.restAmount,
            note: 'Execute o swap após a validação ser confirmada on-chain'
          },
          summary: {
            totalAmount: amount,
            taxPaid: validationData.taxAmount,
            amountForSwap: validationData.restAmount
          },
          walletType: 'smart_wallet',
          requiresSignature: true
        }
      });

    } catch (error) {
      console.error('Erro no validateAndSwap:', error);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro no processo de validação + swap',
          details: error.message
        }
      });
    }
  }
);

/**
 * @route POST /getValidationAndSwapQuote
 * @desc Obtém cotação para validação + swap sem executar
 * @access Public (com autenticação)
 * 
 * COMO CHAMAR:
 * POST /validation-swap/getValidationAndSwapQuote
 * 
 * Headers: Content-Type: application/json
 * Body: {
 *   "address": "0x1234567890abcdef1234567890abcdef12345678",
 *   "signature": "0xabcd...",
 *   "message": "Get validation and swap quote\nTimestamp: 1234567890",
 *   "timestamp": 1234567890,
 *   "amount": "1000000000000000000",
 *   "tokenIn": "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
 *   "tokenOut": "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"
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
 *     "swap": {
 *       "amountOut": "855000000000000000",
 *       "slippage": "5"
 *     },
 *     "summary": {
 *       "totalAmount": "1000000000000000000",
 *       "finalAmount": "855000000000000000"
 *     }
 *   }
 * }
 */
router.post('/getValidationAndSwapQuote', 
  verifySignature, 
  validationSwapRateLimiter,
  sanitizeInput,
  async (req, res) => {
    try {
      const { amount, tokenIn, tokenOut, rpc } = req.body;
      
      // Validação dos parâmetros obrigatórios
      if (!amount || !tokenIn || !tokenOut) {
        return res.status(400).json({
          status: 400,
          msg: 'error',
          data: {
            error: 'amount, tokenIn e tokenOut são obrigatórios'
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
      
      // Simula cotação do swap (aqui você integraria com Trader Joe)
      const estimatedAmountOut = (BigInt(restAmount) * 95n / 100n).toString(); // 5% slippage
      
      res.json({
        status: 200,
        msg: 'success',
        data: {
          validation: {
            taxAmount: taxAmount,
            restAmount: restAmount,
            taxRate: contractInfo.taxRate
          },
          swap: {
            amountIn: restAmount,
            amountOut: estimatedAmountOut,
            slippage: "5"
          },
          summary: {
            totalAmount: amount,
            taxPaid: taxAmount,
            amountSwapped: restAmount,
            finalAmount: estimatedAmountOut,
            totalFees: (BigInt(amount) - BigInt(estimatedAmountOut)).toString()
          }
        }
      });
      
    } catch (error) {
      console.error('Erro ao obter cotação:', error);
      res.status(500).json({
        status: 500,
        msg: 'error',
        data: {
          error: 'Erro ao obter cotação de validação + swap',
          details: error.message
        }
      });
    }
  }
);

module.exports = router;
