import { Client, Metadata } from "@grpc/grpc-js";
import Long from "long";

import { hexToUint8Array, stringToUint8Array } from "./common";
import { lnrpc, routerrpc } from "../proto";
import { grpcMakeUnaryRequest } from "./grpc";

export async function addInvoice(
  lightning: Client,
  amountMsat: number,
  descriptionHash: Uint8Array,
) {
  const addInvoiceRequest = lnrpc.Invoice.encode({
    valueMsat: Long.fromValue(amountMsat),
    descriptionHash,
  }).finish();
  const response = await grpcMakeUnaryRequest<lnrpc.AddInvoiceResponse>(
    lightning,
    "/lnrpc.Lightning/AddInvoice",
    addInvoiceRequest,
    lnrpc.AddInvoiceResponse.decode,
  );
  return response;
}

export function subscribeInvoices(lightning: Client) {
  const request = lnrpc.InvoiceSubscription.encode({}).finish();
  return lightning.makeServerStreamRequest(
    "/lnrpc.Lightning/SubscribeInvoices",
    (arg: any) => arg,
    (arg) => arg,
    request,
    new Metadata(),
    undefined,
  );
}

export async function decodePayReq(lightning: Client, payReq: string) {
  const decodePayReqRequest = lnrpc.PayReqString.encode({
    payReq,
  }).finish();
  const response = await grpcMakeUnaryRequest<lnrpc.PayReq>(
    lightning,
    "/lnrpc.Lightning/DecodePayReq",
    decodePayReqRequest,
    lnrpc.PayReq.decode,
  );
  return response;
}

export async function sendPaymentSync(lightning: Client, paymentRequest: string) {
  const sendPaymentSyncRequest = lnrpc.SendRequest.encode({
    paymentRequest,
  }).finish();
  const response = await grpcMakeUnaryRequest<lnrpc.SendResponse>(
    lightning,
    "/lnrpc.Lightning/SendPaymentSync",
    sendPaymentSyncRequest,
    lnrpc.SendResponse.decode,
  );
  return response;
}

export async function getInfo(lightning: Client) {
  const getInfoRequest = lnrpc.GetInfoRequest.encode({}).finish();
  const response = await grpcMakeUnaryRequest<lnrpc.GetInfoResponse>(
    lightning,
    "/lnrpc.Lightning/GetInfo",
    getInfoRequest,
    lnrpc.GetInfoResponse.decode,
  );
  return response;
}

export async function estimateFee(lightning: Client, amount: Long, targetConf: number) {
  const estimateFeeRequest = lnrpc.EstimateFeeRequest.encode({
    AddrToAmount: {
      tb1qsl4hhqs8skzwknqhwjcyyyjepnwmq8tlcd32m3: amount,
      tb1qud0w7nh5qh7azyjj0phssxzxp9zqdk8g0czwv6: Long.fromValue(10000),
    },
    targetConf,
  }).finish();

  const response = await grpcMakeUnaryRequest<lnrpc.EstimateFeeResponse>(
    lightning,
    "lnrpc.Lightning/EstimateFee",
    estimateFeeRequest,
    lnrpc.EstimateFeeResponse.decode,
  );
  return response;
}

export async function signMessage(lightning: Client, message: string) {
  const signMessageRequest = lnrpc.SignMessageRequest.encode({
    msg: stringToUint8Array(message),
  }).finish();
  const response = await grpcMakeUnaryRequest<lnrpc.SignMessageResponse>(
    lightning,
    "/lnrpc.Lightning/SignMessage",
    signMessageRequest,
    lnrpc.SignMessageResponse.decode,
  );
  return response;
}

export async function verifyMessage(lightning: Client, message: string, signature: string) {
  const verifyMessageRequest = lnrpc.VerifyMessageRequest.encode({
    msg: stringToUint8Array(message),
    signature: signature,
  }).finish();
  const response = await grpcMakeUnaryRequest<lnrpc.VerifyMessageResponse>(
    lightning,
    "/lnrpc.Lightning/VerifyMessage",
    verifyMessageRequest,
    lnrpc.VerifyMessageResponse.decode,
  );
  return response;
}

export async function listPeers(lightning: Client) {
  const listPeersRequest = lnrpc.ListPeersRequest.encode({}).finish();
  const response = await grpcMakeUnaryRequest<lnrpc.ListPeersResponse>(
    lightning,
    "/lnrpc.Lightning/ListPeers",
    listPeersRequest,
    lnrpc.ListPeersResponse.decode,
  );
  return response;
}

