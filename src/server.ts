import config from "../config/config";

import app from "./app";

const host = config.serverHost;
const domain = host.split(":")[0];
const port = Number.parseInt(host.split(":")[1] ?? "8080");

(async () => {
  const server = await app();

  server.listen(port, domain, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`Server listening at ${address}`);
  });
})();
