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
import { getUserByAlias, IUserDB } from "../db/user";
import { MSAT } from "../utils/constants";
import getDb from "../db/db";
import config from "../../config/config";
import { lnrpc } from "../proto";
import { bytesToString } from "../utils/common";

let lnurlPayForwardingRequestCounter = 0;
const lnurlPayForwardingRequests = new Map<
  number,
  { response: FastifyReply; pubkey: string; alias: string }
>();

const LnurlPayRequestLNP2PType = 32768 + 691;

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
    const user = await getUserByAlias(db, username);
    if (!user) {
      response.code(400);
      return {
        status: "ERROR",
        reason: `The recipient ${username}@${config.domain} does not exist.`,
      };
    }

    // If the peer is connected, forward the LNURL-pay request via LN P2P.
    if (await checkPeerConnected(lightning, user.pubkey)) {
      await handleLnurlPayRequest1Forwarding(lightning, user, response);
      return;
    } else if (config.disableCustodial) {
      return {
        status: "ERROR",
        reason: `It's not possible pay ${username}@${config.domain} at this time.`,
      };
    }

    return {
      tag: "payRequest",
      callback: `${config.domainUrl}/lightning-address/${username}/send`,
      minSendable: 1 * MSAT,
      maxSendable: 1000000 * MSAT,
      metadata: JSON.stringify(constructLnUrlPayMetaData(username, config.domain)),
      commentAllowed: 144,
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
      const user = await getUserByAlias(db, username);
      if (!user) {
        response.code(400);
        return {
          status: "ERROR",
          reason: `The recipient ${username} does not exist.`,
        };
      }

      const { amount, comment } = parseSendTextCallbackQueryParams(request.query);

      if (await checkPeerConnected(lightning, user.pubkey)) {
        await handleLnurlPayRequest2Forwarding(lightning, user, amount, comment, response);
        return;
      } else if (config.disableCustodial) {
        return {
          status: "ERROR",
          reason: `Unknown error occured.`,
        };
      }

      if (comment && comment.length > 144) {
        console.error("Got invalid comment length");
        response.code(400);
        return {
          status: "ERROR",
          reason: "Comment cannot be larger than 144 letters.",
        };
      }

      // TODO check amount

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
    } catch (error) {
      response.code(500);
      return {
        status: "ERROR",
        reason: error.message,
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
}

function parseSendTextCallbackQueryParams(params: any): ILnUrlPayParams {
  try {
    return {
      amount: Number.parseInt(params.amount ?? "0", 10),
      comment: params.comment ?? "",
    };
  } catch (e) {
    console.error(e);
    throw new Error("Could not parse query params");
  }
}

function customMessageHandler(data: any) {
  console.log("\nINCOMING CUSTOM MESSAGE");

  try {
    const customMessage = lnrpc.CustomMessage.decode(data);
    if (customMessage.type !== LnurlPayRequestLNP2PType) {
      throw new Error(`Unknown custom message type ${customMessage.type}`);
    }
    const request = JSON.parse(bytesToString(customMessage.data)) as ILnurlPayForwardP2PMessage;
    console.log(request);

    if (request.request === "LNURLPAY_REQUEST1_RESPONSE") {
      if (!lnurlPayForwardingRequests.has(request.id)) {
        console.error(`Unknown LNURL-pay forwarding request ${request.id}`);
        return;
      }
      const lnurlPayForwardingRequest = lnurlPayForwardingRequests.get(request.id);
      lnurlPayForwardingRequests.delete(request.id);

      lnurlPayForwardingRequest?.response.send({
        ...request.data,
        callback: `${config.domainUrl}/lightning-address/${lnurlPayForwardingRequest?.alias}/send`,
      });
    } else if (request.request === "LNURLPAY_REQUEST2_RESPONSE") {
      const customMessage = lnrpc.CustomMessage.decode(data);
      const request = JSON.parse(bytesToString(customMessage.data));
      if (!lnurlPayForwardingRequests.has(request.id)) {
        console.error(`Unknown LNURL-pay forwarding callback request ${request.id}`);
        return;
      }
      const lnurlPayForwardingRequest = lnurlPayForwardingRequests.get(request.id);
      lnurlPayForwardingRequests.delete(request.id);

      lnurlPayForwardingRequest?.response.send(request.data);
    }
  } catch (error) {
    console.error(`Error when handling custom message: ${error.message}`);
  }
}

async function handleLnurlPayRequest1Forwarding(
  lightning: Client,
  user: IUserDB,
  response: FastifyReply,
) {
  const currentRequest = lnurlPayForwardingRequestCounter++;
  lnurlPayForwardingRequests.set(currentRequest, {
    pubkey: user.pubkey,
    response,
    alias: user.alias,
  });

  const request: ILnurlPayForwardP2PMessage = {
    id: currentRequest,
    request: "LNURLPAY_REQUEST1",
    data: null,
    metadata: {
      lightningAddress: `${user.alias}@${config.domain}`,
    },
  };

  await sendCustomMessage(
    lightning,
    user.pubkey,
    LnurlPayRequestLNP2PType,
    JSON.stringify(request),
  );

  // Timeout after 30 seconds
  setTimeout(() => {
    if (lnurlPayForwardingRequests.has(currentRequest)) {
      lnurlPayForwardingRequests.delete(currentRequest);
    }
    response.send({
      status: "ERROR",
      reason: `It's not possible pay ${user.alias}@${config.domain} at this time.`,
    });
  }, 30 * 1000);
}

async function handleLnurlPayRequest2Forwarding(
  lightning: Client,
  user: IUserDB,
  amount: number,
  comment: string | undefined,
  response: FastifyReply,
) {
  const currentRequest = lnurlPayForwardingRequestCounter++;
  lnurlPayForwardingRequests.set(currentRequest, {
    pubkey: user.pubkey,
    response,
    alias: user.alias,
  });

  const request: ILnurlPayForwardP2PMessage = {
    id: currentRequest,
    request: "LNURLPAY_REQUEST2",
    data: {
      amount,
      comment,
    },
    metadata: {
      lightningAddress: `${user.alias}@${config.domain}`,
    },
  };

  await sendCustomMessage(
    lightning,
    user.pubkey,
    LnurlPayRequestLNP2PType,
    JSON.stringify(request),
  );

  // Timeout after 30 seconds
  setTimeout(() => {
    if (lnurlPayForwardingRequests.has(currentRequest)) {
      lnurlPayForwardingRequests.delete(currentRequest);
    }
    response.send({
      status: "ERROR",
      reason: `It's not possible pay ${user.alias}@${config.domain} at this time.`,
    });
  }, 30 * 1000);
}
