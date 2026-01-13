import { newWebSocketRpcSession, newHttpBatchRpcSession, RpcStub } from "capnweb";
import type { StreamControlApi } from "@shared/api";

let wsSession: RpcStub<StreamControlApi> | null = null;

export function getWsRpcClient(): RpcStub<StreamControlApi> {
  if (!wsSession) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/rpc`;
    wsSession = newWebSocketRpcSession<StreamControlApi>(wsUrl);
  }
  return wsSession;
}

export function getHttpRpcClient(): RpcStub<StreamControlApi> {
  const rpcUrl = `${window.location.origin}/rpc`;
  return newHttpBatchRpcSession<StreamControlApi>(rpcUrl);
}

export function disposeWsSession(): void {
  if (wsSession) {
    wsSession[Symbol.dispose]();
    wsSession = null;
  }
}

export const api = {
  get ws() {
    return getWsRpcClient();
  },
  get http() {
    return getHttpRpcClient();
  },
};

export type { StreamControlApi };
