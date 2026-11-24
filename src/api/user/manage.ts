import { FastifyPluginAsync } from "fastify";
import { Client } from "@grpc/grpc-js";
import { createHash } from "crypto";

import { hexToUint8Array, isValidNodePubkey } from "../../utils/common";
import { listChannels, verifyMessage } from "../../utils/lnd-api";
import getDb from "../../db/db";
import { createUser, getUserByAlias, getUserByPubkey } from "../../db/user";
import config from "../../../config/config";

interface ISignedMessage {
  nonce?: string;
  endpoint?: string;
  timestamp?: number; // This is a unix timestamp
  data?: { [k: string]: unknown };
}

const SIGNED_MESSAGE_MAX_AGE_SECONDS = 30;
const consumedSignedMessages = new Map<string, number>();

const User = async function (app, { lightning, router }) {
  const db = await getDb();

  /**
   *
   * Each message is signed by the wallet's key. We therefore get their pubkey from the signature.
   *
   * In order to prevent replay attacks, each signed message contains a UNIX timestamp and is
   * accepted only once. Requests older than 30 seconds will be rejected.
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
  const getUserEndpoint = "/user/get-user";
  app.post(getUserEndpoint, async (request, response) => {
    const authentication = await authenticateSignedRequest(
      lightning,
      request.body,
      getUserEndpoint,
    );
    if (!authentication.authenticated) {
      response.code(400);
      return {
        status: "ERROR",
        reason: authentication.reason,
      };
    }

    const user = await getUserByPubkey(db, authentication.pubkey);

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
  const checkEligibilityEndpoint = "/user/check-eligibility";
  app.post(checkEligibilityEndpoint, async (request, response) => {
    const authentication = await authenticateSignedRequest(
      lightning,
      request.body,
      checkEligibilityEndpoint,
    );
    if (!authentication.authenticated) {
      response.code(400);
      return {
        status: "ERROR",
        reason: authentication.reason,
      };
    }

    const pubkey = authentication.pubkey;
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
  const registerEndpoint = "/user/register";
  app.post(registerEndpoint, async (request, response) => {
    const authentication = await authenticateSignedRequest(
      lightning,
      request.body,
      registerEndpoint,
    );
    if (!authentication.authenticated) {
      response.code(400);
      return {
        status: "ERROR",
        reason: authentication.reason,
      };
    }

    const { pubkey, signedMessage } = authentication;

    if (await getUserByPubkey(db, pubkey)) {
      response.code(400);
      return {
        status: "ERROR",
        code: "HAS_USER",
        reason: `You have a user already.`,
      };
    }

    const requestedAlias = signedMessage.data?.name;

    if (typeof requestedAlias !== "string") {
      response.code(400);
      return {
        status: "ERROR",
        reason: "Alias missing.",
      };
    }

    const alias = requestedAlias.toLowerCase();

    if (alias === "satoshi") {
      response.code(400);
      return {
        status: "ERROR",
        reason: "Nah. Don't claim to be satoshi.",
      };
    } else if (isValidNodePubkey(alias)) {
      response.code(400);
      return {
        status: "ERROR",
        reason: "Your username can't be a Lightning node pubkey.",
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

    if (!(await createUser(db, { alias, pubkey }))) {
      response.code(400);
      return {
        status: "ERROR",
        reason: "Alias or node pubkey is already registered.",
      };
    }

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

type AuthenticationResult =
  | {
      authenticated: true;
      pubkey: string;
      signedMessage: ISignedMessage;
    }
  | {
      authenticated: false;
      reason: string;
    };

async function authenticateSignedRequest(
  lightning: Client,
  body: unknown,
  expectedEndpoint: string,
): Promise<AuthenticationResult> {
  const signedRequest = parseSignedRequestBody(body);
  if (!signedRequest) {
    return { authenticated: false, reason: "Invalid request." };
  }

  let signedMessage: ISignedMessage;
  try {
    const parsedMessage = JSON.parse(signedRequest.message) as unknown;
    if (!isRecord(parsedMessage)) {
      return { authenticated: false, reason: "Invalid request." };
    }
    signedMessage = parsedMessage as ISignedMessage;
  } catch {
    return { authenticated: false, reason: "Invalid request." };
  }

  if (signedMessage.endpoint !== expectedEndpoint) {
    return { authenticated: false, reason: "Invalid request." };
  }

  const currentTime = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(signedMessage.timestamp) ||
    Math.abs(currentTime - signedMessage.timestamp!) > SIGNED_MESSAGE_MAX_AGE_SECONDS
  ) {
    return {
      authenticated: false,
      reason: "Request is either too old or from the future.",
    };
  }

  const verificationResult = await verifyMessage(
    lightning,
    signedRequest.message,
    signedRequest.signature,
  );
  const pubkey = verificationResult.pubkey;
  if (!verificationResult.valid || !pubkey || !isValidNodePubkey(pubkey)) {
    return { authenticated: false, reason: "Invalid signature." };
  }

  const requestDigest = createHash("sha256")
    .update(pubkey)
    .update("\0")
    .update(signedRequest.message)
    .digest("hex");
  const now = Date.now();

  for (const [digest, expiresAt] of consumedSignedMessages) {
    if (expiresAt <= now) {
      consumedSignedMessages.delete(digest);
    }
  }

  if (consumedSignedMessages.has(requestDigest)) {
    return { authenticated: false, reason: "Request has already been used." };
  }
  consumedSignedMessages.set(
    requestDigest,
    now + SIGNED_MESSAGE_MAX_AGE_SECONDS * 2 * 1000,
  );

  return { authenticated: true, pubkey, signedMessage };
}

function parseSignedRequestBody(body: unknown): { message: string; signature: string } | null {
  let parsedBody = body;
  if (typeof parsedBody === "string") {
    try {
      parsedBody = JSON.parse(parsedBody) as unknown;
    } catch {
      return null;
    }
  }

  if (!isRecord(parsedBody)) {
    return null;
  }

  const { message, signature } = parsedBody;
  if (
    typeof message !== "string" ||
    message.length === 0 ||
    message.length > 12 * 1024 ||
    typeof signature !== "string" ||
    signature.length === 0 ||
    signature.length > 2048
  ) {
    return null;
  }

  return { message, signature };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
