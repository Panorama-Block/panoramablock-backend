import { createApp } from "./http/app";
import { DatabaseGatewayIdentityRepository } from "./repositories/databaseGatewayIdentityRepository";
import { IdentityResolver } from "./services/identityResolver";

const port = Number(process.env.PORT || 3012);

const identityRepository =
  new DatabaseGatewayIdentityRepository();
const identityResolver =
  new IdentityResolver(identityRepository);

const app = createApp(identityResolver);

if (require.main === module) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`[User Service] listening on port ${port}`);
  });
}

export { app };
