import { Config } from "./interface";

// Please see interface.ts for description about each config
const config: Config = {
  env: "prod",
  serverHost: "127.0.0.1:8080",
  domain: "example.com",
  domainUrl: "https://example.com",
  backend: "lnd",
  backendConfigLnd: {
    grpcServer: "127.0.0.1:10007",
    cert: "~/path/to/lnd/tls.cert",
    macaroon: "~/path/to/lnd/lightning-box.macaroon",
  },
  singlePaymentForwardWithdrawLimit: 5,
  disableCustodial: true,
};

export default config;
