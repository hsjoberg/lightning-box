import { FastifyPluginAsync, FastifyReply } from "fastify";
import { Client } from "@grpc/grpc-js";
import crypto from "crypto";

import {
  addInvoice,
  checkPeerConnected,
  sendCustomMessage,
  SubscribeCustomMessages,
} from "../utils/lnd-api";
import { createPayment } from "../db/payment";
import { getUserByAlias, getUserByPubkey, IUserDB } from "../db/user";
import { MSAT } from "../utils/constants";
import getDb from "../db/db";
import config from "../../config/config";
import { lnrpc } from "../proto";
import { bytesToHexString, uint8ArrayToUnicodeString } from "../utils/common";

let lnurlPayForwardingRequestCounter = 0;
const lnurlPayForwardingRequests = new Map<
  number,
  {
    response: FastifyReply;
    pubkey: string;
    alias: string;
    expectedResponse: ForwardResponseType;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

const LnurlPayRequestLNP2PType = 32768 + 691;
const MIN_SENDABLE_MSAT = 1 * MSAT;
const MAX_SENDABLE_MSAT = 1_000_000 * MSAT;
const MAX_COMMENT_LENGTH = 144;

type ForwardResponseType = "LNURLPAY_REQUEST1_RESPONSE" | "LNURLPAY_REQUEST2_RESPONSE";

interface ILnurlPayForwardP2PMessage {
  id: number;
  request:
    | "LNURLPAY_REQUEST1"
    | "LNURLPAY_REQUEST1_RESPONSE"
    | "LNURLPAY_REQUEST2"
    | "LNURLPAY_REQUEST2_RESPONSE";
  data: any;
  metadata?: any;
}

const Pay = async function (app, { lightning, router }) {
  const db = await getDb();

  // This is used for LNURL-pay forwarding to the wallet
  const customMessagesSubscription = SubscribeCustomMessages(lightning);
  customMessagesSubscription.on("data", async (data) => {
    customMessageHandler(data);
  });

  app.get<{
    Params: {
      username: string;
    };
  }>("/.well-known/lnurlp/:username", async (request, response) => {
    const username = request.params.username;
    const user = (await getUserByAlias(db, username)) ?? (await getUserByPubkey(db, username));
    if (!user) {
      response.code(400);
      return {
        status: "ERROR",
        reason: `The recipient ${username}@${config.domain} does not exist.`,
      };
    }

    // If the peer is connected, forward the LNURL-pay request via LN P2P.
    if (await checkPeerConnected(lightning, user.pubkey)) {
      await handleLnurlPayRequest1Forwarding(lightning, user, username, response);
      // The wallet's answer is sent later; returning the reply tells Fastify
      // not to send an empty response now.
      return response;
    } else if (config.disableCustodial) {
      return {
        status: "ERROR",
        reason: `It's not possible to pay ${username}@${config.domain} at this time.`,
      };
    }

    return {
      tag: "payRequest",
      callback: `${config.domainUrl}/lightning-address/${username}/send`,
      minSendable: MIN_SENDABLE_MSAT,
      maxSendable: MAX_SENDABLE_MSAT,
      metadata: JSON.stringify(constructLnUrlPayMetaData(username, config.domain)),
      commentAllowed: MAX_COMMENT_LENGTH,
    };
  });

  app.get<{
    Params: {
      username: string;
    };
    Querystring: ILnUrlPayParams;
  }>("/lightning-address/:username/send", async (request, response) => {
    try {
      const username = request.params.username;
      const user = (await getUserByAlias(db, username)) ?? (await getUserByPubkey(db, username));
      if (!user) {
        response.code(400);
        return {
          status: "ERROR",
          reason: `The recipient ${username}@${config.domain} does not exist.`,
        };
      }

      const { amount, comment, payerData } = parseSendTextCallbackQueryParams(request.query);

      // Forwarded requests go to the wallet, which enforces the limits it
      // advertised itself (minSendable, maxSendable, commentAllowed).
      if (await checkPeerConnected(lightning, user.pubkey)) {
        await handleLnurlPayRequest2Forwarding(
          lightning,
          user,
          username,
          amount,
          comment,
          payerData,
          response,
        );
        return response;
      } else if (config.disableCustodial) {
        return {
          status: "ERROR",
          reason: `Unknown error occured.`,
        };
      }

      if (comment && comment.length > MAX_COMMENT_LENGTH) {
        throw new InvalidLnurlPayRequestError(
          `Comment cannot be larger than ${MAX_COMMENT_LENGTH} characters.`,
        );
      }

      const invoice = await addInvoice(
        lightning,
        amount,
        crypto
          .createHash("sha256")
          .update(JSON.stringify(constructLnUrlPayMetaData(username, config.domain)))
          .digest(),
      );

      await createPayment(db, {
        paymentRequest: invoice.paymentRequest,
        paymentRequestForward: null,
        userAlias: username,
        amountSat: amount / MSAT,
        forwarded: 0,
        settled: 0,
        comment: comment ?? null,
      });

      return {
        pr: invoice.paymentRequest,
        successAction: null,
        disposable: true,
      };
    } catch (error: unknown) {
      const invalidRequest = error instanceof InvalidLnurlPayRequestError;
      if (!invalidRequest) {
        console.error("Unable to process LNURL-pay callback", error);
      }
      response.code(invalidRequest ? 400 : 500);
      return {
        status: "ERROR",
        reason: invalidRequest ? error.message : "Unable to process payment request.",
      };
    }
  });
} as FastifyPluginAsync<{ lightning: Client; router: Client }>;

export default Pay;

type Metadata = [string, string][];

function constructLnUrlPayMetaData(username: string, domain: string): Metadata {
  return [
    ["text/plain", `${username}@${domain}:  Thank you for the sats!`],
    ["text/identifier", `${username}@${domain}`],
  ];
}

interface ILnUrlPayParams {
  amount: number;
  comment?: string;
  payerData?: string;
}

function parseSendTextCallbackQueryParams(params: any): ILnUrlPayParams {
  const rawAmount = params?.amount;
  if (
    (typeof rawAmount !== "string" && typeof rawAmount !== "number") ||
    !/^\d+$/.test(String(rawAmount))
  ) {
    throw new InvalidLnurlPayRequestError("Invalid amount.");
  }

  const amount = Number(rawAmount);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new InvalidLnurlPayRequestError("Invalid amount.");
  }

  const comment = params.comment;
  if (comment !== undefined && typeof comment !== "string") {
    throw new InvalidLnurlPayRequestError("Invalid comment.");
  }

  const payerData = params.payerdata;
  if (payerData !== undefined && typeof payerData !== "string") {
    throw new InvalidLnurlPayRequestError("Invalid payer data.");
  }

  return { amount, comment, payerData };
}

