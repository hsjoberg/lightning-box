import { Client } from "@grpc/grpc-js";

export const rpcImpl = jest.fn();

export const getGrpcClients = () => jest.fn();

export const grpcReqSerialize = (args: any) => jest.fn();

export const grpcReqDeserialize = (args: any) => jest.fn();

export const grpcMakeUnaryRequest = <Response = unknown>(
  client: Client,
  method: string,
  argument: Uint8Array,
  decoder = (data: Uint8Array) => data as any,
) => jest.fn();
