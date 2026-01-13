import type { Express, Request, Response } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket as WsWebSocket } from "ws";
import { newWebSocketRpcSession, nodeHttpBatchRpcResponse } from "capnweb";
import { StreamControlApiServer } from "./api-server";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WsWebSocket) => {
    const apiServer = new StreamControlApiServer();
    newWebSocketRpcSession(ws as unknown as WebSocket, apiServer);
  });

  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    if (url.pathname === '/rpc') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  app.post('/rpc', async (req: Request, res: Response) => {
    const apiServer = new StreamControlApiServer();
    await nodeHttpBatchRpcResponse(req, res, apiServer);
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return httpServer;
}