function customMessageHandler(data: any) {
  console.log("\nINCOMING CUSTOM MESSAGE");

  try {
    const customMessage = lnrpc.CustomMessage.decode(data);
    if (customMessage.type !== LnurlPayRequestLNP2PType) {
      throw new Error(`Unknown custom message type ${customMessage.type}`);
    }
    const request = JSON.parse(
      uint8ArrayToUnicodeString(customMessage.data),
    ) as ILnurlPayForwardP2PMessage;

    if (!Number.isSafeInteger(request.id)) {
      console.error("Ignoring LNURL-pay forwarding response with invalid request ID");
      return;
    }

    if (request.request === "LNURLPAY_REQUEST1_RESPONSE") {
      const lnurlPayForwardingRequest = lnurlPayForwardingRequests.get(request.id);
      if (!lnurlPayForwardingRequest) {
        console.error(`Unknown LNURL-pay forwarding request ${request.id}`);
        return;
      }
      const peerPubkey = bytesToHexString(customMessage.peer);
      if (peerPubkey !== lnurlPayForwardingRequest.pubkey.toLowerCase()) {
        console.error(`Ignoring LNURL-pay forwarding response ${request.id} from unexpected peer`);
        return;
      }
      if (lnurlPayForwardingRequest.expectedResponse !== request.request) {
        console.error(`Ignoring out-of-phase LNURL-pay forwarding response ${request.id}`);
        return;
      }
      clearTimeout(lnurlPayForwardingRequest.timeout);
      lnurlPayForwardingRequests.delete(request.id);

      lnurlPayForwardingRequest.response.send({
        ...request.data,
        callback: `${config.domainUrl}/lightning-address/${lnurlPayForwardingRequest.alias}/send`,
      });
    } else if (request.request === "LNURLPAY_REQUEST2_RESPONSE") {
      const lnurlPayForwardingRequest = lnurlPayForwardingRequests.get(request.id);
      if (!lnurlPayForwardingRequest) {
        console.error(`Unknown LNURL-pay forwarding callback request ${request.id}`);
        return;
      }
      const peerPubkey = bytesToHexString(customMessage.peer);
      if (peerPubkey !== lnurlPayForwardingRequest.pubkey.toLowerCase()) {
        console.error(
          `Ignoring LNURL-pay forwarding callback response ${request.id} from unexpected peer`,
        );
        return;
      }
      if (lnurlPayForwardingRequest.expectedResponse !== request.request) {
        console.error(`Ignoring out-of-phase LNURL-pay forwarding response ${request.id}`);
        return;
      }
      clearTimeout(lnurlPayForwardingRequest.timeout);
      lnurlPayForwardingRequests.delete(request.id);

      lnurlPayForwardingRequest.response.send(request.data);
    } else {
      console.error("Unknown message", request);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error when handling custom message: ${message}`);
  }
}

async function handleLnurlPayRequest1Forwarding(
  lightning: Client,
  user: IUserDB,
  requestedUsername: string,
  response: FastifyReply,
) {
  const currentRequest = lnurlPayForwardingRequestCounter++;
  const timeout = createForwardingTimeout(currentRequest, requestedUsername, response);
  lnurlPayForwardingRequests.set(currentRequest, {
    pubkey: user.pubkey,
    response,
    alias: requestedUsername,
    expectedResponse: "LNURLPAY_REQUEST1_RESPONSE",
    timeout,
  });

  const request: ILnurlPayForwardP2PMessage = {
    id: currentRequest,
    request: "LNURLPAY_REQUEST1",
    data: null,
    metadata: {
      lightningAddress: `${requestedUsername}@${config.domain}`,
    },
  };

  try {
    await sendCustomMessage(
      lightning,
      user.pubkey,
      LnurlPayRequestLNP2PType,
      JSON.stringify(request),
    );
  } catch (error) {
    clearForwardingRequest(currentRequest);
    throw error;
  }
}

async function handleLnurlPayRequest2Forwarding(
  lightning: Client,
  user: IUserDB,
  requestedUsername: string,
  amount: number,
  comment: string | undefined,
  payerData: string | undefined,
  response: FastifyReply,
) {
  const currentRequest = lnurlPayForwardingRequestCounter++;
  const timeout = createForwardingTimeout(currentRequest, requestedUsername, response);
  lnurlPayForwardingRequests.set(currentRequest, {
    pubkey: user.pubkey,
    response,
    alias: requestedUsername,
    expectedResponse: "LNURLPAY_REQUEST2_RESPONSE",
    timeout,
  });

  const request: ILnurlPayForwardP2PMessage = {
    id: currentRequest,
    request: "LNURLPAY_REQUEST2",
    data: {
      amount,
      comment,
      payerdata: payerData,
    },
    metadata: {
      lightningAddress: `${requestedUsername}@${config.domain}`,
    },
  };

  try {
    await sendCustomMessage(
      lightning,
      user.pubkey,
      LnurlPayRequestLNP2PType,
      JSON.stringify(request),
    );
  } catch (error) {
    clearForwardingRequest(currentRequest);
    throw error;
  }
}

function createForwardingTimeout(
  requestId: number,
  requestedUsername: string,
  response: FastifyReply,
) {
  return setTimeout(() => {
    if (!lnurlPayForwardingRequests.delete(requestId)) {
      return;
    }

    response.send({
      status: "ERROR",
      reason: `It's not possible to pay ${requestedUsername}@${config.domain} at this time.`,
    });
  }, 30 * 1000);
}

function clearForwardingRequest(requestId: number) {
  const request = lnurlPayForwardingRequests.get(requestId);
  if (request) {
    clearTimeout(request.timeout);
    lnurlPayForwardingRequests.delete(requestId);
  }
}

class InvalidLnurlPayRequestError extends Error {}