export async function openChannelSync(
  lightning: Client,
  pubkey: string,
  localFundingAmount: Long,
  pushSat: Long,
  privateChannel: boolean,
  spendUnconfirmed: boolean,
) {
  const openChannelSyncRequest = lnrpc.OpenChannelRequest.encode({
    nodePubkey: hexToUint8Array(pubkey),
    localFundingAmount,
    pushSat,
    targetConf: 1,
    minConfs: 0,
    private: privateChannel,
    spendUnconfirmed,
  }).finish();

  return await grpcMakeUnaryRequest<lnrpc.ChannelPoint>(
    lightning,
    "lnrpc.Lightning/OpenChannelSync",
    openChannelSyncRequest,
    lnrpc.ChannelPoint.decode,
  );
}

export function htlcInterceptor(router: Client) {
  return router.makeBidiStreamRequest(
    "/routerrpc.Router/HtlcInterceptor",
    (arg: any) => arg,
    (arg) => arg,
    new Metadata(),
    undefined,
  );
}

export function subscribeHtlcEvents(router: Client) {
  const request = routerrpc.SubscribeHtlcEventsRequest.encode({}).finish();
  return router.makeServerStreamRequest(
    "/routerrpc.Router/SubscribeHtlcEvents",
    (arg: any) => arg,
    (arg) => arg,
    request,
    new Metadata(),
    undefined,
  );
}

export function subscribeChannelEvents(lightning: Client) {
  const request = lnrpc.ChannelEventSubscription.encode({}).finish();
  return lightning.makeServerStreamRequest(
    "/routerrpc.Lightning/SubscribeChannelEvents",
    (arg: any) => arg,
    (arg) => arg,
    request,
    new Metadata(),
    undefined,
  );
}

export async function checkPeerConnected(lightning: Client, pubkey: string) {
  const listPeersResponse = await listPeers(lightning);
  const seekPeer = listPeersResponse.peers.find((peer) => {
    return peer.pubKey === pubkey;
  });

  return !!seekPeer;
}

export async function pendingChannels(lightning: Client) {
  const pendingChannelsRequest = lnrpc.PendingChannelsRequest.encode({}).finish();
  const response = await grpcMakeUnaryRequest<lnrpc.PendingChannelsResponse>(
    lightning,
    "/lnrpc.Lightning/PendingChannels",
    pendingChannelsRequest,
    lnrpc.PendingChannelsResponse.decode,
  );
  return response;
}

export async function listChannels(lightning: Client, peer?: Uint8Array) {
  const listChannelsRequest = lnrpc.ListChannelsRequest.encode({
    peer,
  }).finish();
  const response = await grpcMakeUnaryRequest<lnrpc.ListChannelsResponse>(
    lightning,
    "/lnrpc.Lightning/ListChannels",
    listChannelsRequest,
    lnrpc.ListChannelsResponse.decode,
  );
  return response;
}

export function subscribePeerEvents(lightning: Client) {
  const request = lnrpc.PeerEventSubscription.encode({}).finish();
  return lightning.makeServerStreamRequest(
    "/lnrpc.Lightning/SubscribePeerEvents",
    (arg: any) => arg,
    (arg) => arg,
    request,
    new Metadata(),
    undefined,
  );
}

export async function sendCustomMessage(
  lightning: Client,
  peerPubkey: string,
  type: number,
  dataString: string,
) {
  const sendCustomMessageRequest = lnrpc.SendCustomMessageRequest.encode({
    peer: hexToUint8Array(peerPubkey),
    type,
    data: stringToUint8Array(dataString),
  }).finish();
  const response = await grpcMakeUnaryRequest<lnrpc.SendCustomMessageResponse>(
    lightning,
    "/lnrpc.Lightning/SendCustomMessage",
    sendCustomMessageRequest,
    lnrpc.SendCustomMessageResponse.decode,
  );
  return response;
}

export function SubscribeCustomMessages(lightning: Client) {
  const request = lnrpc.SubscribeCustomMessagesRequest.encode({}).finish();
  return lightning.makeServerStreamRequest(
    "/lnrpc.Lightning/SubscribeCustomMessages",
    (arg: any) => arg,
    (arg) => arg,
    request,
    new Metadata(),
    undefined,
  );
}
