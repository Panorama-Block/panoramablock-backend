import dotenv from 'dotenv';
dotenv.config();

import { createApp } from './app';

const app = createApp();
const port = process.env.PORT || 3008;

app.listen(port, () => {
  console.log(`Monitoring Service running on port ${port}`);
});

export default app;
