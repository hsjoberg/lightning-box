--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

-- `user` contains the alias, as in <alias>@<domain.com>
-- `pubkey` refers to the node pubkey that the service will allow forwards to
CREATE TABLE user (
  alias TEXT PRIMARY KEY,
  pubkey TEXT NOT NULL
);
CREATE INDEX index_user_pubkey ON user(pubkey);

-- `userAuthentication` binds a valid LNURL-auth pubkey
-- and will be used to bind adminstration of the user
CREATE TABLE userAuthentication (
  userAlias,
  pubkey
);

-- `withdrawalCode` are to be used to construct valid LNURL-withdraw endpoints for a user
CREATE TABLE withdrawalCode (
  code TEXT PRIMARY KEY,
  userAlias TEXT NOT NULL
);
CREATE INDEX index_withdrawalCode_userAlias ON withdrawalCode(userAlias);

-- `payment` keeps tracks of each payment and whether it has been settled and forwarded
CREATE TABLE payment (
  paymentRequest TEXT PRIMARY KEY,
  paymentRequestForward TEXT NULL,
  userAlias TEXT NOT NULL,
  amountSat INTEGER NOT NULL,
  settled BOOLEAN NOT NULL,
  forwarded BOOLEAN NOT NULL,
  comment TEXT,

  CHECK (settled IN (0, 1)),
  CHECK (forwarded IN (0, 1))
);
CREATE INDEX index_user_user_alias ON payment(userAlias);
