import fastify, { FastifyServerOptions } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";

import { getInfo } from "./utils/lnd-api";
import { getGrpcClients } from "./utils/grpc";
import config from "../config/config";

const { lightning, router } = getGrpcClients();

export default async function (options?: FastifyServerOptions) {
  const app = fastify({
    bodyLimit: 16 * 1024,
    trustProxy: ["127.0.0.1", "::1"],
    ...options,
  });
  await app.register(fastifyCors);
  await app.register(fastifyRateLimit, {
    global: true,
    max: 120,
    timeWindow: "1 minute",
  });

  await app.register(require("./api/pay"), {
    lightning,
    router,
  });

  if (!config.disableCustodial) {
    await app.register(require("./api/withdraw"), {
      lightning,
      router,
    });
  }

  await app.register(require("./api/user/manage"), {
    lightning,
    router,
  });

  // Only public node information; GetInfo also returns versions, sync state,
  // channel counts and features.
  app.get("/getInfo", async function () {
    const info = await getInfo(lightning);
    return {
      identityPubkey: info.identityPubkey,
      alias: info.alias,
      uris: info.uris,
    };
  });

  return app;
}
