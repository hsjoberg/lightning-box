import { Client } from "@grpc/grpc-js";
import Long from "long";
import { Stream } from "stream";
import { DuplexMock, BufferWritableMock } from "stream-mock";

import { lnrpc } from "../../src/proto";
import { stringToUint8Array } from "../../src/utils/common";

export async function getInfo(lightning: Client) {
  const getInfoResponse = lnrpc.GetInfoResponse.create({
    identityPubkey: "abc",
  });
  return getInfoResponse;
}

export async function estimateFee(lightning: Client, amount: Long, targetConf: number) {
  const estimateFeeResponse = lnrpc.EstimateFeeResponse.create({
    feeSat: Long.fromValue(10),
    feerateSatPerByte: Long.fromValue(100),
  });
  return estimateFeeResponse;
}

let verifyMessageValidSig = true;
export const __verifyMessageSetValidSig = (valid: boolean) => (verifyMessageValidSig = valid);
export async function verifyMessage(lightning: Client, message: string, signature: string) {
  const verifyMessageResponse = lnrpc.VerifyMessageResponse.create({
    pubkey: verifyMessageValidSig ? "abcdef12345" : "notvalidsig",
  });
  return verifyMessageResponse;
}

export async function listPeers(lightning: Client) {
  const listPeersReponse = lnrpc.ListPeersResponse.create({
    peers: [
      {
        pubKey: "abcdef12345",
      },
    ],
  });
  return listPeersReponse;
}

export const openChannelSync = jest.fn(() => {
  const openChannelSyncResponse = lnrpc.ChannelPoint.create({
    fundingTxidBytes: stringToUint8Array("abcdef"),
    outputIndex: 0,
  });
  return openChannelSyncResponse;
});

export const __htlcInterceptorStream = new DuplexMock();
export function htlcInterceptor(router: Client) {
  return __htlcInterceptorStream;
}

export const __subscribeHtlcEventsStream = new BufferWritableMock();
export function subscribeHtlcEvents(router: Client) {
  return __subscribeHtlcEventsStream;
}

export function subscribeChannelEvents(lightning: Client) {
  return new Stream();
}

export const checkPeerConnected = jest.fn(() => {
  return true;
});

export function subscribePeerEvents(lightning: Client) {
  return new Stream();
}
