import type { Response } from "express";

const CLIENTS = new Map<string, Response>();

export function registerSseClient(id: string, res: Response): void {
  CLIENTS.set(id, res);
}

export function unregisterSseClient(id: string): void {
  CLIENTS.delete(id);
}

export function broadcastSse(payload: unknown): void {
  const data = JSON.stringify(payload);
  for (const [id, res] of CLIENTS) {
    try {
      res.write(`data: ${data}\n\n`);
    } catch {
      CLIENTS.delete(id);
    }
  }
}
