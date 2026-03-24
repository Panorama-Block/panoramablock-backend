# Smart Wallet Support

Este documento explica como a API foi modificada para suportar tanto smart wallets quanto private keys.

## 🔧 Modificações Realizadas

### 1. Middleware de Autenticação Atualizado

O middleware `verifySignature` foi modificado para detectar automaticamente o tipo de wallet:

```javascript
// Detecta automaticamente o tipo de wallet
const authMode = isSmartWallet || walletType === 'smart_wallet' ? 'smart_wallet' : 'private_key';
```

### 2. Novos Middlewares

- `prepareTransactionData`: Prepara dados de transação baseado no tipo de wallet
- `detectWalletType`: Detecta se é smart wallet ou private key

### 3. Endpoints Modificados

Todos os endpoints que requeriam `privateKey` agora suportam ambos os tipos:

#### Endpoints de Validação:
- `POST /validation/payAndValidate`
- `POST /validation/setTaxRate`
- `POST /validation/withdraw`

#### Endpoints de Benqi:
- `POST /benqi-validation/validateAndSupply`
- `POST /benqi-validation/validateAndBorrow`

## 📋 Como Usar

### Smart Wallet (Recomendado)

```javascript
// Para smart wallets, envie isSmartWallet: true
const response = await fetch('/validation/payAndValidate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    address: '0x1234...',
    signature: '0xabcd...',
    message: 'Pay and validate\nTimestamp: 1234567890',
    timestamp: 1234567890,
    amount: '1000000000000000000',
    isSmartWallet: true,
    walletType: 'smart_wallet'
  })
});

// Resposta para smart wallet
{
  "status": 200,
  "msg": "success",
  "data": {
    "to": "0x...",
    "data": "0x...",
    "value": "1000000000000000000",
    "gas": "100000",
    "gasPrice": "30000000000",
    "chainId": "43114",
    "walletType": "smart_wallet",
    "requiresSignature": true,
    "note": "Transação preparada para assinatura no frontend (smart wallet)"
  }
}
```

### Private Key (Tradicional)

```javascript
// Para private keys, envie a privateKey
const response = await fetch('/validation/payAndValidate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    address: '0x1234...',
    signature: '0xabcd...',
    message: 'Pay and validate\nTimestamp: 1234567890',
    timestamp: 1234567890,
    amount: '1000000000000000000',
    privateKey: '0x1234567890abcdef...'
  })
});

// Resposta para private key
{
  "status": 200,
  "msg": "success",
  "data": {
    "transactionHash": "0x...",
    "status": "success",
    "blockNumber": "12345678",
    "gasUsed": "50000",
    "walletType": "private_key",
    "requiresSignature": false,
    "note": "Transação executada com private key"
  }
}
```

## 🔍 Detecção Automática

A API detecta automaticamente o tipo de wallet baseado nos parâmetros enviados:

### Smart Wallet:
- `isSmartWallet: true`
- `walletType: 'smart_wallet'`
- Sem `privateKey`

### Private Key:
- Presença de `privateKey`
- Sem `isSmartWallet` ou `walletType`

## 📊 Diferenças de Comportamento

| Aspecto | Smart Wallet | Private Key |
|---------|--------------|-------------|
| **Execução** | Prepara transação | Executa transação |
| **Assinatura** | No frontend | No backend |
| **Resposta** | Dados da transação | Hash da transação |
| **Segurança** | Mais segura | Menos segura |
| **Flexibilidade** | Maior controle | Menor controle |

## 🚀 Vantagens do Smart Wallet

1. **Segurança**: Private keys nunca saem do frontend
2. **Flexibilidade**: Usuário pode revisar transação antes de assinar
3. **Compatibilidade**: Funciona com MetaMask, WalletConnect, etc.
4. **UX**: Melhor experiência do usuário

## 🧪 Testando

Execute o arquivo de teste para verificar a compatibilidade:

```bash
node test-smart-wallet.js
```

## 📝 Exemplo de Integração no Frontend

```typescript
// Cliente de lending atualizado
class LendingApiClient {
  private async getAuthData(message: string) {
    const signature = await this.account.signMessage({ message });
    return {
      address: this.account.address,
      signature,
      message,
      timestamp: Date.now(),
      // Smart wallet specific data
      walletType: 'smart_wallet',
      isSmartWallet: true,
      chainId: 43114
    };
  }

  async prepareSupply(tokenAddress: string, amount: string): Promise<any> {
    const message = `Validate and supply ${amount} of token ${tokenAddress}\nTimestamp: ${Date.now()}`;
    const authData = await this.getAuthData(message);
    
    const response = await fetch(`${this.baseUrl}/benqi-validation/validateAndSupply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...authData,
        amount,
        qTokenAddress: tokenAddress,
      })
    });

    const result = await response.json();
    
    if (result.data.requiresSignature) {
      // Executar transação no frontend
      const tx = await this.account.sendTransaction(result.data.validation);
      const receipt = await tx.wait();
      
      // Executar segunda transação se necessário
      if (result.data.supply) {
        const tx2 = await this.account.sendTransaction(result.data.supply);
        const receipt2 = await tx2.wait();
      }
    }
    
    return result;
  }
}
```

## ⚠️ Notas Importantes

1. **Backward Compatibility**: Endpoints antigos ainda funcionam com private keys
2. **Smart Wallets**: Requerem implementação de métodos `prepare*` nos services
3. **Transações Múltiplas**: Alguns endpoints retornam múltiplas transações para smart wallets
4. **Error Handling**: Trate erros de assinatura no frontend

## 🔧 Próximos Passos

1. Implementar métodos `prepare*` nos services
2. Adicionar suporte a transações em lote
3. Melhorar tratamento de erros
4. Adicionar testes de integração
