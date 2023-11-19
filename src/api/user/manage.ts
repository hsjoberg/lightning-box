import { FastifyPluginAsync } from "fastify";
import { Client } from "@grpc/grpc-js";
import { getUnixTime } from "date-fns";

import { hexToUint8Array } from "../../utils/common";
import { listChannels, verifyMessage } from "../../utils/lnd-api";
import getDb from "../../db/db";
import { createUser, getUserByAlias, getUserByPubkey } from "../../db/user";
import config from "../../../config/config";

interface ISignedMessage {
  nonce?: string;
  endpoint?: string;
  timestamp?: number; // This is a unix timestamp
  data: { [k: string]: any };
}

const User = async function (app, { lightning, router }) {
  const db = await getDb();

  /**
   *
   * Each message is signed by the wallet's key. We therefore get their pubkey from the signature.
   *
   * In order to prevent replay attacks, the signed message is a nonce + UNIX timestamp.
   * Requests older than 30 seconds will be rejected.
   *
   */

  /**
   *
   * POST /user/get-user
   *
   * Get information about oneself. Returns error if there is no account.
   * TODO remove this one?
   *
   */
  interface IGetUserRequest {
    signature?: string;
    message?: string;
  }
  const getUserEndpoint = "/user/get-user";
  app.post(getUserEndpoint, async (request, response) => {
    const getUserRequest = JSON.parse(request.body as string) as IGetUserRequest; // TODO this sucks

    const verificationResult = await verifyMessage(
      lightning,
      getUserRequest.message!,
      getUserRequest.signature!,
    ); // TODO this sucks

    const signedMessage = JSON.parse(getUserRequest.message!) as ISignedMessage; // TODO this sucks

    const pubkey = verificationResult.pubkey;
    if (!pubkey) {
      response.code(400);
      return {
        status: "ERROR",
        reason: "Invalid signature",
      };
    }

    if (signedMessage.endpoint !== getUserEndpoint) {
      response.code(400);
      return {
        status: "ERROR",
        reason: "Invalid request",
      };
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const timeDiff = currentTime - (signedMessage.timestamp ?? 0);
    if (timeDiff < 0 || timeDiff > 30) {
      response.code(400);
      return {
        status: "ERROR",
        reason: "Request is either too old or from the future.",
      };
    }

    const user = await getUserByAlias(db, pubkey);

    if (!user) {
      response.code(400);
      return {
        status: "ERROR",
        code: "NO_USER",
        reason: `You have no user.`,
      };
    }

    return {
      status: "OK",
      user: {
        alias: user.alias,
        lightningAddress: `${user.alias}@${config.domain}`,
        pubkey: user.pubkey,
      },
    };
  });

  /**
   *
   * POST /user/check-eligibility
   *
   * Check whether the wallet is eligible for registration.
   * The current requirement is to have a channel with the Lightning Box LSP.
   * If the wallet has an account already, an error will be returned with a user object.
   *
   */
  interface ICheckEligibilityRequest {
    signature?: string;
    message?: string;
  }
  const checkEligibilityEndopint = "/user/check-eligibility";
  app.post(checkEligibilityEndopint, async (request, response) => {
    const registerRequest = JSON.parse(request.body as string) as ICheckEligibilityRequest; // TODO this sucks

    const verificationResult = await verifyMessage(
      lightning,
      registerRequest.message!,
      registerRequest.signature!,
    ); // TODO this sucks

    const pubkey = verificationResult.pubkey;
    if (!pubkey) {
      response.code(400);
      return {
        status: "ERROR",
        reason: "Invalid signature.",
      };
    }

    const signedMessage = JSON.parse(registerRequest.message!) as ISignedMessage; // TODO this sucks
    if (signedMessage.endpoint !== checkEligibilityEndopint) {
      response.code(400);
      return {
        status: "ERROR",
        reason: "Invalid request",
      };
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const timeDiff = currentTime - (signedMessage.timestamp ?? 0);
    if (timeDiff < 0 || timeDiff > 30) {
      response.code(400);
      return {
        status: "ERROR",
        reason: "Request is either too old or from the future.",
      };
    }

    const user = await getUserByPubkey(db, pubkey);
    if (user) {
      response.code(400);
      return {
        status: "ERROR",
        code: "HAS_USER",
        reason: `You have a user already.`,
        user: {
          alias: user.alias,
          lightningAddress: `${user.alias}@${config.domain}`,
          pubkey: user.pubkey,
        },
      };
    }

    if (await checkIfWalletHasChannel(lightning, hexToUint8Array(pubkey))) {
      return {
        status: "OK",
      };
    } else {
      response.code(400);
      return {
        status: "ERROR",
        reason: "You need a channel with the Lightning Box service.",
      };
    }
  });

  /**
   *
   * POST /user/register
   *
   * Register a Lightning Box account.
   *
   */
  interface IRegisterRequest {
    name?: string;
    signature?: string;
    message?: string;
  }
  const registerEndpoint = "/user/register";
  app.post(registerEndpoint, async (request, response) => {
    const registerRequest = JSON.parse(request.body as string) as IRegisterRequest; // TODO this sucks

    const verificationResult = await verifyMessage(
      lightning,
      registerRequest.message!,
      registerRequest.signature!,
    ); // TODO this sucks

    const pubkey = verificationResult.pubkey;
    if (!pubkey) {
      response.code(400);
      return {
        status: "ERROR",
        reason: "Invalid signature.",
      };
    }

    const signedMessage = JSON.parse(registerRequest.message!) as ISignedMessage; // TODO this sucks

    if (signedMessage.endpoint !== registerEndpoint) {
      response.code(400);
      return {
        status: "ERROR",
        reason: "Invalid request",
      };
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const timeDiff = currentTime - (signedMessage.timestamp ?? 0);
    if (timeDiff < 0 || timeDiff > 30) {
      response.code(400);
      return {
        status: "ERROR",
        reason: "Request is either too old or from the future.",
      };
    }

    if (await getUserByPubkey(db, pubkey)) {
      response.code(400);
      return {
        status: "ERROR",
        code: "HAS_USER",
        reason: `You have a user already.`,
      };
    }

    let alias = signedMessage.data?.name;

    if (!alias) {
      response.code(400);
      return {
        status: "ERROR",
        reason: "Alias missing.",
      };
    }

    alias = alias.toLowerCase();

    if (alias === "satoshi") {
      response.code(400);
      return {
        status: "ERROR",
        reason: "Nah. Don't claim to be satoshi.",
      };
    }

    if (!sanitizeLightningAddress(alias)) {
      response.code(400);
      return {
        status: "ERROR",
        reason: "Lightning Address must to be alphanumeric and between 4-16 symbols.",
      };
    }

    if (await getUserByAlias(db, alias)) {
      response.code(400);
      return {
        status: "ERROR",
        reason: `Alias ${alias} already in use. Choose another one.`,
      };
    }

    if (!(await checkIfWalletHasChannel(lightning, hexToUint8Array(pubkey)))) {
      response.code(400);
      return {
        status: "ERROR",
        reason: "You need a channel with the Lightning Box LSP.",
      };
    }

    await createUser(db, { alias, pubkey: pubkey });

    return {
      status: "OK",
      user: {
        alias,
        lightningAddress: `${alias}@${config.domain}`,
        pubkey,
      },
    };
  });
} as FastifyPluginAsync<{
  lightning: Client;
  router: Client;
}>;

export default User;

function sanitizeLightningAddress(subject: string) {
  return /^[a-z0-9]{4,16}$/.test(subject);
}

async function checkIfWalletHasChannel(lightning: Client, pubkey: Uint8Array) {
  const channels = await listChannels(lightning, pubkey);
  return channels.channels?.length > 0;
}
