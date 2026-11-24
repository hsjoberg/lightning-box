import config from "../config/config";

import app from "./app";

const host = config.serverHost;
const domain = host.split(":")[0];
const port = Number.parseInt(host.split(":")[1] ?? "8080");

(async () => {
  const server = await app();

  try {
    const address = await server.listen({ port, host: domain });
    console.log(`Server listening at ${address}`);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
