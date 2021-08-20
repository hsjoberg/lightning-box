import fastify, { FastifyServerOptions } from "fastify";
import fastifyCors from "fastify-cors";

import { getInfo } from "./utils/lnd-api";
import { getGrpcClients } from "./utils/grpc";

const { lightning, router } = getGrpcClients();

export default async function (options?: FastifyServerOptions) {
  const app = fastify(options);
  app.register(fastifyCors);

  app.register(require("./api/pay"), {
    lightning,
    router,
  });

  app.register(require("./api/withdraw"), {
    lightning,
    router,
  });

  app.get("/getInfo", async function () {
    return await getInfo(lightning);
  });

  return app;
}
