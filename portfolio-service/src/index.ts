import dotenv from 'dotenv';
dotenv.config();

import { createApp } from './app';

const app = createApp();
const port = process.env.PORT || 3009;

app.listen(port, () => {
  console.log(`Portfolio Service running on port ${port}`);
});

export default app;
