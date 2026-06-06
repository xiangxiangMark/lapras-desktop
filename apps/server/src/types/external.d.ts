declare module "node:sqlite" {
  export class StatementSync {
    run(params?: unknown): unknown;
    get(params?: unknown): unknown;
    all(params?: unknown): unknown[];
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

declare module "ws" {
  export class WebSocket {
    static readonly OPEN: number;
    readonly OPEN: number;
    readyState: number;
    send(data: string): void;
    on(event: "close", listener: () => void): void;
    close(): void;
  }
}
