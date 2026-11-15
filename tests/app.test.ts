import { FastifyInstance } from "fastify";

jest.mock("../config/config", () => ({
  __esModule: true,
  default: {
    env: "test",
    serverHost: "127.0.0.1:8080",
    domain: "example.com",
    domainUrl: "https://example.com",
    backend: "lnd",
    singlePaymentForwardWithdrawLimit: 5,
    disableCustodial: true,
  },
}));

import build from "../src/app";
import getDb from "../src/db/db";
import { createUser } from "../src/db/user";
import { lnrpc } from "../src/proto";

let app: FastifyInstance;

beforeAll(async () => {
  app = await build();
  await app.ready();

  const db = await getDb();
  expect(await createUser(db, { alias: "alice", pubkey: "02".repeat(33) })).toBe(true);
});

test('requests the "/getInfo" route', async () => {
  const response = await app.inject({
    method: "GET",
    url: "/getInfo",
  });

  expect(response.statusCode).toBe(200);
  // Only public node information, not lnd's version, sync state or features.
  expect(response.json()).toEqual({
    identityPubkey: "abc",
    alias: "lightning-box",
    uris: ["abc@127.0.0.1:9735"],
  });
});

test("does not expose custodial withdrawal routes when disabled", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/withdraw/anything",
  });

  expect(response.statusCode).toBe(404);
});

test("rejects malformed LNURL-pay amounts", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/lightning-address/alice/send?amount=1000junk",
  });

  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({ status: "ERROR", reason: "Invalid amount." });
});

test("accepts a valid signed user request only once", async () => {
  const message = JSON.stringify({
    nonce: "one-time-request",
    endpoint: "/user/get-user",
    timestamp: Math.floor(Date.now() / 1000),
    data: {},
  });
  const payload = { message, signature: "valid-signature" };

  const firstResponse = await app.inject({ method: "POST", url: "/user/get-user", payload });
  expect(firstResponse.statusCode).toBe(200);
  expect(firstResponse.json()).toMatchObject({ status: "OK", user: { alias: "alice" } });

  const replayResponse = await app.inject({ method: "POST", url: "/user/get-user", payload });
  expect(replayResponse.statusCode).toBe(400);
  expect(replayResponse.json()).toMatchObject({
    status: "ERROR",
    reason: "Request has already been used.",
  });
});

test("rejects a failed LND signature verification", async () => {
  const lndApiMock = jest.requireMock("../src/utils/lnd-api") as {
    __verifyMessageSetValidSig: (valid: boolean) => void;
  };
  lndApiMock.__verifyMessageSetValidSig(false);

  const response = await app.inject({
    method: "POST",
    url: "/user/get-user",
    payload: {
      message: JSON.stringify({
        nonce: "invalid-signature",
        endpoint: "/user/get-user",
        timestamp: Math.floor(Date.now() / 1000),
        data: {},
      }),
      signature: "invalid-signature",
    },
  });

  lndApiMock.__verifyMessageSetValidSig(true);
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ status: "ERROR", reason: "Invalid signature." });
});

test("forwards the LNURL-pay request to a connected wallet and returns its answer", async () => {
  const lndApiMock = jest.requireMock("../src/utils/lnd-api") as {
    sendCustomMessage: jest.Mock;
    __customMessagesStream: NodeJS.EventEmitter;
  };
  const alicePubkey = "02".repeat(33);
  lndApiMock.sendCustomMessage.mockClear();

  const pending = app
    .inject({ method: "GET", url: "/.well-known/lnurlp/alice" })
    .then((response) => response);

  const start = Date.now();
  while (lndApiMock.sendCustomMessage.mock.calls.length === 0 && Date.now() - start < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const forwarded = JSON.parse(lndApiMock.sendCustomMessage.mock.calls.at(-1)![3]);
  expect(forwarded).toMatchObject({ request: "LNURLPAY_REQUEST1" });

  lndApiMock.__customMessagesStream.emit(
    "data",
    lnrpc.CustomMessage.encode({
      peer: Buffer.from(alicePubkey, "hex"),
      type: 32768 + 691,
      data: Buffer.from(
        JSON.stringify({
          id: forwarded.id,
          request: "LNURLPAY_REQUEST1_RESPONSE",
          data: { tag: "payRequest", minSendable: 1000, maxSendable: 9_000_000_000 },
        }),
      ),
    }).finish(),
  );

  const response = await pending;
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    tag: "payRequest",
    minSendable: 1000,
    maxSendable: 9_000_000_000,
    // The callback always points back at Lightning Box.
    callback: "https://example.com/lightning-address/alice/send",
  });
});

test("forwards an amount above the custodial limit to the wallet", async () => {
  const lndApiMock = jest.requireMock("../src/utils/lnd-api") as {
    sendCustomMessage: jest.Mock;
    __customMessagesStream: NodeJS.EventEmitter;
  };
  const alicePubkey = "02".repeat(33);
  const amountMsat = 5_000_000_000; // 5,000,000 sat; the wallet sets its own limits
  lndApiMock.sendCustomMessage.mockClear();

  const pending = app
    .inject({ method: "GET", url: `/lightning-address/alice/send?amount=${amountMsat}` })
    .then((response) => response);

  const start = Date.now();
  while (lndApiMock.sendCustomMessage.mock.calls.length === 0 && Date.now() - start < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const [, pubkey, , payload] = lndApiMock.sendCustomMessage.mock.calls.at(-1)!;
  const forwarded = JSON.parse(payload);
  expect(pubkey).toBe(alicePubkey);
  expect(forwarded).toMatchObject({ request: "LNURLPAY_REQUEST2", data: { amount: amountMsat } });

  // The wallet answers with its invoice.
  lndApiMock.__customMessagesStream.emit(
    "data",
    lnrpc.CustomMessage.encode({
      peer: Buffer.from(alicePubkey, "hex"),
      type: 32768 + 691,
      data: Buffer.from(
        JSON.stringify({
          id: forwarded.id,
          request: "LNURLPAY_REQUEST2_RESPONSE",
          data: { pr: "lnbc1test", routes: [] },
        }),
      ),
    }).finish(),
  );

  const response = await pending;
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ pr: "lnbc1test", routes: [] });
});

test("atomically prevents a pubkey from registering twice", async () => {
  const db = await getDb();
  expect(await createUser(db, { alias: "bob", pubkey: "02".repeat(33) })).toBe(false);
});

test("rate limits clients behind the loopback reverse proxy", async () => {
  const responses = [];
  for (let requestNumber = 0; requestNumber < 121; requestNumber++) {
    responses.push(
      await app.inject({
        method: "GET",
        url: "/getInfo",
        headers: { "x-forwarded-for": "203.0.113.10" },
      }),
    );
  }

  expect(responses.filter((response) => response.statusCode === 429)).toHaveLength(1);
});

afterAll(async () => {
  await app.close();
});
