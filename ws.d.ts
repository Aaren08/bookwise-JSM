declare module "ws" {
  export class WebSocket {
    static readonly OPEN: number;
    readonly readyState: number;
    send(data: string): void;
  }

  export class WebSocketServer {
    constructor(options: { host?: string; port: number });
    clients: Set<WebSocket>;
    on(
      event: "connection",
      listener: (socket: WebSocket) => void,
    ): WebSocketServer;
    on(event: "error", listener: (error: unknown) => void): WebSocketServer;
  }
}
