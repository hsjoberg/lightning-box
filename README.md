# 📥 Lightning Box

_Work In Progress, not suited for production just yet._
_Contributions, suggestions and ideas are appreciated._
_Database schema and configuration are bound to change._

## Build

Lightning Box requires lnd as the Lightning backend right now, though the plan is to
make the service implementation independent.

The `master` branch always expects the latest version of lnd. Lnd compiled with routerrpc is required.

1. Run lnd, wallet must be unlocked for Dunder to operate correctly
2. `git clone https://github.com/hsjoberg/lightnig-box && cd lightning-box`
3. Copy `config/config.ts_TEMPLATE` to `config/config.ts` and set up your configuration. See config/interface.ts for documentation over the configuration
4. `npm install`
5. `npm start`

# Test

To do tests run `npm test` or `npm test:coverage`.

Any new code should not decerease code coverage significantly.

## License

MIT
