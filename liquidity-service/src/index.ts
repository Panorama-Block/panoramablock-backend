import dotenv from 'dotenv';

import { createApp } from './app';

dotenv.config();

const app = createApp();
const port = process.env.PORT || 3006;

if (require.main === module) {
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`🚀 Liquidity Service running on port ${port}`);
    // eslint-disable-next-line no-console
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    // eslint-disable-next-line no-console
    console.log('📋 Available endpoints:');
    // eslint-disable-next-line no-console
    console.log('  - GET  /health');
    // eslint-disable-next-line no-console
    console.log('  - GET  /');
    // eslint-disable-next-line no-console
    console.log('  - GET  /v1/capability/liquidity/_discovery');
    // eslint-disable-next-line no-console
    console.log('  - GET  /v1/capability/liquidity/pools');
    // eslint-disable-next-line no-console
    console.log('  - GET  /v1/capability/liquidity/position/:address/:poolId');
    // eslint-disable-next-line no-console
    console.log('  - GET  /v1/capability/liquidity/apr/:poolId');
    // eslint-disable-next-line no-console
    console.log('  - POST /v1/capability/liquidity/prepare-add');
    // eslint-disable-next-line no-console
    console.log('  - POST /v1/capability/liquidity/prepare-remove');
    // eslint-disable-next-line no-console
    console.log('  - POST /v1/capability/liquidity/prepare-claim');
  });
}

export default app;
