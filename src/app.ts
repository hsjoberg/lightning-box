import fastify, { FastifyServerOptions } from "fastify";
import fastifyCors from "fastify-cors";
import crypto from "crypto";

import config from "../config/config";
import { addInvoice, getInfo, sendPaymentSync, subscribeInvoices } from "./utils/lnd-api";
import { getGrpcClients } from "./utils/grpc";
import {
  createPayment,
  getNonForwardedPayments,
  getPayment,
  updatePayment,
  updatePaymentsSetAsForwarded,
} from "./db/payment";
import { getUserByAlias } from "./db/user";
import { getWithdrawalCode } from "./db/withdrawalCode";
import getDb from "./db/db";
import { MSAT } from "./utils/constants";
import { lnrpc } from "./proto";
import { bytesToHexString, generateBytes } from "./utils/common";

const { lightning, router } = getGrpcClients();

interface ILnUrlPayParams {
  amount: number;
  comment?: string;
}

interface ILnUrlWithdrawRequest {
  tag: "withdrawRequest";
  callback: string;
  k1: string;
  defaultDescription: string;
  minWithdrawable: number;
  maxWithdrawable: number;
}

interface ILnUrlWithdrawResponse {
  k1: string;
  pr: string;
}

export default async function (options?: FastifyServerOptions) {
  const app = fastify(options);
  app.register(fastifyCors);

  const db = await getDb();

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

    return {
      tag: "payRequest",
      callback: `${config.domainUrl}/lightning-address/${username}/send`,
      minSendable: 1 * MSAT,
      maxSendable: 1000000 * MSAT,
      metadata: JSON.stringify([["text/plain", `Payment to ${username}@${config.domain}`]]),
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
          .update(JSON.stringify([["text/plain", `Payment to ${username}`]]))
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

  const invoiceSubscription = subscribeInvoices(lightning);
  invoiceSubscription.on("data", async (data) => {
    console.log("\nINCOMING INVOICE");
    const invoice = lnrpc.Invoice.decode(data);
    if (invoice.settled) {
      console.log("Settled");

      // Check if this invoice relates to Lighting Box
      const payment = await getPayment(db, invoice.paymentRequest);
      if (payment) {
        console.log("Related payment");
        await updatePayment(db, {
          paymentRequest: payment.paymentRequest,
          paymentRequestForward: null,
          userAlias: payment.userAlias,
          amountSat: invoice.amtPaid.toNumber(),
          settled: +invoice.settled,
          forwarded: 0,
          comment: payment.comment,
        });
      }
    }
  });

  const withdrawalRequests = new Map<string, string>();

  app.get<{
    Params: { code: string };
  }>("/withdraw/:code", async (request, response) => {
    const code = request.params.code;

    const withdrawalCode = await getWithdrawalCode(db, code);
    if (!withdrawalCode) {
      response.code(400);
      return {
        status: "ERROR",
        reason: "Invalid withdrawal code.",
      };
    }

    const payments = await getNonForwardedPayments(db, withdrawalCode.userAlias);
    const totalWithdrawalSat = payments.reduce((prev, curr) => prev + curr.amountSat, 0);

    if (totalWithdrawalSat <= 0) {
      response.code(400);
      return {
        status: "ERROR",
        reason: "No funds available.",
      };
    }

    const k1 = bytesToHexString(await generateBytes(32));
    withdrawalRequests.set(k1, code);

    const withdrawRequest: ILnUrlWithdrawRequest = {
      tag: "withdrawRequest",
      callback: `${config.domainUrl}/withdraw/${code}/callback`,
      defaultDescription: `Withdraw Lightning Box for ${withdrawalCode.userAlias}@${config.domain}`,
      k1,
      minWithdrawable: totalWithdrawalSat * MSAT,
      maxWithdrawable: totalWithdrawalSat * MSAT,
    };
    return withdrawRequest;
  });

  app.get<{
    Params: { code: string };
    Querystring: ILnUrlWithdrawResponse;
  }>("/withdraw/:code/callback", async (request, response) => {
    const code = request.params.code;
    const withdrawResponse = request.query;

    if (!withdrawalRequests.has(withdrawResponse.k1)) {
      response.code(400);
      return {
        status: "ERROR",
        reason: "Invalid request.",
      };
    } else if (withdrawalRequests.get(withdrawResponse.k1) !== code) {
      response.code(400);
      return {
        status: "ERROR",
        reason: "Invalid request.",
      };
    }

    const withdrawalCode = await getWithdrawalCode(db, code);
    if (!withdrawalCode) {
      response.code(400);
      return {
        status: "ERROR",
        reason: "Invalid withdrawal code.",
      };
    }

    if (!withdrawResponse.pr) {
      response.code(400);
      return {
        status: "ERROR",
        reason: "Missing parameter pr.",
      };
    }

    response.send({
      status: "OK",
    });

    const result = await sendPaymentSync(lightning, withdrawResponse.pr);
    console.log(result);
    if (!result.paymentError || result.paymentError.length === 0) {
      console.log("Kommer hit", withdrawalCode.userAlias, withdrawResponse.pr);
      await updatePaymentsSetAsForwarded(db, withdrawalCode.userAlias, withdrawResponse.pr);
    }
  });

  app.get("/getInfo", async function () {
    return await getInfo(lightning);
  });

  return app;
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
