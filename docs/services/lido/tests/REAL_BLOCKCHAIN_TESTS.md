# Real Blockchain Tests

This directory contains tests that execute **REAL transactions** on the Ethereum blockchain using actual private keys and gas fees.

## ⚠️ WARNING

**These tests will execute REAL transactions on the blockchain and cost real gas fees!**

- Make sure you have sufficient ETH for testing
- Transactions will cost real gas fees
- Use only test amounts (small amounts)
- Never use mainnet private keys with significant funds

## Test Scripts

### 1. `real-blockchain-test.sh` - Bash Real Blockchain Test
Simple bash script for testing real blockchain transactions.

```bash
./tests/real-blockchain-test.sh
```

**Features:**
- Real blockchain interaction
- Transaction execution
- Position checking
- Protocol info retrieval

### 2. `real-blockchain-test.js` - Node.js Real Blockchain Test
Advanced JavaScript test suite with real blockchain transactions.

```bash
node tests/real-blockchain-test.js
```

**Features:**
- Wallet initialization
- Balance checking
- Real transaction execution
- Comprehensive testing

### 3. `execute-real-transactions.js` - Real Transaction Executor
Dedicated script for executing real blockchain transactions.

```bash
node tests/execute-real-transactions.js
```

**Features:**
- Real stake transactions
- Real unstake transactions
- Real claim rewards transactions
- Transaction tracking
- Position monitoring

## Prerequisites

### Required Dependencies
```bash
npm install axios ethers dotenv
```

### Environment Variables
Make sure your `.env` file contains:
```env
ETHEREUM_RPC_URL=https://rpc.ankr.com/eth
JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_jwt_refresh_secret
```

### Private Key Configuration
The tests use a hardcoded private key for testing:
```
0x74d5c8282d223d273bab24b323dbe320c9528b586397c90abe11b9295bc684e4
```

**⚠️ This is a TEST private key - never use it with real funds!**

## Test Configuration

### Default Settings
- **Private Key**: `0x74d5c8282d223d273bab24b323dbe320c9528b586397c90abe11b9295bc684e4`
- **Test Amount**: `0.001 ETH`
- **RPC URL**: `https://rpc.ankr.com/eth`
- **API URL**: `http://localhost:3004`

### Customizing Tests
You can modify the test scripts to use different:
- Private keys (for different test wallets)
- Test amounts (smaller or larger)
- RPC URLs (different networks)
- API URLs (different environments)

## Running Real Blockchain Tests

### Quick Test (Bash)
```bash
./tests/real-blockchain-test.sh
```

### Advanced Test (Node.js)
```bash
node tests/real-blockchain-test.js
```

### Transaction Executor
```bash
node tests/execute-real-transactions.js
```

## Expected Results

### Successful Test Run
```
🚀 Real Blockchain Test Suite
================================
✅ Wallet initialized
✅ ETH balance sufficient
✅ Login successful
✅ Real stake transaction executed
✅ Real unstake transaction executed
✅ Real claim rewards executed
✅ Position data retrieved
✅ Protocol info retrieved
✅ Staking history retrieved
✅ Logout successful

📊 Transaction Summary
======================
1. STAKE
   ID: tx_1760349442889_a8h50prqz
   Amount: 0.001
   Timestamp: 2025-10-13T09:57:22.889Z

2. UNSTAKE
   ID: tx_1760349442936_ihqdjg2ri
   Amount: 0.001
   Timestamp: 2025-10-13T09:57:22.936Z

3. CLAIM_REWARDS
   ID: tx_1760349442936_ihqdjg2ri
   Amount: 0
   Timestamp: 2025-10-13T09:57:22.936Z

Total transactions: 3
🎉 Real blockchain test completed!
```

## Safety Measures

### 1. Test Amounts Only
- Use small amounts (0.001 ETH or less)
- Never test with significant funds
- Monitor gas costs

### 2. Test Networks
- Consider using testnets (Goerli, Sepolia)
- Use mainnet only for final testing
- Monitor network congestion

### 3. Private Key Security
- Use dedicated test wallets
- Never use production private keys
- Store test keys securely

### 4. Gas Management
- Monitor gas prices
- Use gas estimation
- Set appropriate gas limits

## Troubleshooting

### Insufficient ETH
```
❌ Insufficient ETH for testing
Required: 0.011 ETH
```

**Solution:**
- Add more ETH to test wallet
- Reduce test amount
- Use testnet instead

### Transaction Failed
```
❌ Stake transaction failed
Error: insufficient funds for gas
```

**Solution:**
- Check ETH balance
- Increase gas limit
- Check network congestion

### API Connection Failed
```
❌ API is not healthy
```

**Solution:**
- Start the API: `npm run dev`
- Check API logs
- Verify environment variables

## Monitoring Transactions

### Blockchain Explorers
- **Ethereum Mainnet**: https://etherscan.io
- **Goerli Testnet**: https://goerli.etherscan.io
- **Sepolia Testnet**: https://sepolia.etherscan.io

### Transaction Tracking
The test scripts provide transaction IDs that can be tracked on blockchain explorers.

### Gas Cost Monitoring
Monitor gas costs and adjust test amounts accordingly.

## Best Practices

### 1. Test Environment
- Use dedicated test wallets
- Monitor test wallet balances
- Keep test amounts small

### 2. Network Selection
- Use testnets for development
- Use mainnet only for production testing
- Monitor network status

### 3. Error Handling
- Implement proper error handling
- Log all transactions
- Monitor for failures

### 4. Security
- Never commit private keys
- Use environment variables
- Implement proper access controls

## Support

For issues with real blockchain tests:
1. Check wallet balance
2. Verify network connection
3. Check gas prices
4. Monitor transaction status
5. Review API logs

## Contributing

When adding new real blockchain tests:
1. Use small test amounts
2. Implement proper error handling
3. Add transaction tracking
4. Update documentation
5. Test on testnets first
