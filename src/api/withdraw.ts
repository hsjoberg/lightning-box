import { FastifyPluginAsync } from "fastify";
import { Client } from "@grpc/grpc-js";

import { bytesToHexString, generateBytes } from "../utils/common";
import {
  getNonForwardedPayments,
  getPayment,
  updatePayment,
  updatePaymentsSetAsForwarded,
} from "../db/payment";
import { sendPaymentSync, subscribeInvoices } from "../utils/lnd-api";
import { MSAT } from "../utils/constants";
import getDb from "../db/db";
import { getWithdrawalCode } from "../db/withdrawalCode";
import config from "../../config/config";
import { lnrpc } from "../proto";

const Withdraw = async function (app, { lightning, router }) {
  const db = await getDb();
  const withdrawalRequests = new Map<string, string>();

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

  app.get<{
    Params: { code: string };
    Querystring: { balanceCheck: string };
  }>("/withdraw/:code", async (request, response) => {
    const code = request.params.code;
    const { balanceCheck } = request.query;

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
      balanceCheck: `${config.domainUrl}/withdraw/${code}?balanceCheck`,
    };
    if (balanceCheck) {
      withdrawRequest.currentBalance = totalWithdrawalSat;
    }

    return withdrawRequest;
  });

  app.get<{
    Params: { code: string };
    Querystring: ILnUrlWithdrawResponse;
  }>("/withdraw/:code/callback", async (request, response) => {
    const code = request.params.code;
    const withdrawResponse = request.query;

    const checkK1 = withdrawalRequests.get(withdrawResponse.k1);
    if (checkK1 !== code) {
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
      await updatePaymentsSetAsForwarded(db, withdrawalCode.userAlias, withdrawResponse.pr);
    }
  });
} as FastifyPluginAsync<{ lightning: Client; router: Client }>;

export default Withdraw;

interface ILnUrlWithdrawRequest {
  tag: "withdrawRequest";
  callback: string;
  k1: string;
  defaultDescription: string;
  minWithdrawable: number;
  maxWithdrawable: number;
  balanceCheck: string;
  currentBalance?: number;
}

interface ILnUrlWithdrawResponse {
  k1: string;
  pr: string;
}
