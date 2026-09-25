import express from 'express';

const app = express();
const port = Number(process.env.PORT || 3012);

app.disable('x-powered-by');
app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'user-service',
    version: '0.1.0',
  });
});

app.get('/', (_req, res) => {
  res.status(200).json({
    name: 'PanoramaBlock User Service',
    version: '0.1.0',
    status: 'isolated',
  });
});

if (require.main === module) {
  app.listen(port, '0.0.0.0', () => {
    console.log(`[User Service] listening on port ${port}`);
  });
}

export { app };
