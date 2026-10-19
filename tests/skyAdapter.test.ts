import { describe, it, expect } from "vitest";
import { Sky } from "../beacon-api/src/index";
import type { Pilot } from "../beacon-api/src/sky";

/** A hibernatable socket as the Sky adapter sees it. */
class FakeSocket {
  attachment: unknown;
  sent: string[] = [];
  closedWith: number | null = null;
  constructor(attachment: unknown) { this.attachment = attachment; }
  send(data: string) { this.sent.push(data); }
  close(code?: number) { this.closedWith = code ?? null; }
  serializeAttachment(v: unknown) { this.attachment = v; }
  deserializeAttachment() { return this.attachment; }
}

const pilot = (id: string): Pilot => ({
  id, cc: "ID", last: { p: [1, 2, 3], q: [0, 0, 0, 1], plume: "stock" }, lastAt: Date.now(), recent: [], visitor: null,
});
const me = JSON.stringify({ t: "me", p: [1, 2, 3], q: [0, 0, 0, 1], plume: "stock" });

function room(...ids: string[]) {
  const sockets = ids.map((id) => new FakeSocket(pilot(id)));
  const ctx = { acceptWebSocket() {}, getWebSockets: () => sockets };
  return { sky: new Sky(ctx as never, {}), sockets };
}

describe("Sky adapter", () => {
  it("a flooder is closed, forgotten in its attachment, and leaves exactly once", () => {
    const { sky, sockets: [a, b] } = room("a", "b");
    for (let i = 0; i < 11; i++) sky.webSocketMessage(a as never, me);
    expect(a.closedWith).toBe(1008);
    expect(a.attachment).toBeNull();
    const peersBefore = b.sent.filter((m) => m.includes('"t":"peers"')).length;
    sky.webSocketClose(a as never); // the runtime's own close event follows
    expect(b.sent.filter((m) => m.includes('"t":"peers"')).length).toBe(peersBefore);
  });
  it("a room rebuilt from attachments skips a pilot that already left", () => {
    const { sky, sockets } = room("a", "b");
    sky.webSocketClose(sockets[0] as never);
    const ctx = { acceptWebSocket() {}, getWebSockets: () => sockets };
    const rebuilt = new Sky(ctx as never, {});
    rebuilt.webSocketMessage(sockets[1] as never, me);
    const snap = sockets[1].sent.map((m) => JSON.parse(m)).filter((m) => m.t === "snap").at(-1);
    expect(snap.ships.map((s: { id: string }) => s.id)).not.toContain("a");
  });
  it("a pilot restored from a pre-C2 attachment can still announce", () => {
    const { sky, sockets: [a, b] } = room("a", "b");
    sky.webSocketMessage(a as never, JSON.stringify({ t: "me", p: [1, 2, 3], q: [0, 0, 0, 1], plume: "stock", ch: 5 }));
    sky.webSocketMessage(a as never, '{"t":"charted"}');
    expect(b.sent.filter((m) => m === '{"t":"charted","cc":"ID"}')).toHaveLength(1);
    expect(a.sent.some((m) => m.includes('"t":"charted"'))).toBe(false);
  });
});
