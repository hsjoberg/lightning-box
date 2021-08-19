# 📥 Lightning Box

_Work In Progress, not suited for production just yet._
_Contributions, suggestions and ideas are appreciated._
_Database schema and configuration are bound to change._

Lightning Box is a payment inbox for [Lightning Addresses](https://lightningaddress.com).
It's mainly suited for non-custodial Lightning wallets that might not always be online to receive payments.

Lightning Box will take the payment on behalf of the wallet and then notify the user about the payment via a communication medium (Email, Telegram, Push notification...). The user is then supposed to start their wallet to withdraw.

By utilizing the widely adopted protocols `LNURL-auth` and `LNURL-withdraw`, any supporting Lightning Wallet can use Lightning Box.
Wallets that also support `LNURL-withdraw`'s [`balanceCheck`](https://github.com/fiatjaf/lnurl-rfc/blob/luds/14.md) can keep the Lightning Box as known service inside the wallet and easily withdraw from the box without leaving the wallet.

## Build

Lightning Box requires lnd as the Lightning backend right now, though the plan is to
make the service implementation independent.

The `master` branch always expects the latest version of lnd. Lnd compiled with routerrpc is required.

1. Run lnd, wallet must be unlocked for Dunder to operate correctly
2. `git clone https://github.com/hsjoberg/lightning-box && cd lightning-box`
3. Copy `config/config.ts_TEMPLATE` to `config/config.ts` and set up your configuration. See config/interface.ts for documentation over the configuration
4. `npm install`
5. `npm start`

# Test

To do tests run `npm test` or `npm test:coverage`.

Any new code should not decerease code coverage significantly.

## License

MIT
