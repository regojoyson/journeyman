// packages/web/src/auth/broadcast.ts

export type AuthBroadcastEvent =
  | { type: "session-started"; exp: number }
  | { type: "session-refreshed"; exp: number }
  | { type: "logout" };

const CHANNEL_NAME = "auth";

export interface AuthBroadcaster {
  post(event: AuthBroadcastEvent): void;
  subscribe(cb: (event: AuthBroadcastEvent) => void): () => void;
  close(): void;
}

class BroadcastChannelImpl implements AuthBroadcaster {
  private channel: BroadcastChannel;
  constructor() {
    this.channel = new BroadcastChannel(CHANNEL_NAME);
  }
  post(event: AuthBroadcastEvent): void {
    this.channel.postMessage(event);
  }
  subscribe(cb: (event: AuthBroadcastEvent) => void): () => void {
    const handler = (e: MessageEvent<AuthBroadcastEvent>) => cb(e.data);
    this.channel.addEventListener("message", handler);
    return () => this.channel.removeEventListener("message", handler);
  }
  close(): void {
    this.channel.close();
  }
}

class NoopBroadcaster implements AuthBroadcaster {
  post(): void {}
  subscribe(): () => void { return () => {}; }
  close(): void {}
}

export function createAuthBroadcaster(): AuthBroadcaster {
  if (typeof BroadcastChannel === "undefined") return new NoopBroadcaster();
  return new BroadcastChannelImpl();
}
