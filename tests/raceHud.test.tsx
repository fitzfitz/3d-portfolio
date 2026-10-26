import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RacePanel, type RacePanelProps } from "../src/components/layout/RaceHUD";
import { raceTicks, resultRowText, raceButtons, inviteLink, copyText, type RaceButton } from "../src/utils/raceHud";
import { raceJoinMessage, RACE_IDLE, type RaceView } from "../src/utils/raceSession";
import { raceLink } from "../src/utils/raceLink";
import { resetRaceJoin, joinPending } from "../src/utils/raceJoin";
import { startPose } from "../src/store/flightState";
import { raceLinkCode } from "../src/utils/flightGate";
import { isInviteCode } from "../src/utils/raceProtocol";
import { gridSlot } from "../src/utils/race";
import { START_GATE, RING_GATES } from "../src/data/ringCourse";
import { SPAWN } from "../src/data/spawn";
import { useSpaceStore } from "../src/store/spaceStore";
import type { LiveSkyConnection } from "../src/utils/liveSkyConnection";
import type { LobbyPilot, ResultRow } from "../src/utils/raceProtocol";

const N = RING_GATES.length;
const T = 1_000_000;
const s = () => useSpaceStore.getState();

let sent: unknown[];
beforeEach(() => {
  vi.useFakeTimers({ now: T });
  sent = [];
  raceLink.conn = { connected: true, sendRace: (m: unknown) => { sent.push(m); return true; } } as unknown as LiveSkyConnection;
  resetRaceJoin();
  useSpaceStore.setState({ raceView: RACE_IDLE, raceLiveSkyRestore: false, liveSky: true, liveSkySeen: true, broadcast: null });
});
afterEach(() => {
  raceLink.conn = null;
  resetRaceJoin();
  vi.useRealTimers();
});

const you: LobbyPilot = { cc: "ID", you: true };
const other: LobbyPilot = { cc: "MY", you: false };
const lobby = (o: Partial<Extract<RaceView, { phase: "lobby" }>> = {}): RaceView =>
  ({ phase: "lobby", race: "race-1", kind: "public", code: null, host: false, pilots: [you], startsAt: null, ...o });
const running = (o: Partial<Extract<RaceView, { phase: "running" }>> = {}): RaceView =>
  ({ phase: "running", race: "race-1", kind: "public", next: 3, goAt: T - 12_300, finalEndsAt: null, finished: false, ...o });
const rows: ResultRow[] = [
  { place: 1, cc: "ID", timeMs: 52_400, rings: N, you: true },
  { place: 2, cc: "MY", timeMs: null, rings: 7, you: false },
];
const results: RaceView = { phase: "results", race: "race-1", rows, againBy: T + 17_000 };

const props = (view: RaceView, o: Partial<RacePanelProps> = {}): RacePanelProps =>
  ({ view, now: T, near: false, joining: false, liveSky: true, keyName: "R", lapMs: null, copy: null, againSent: false, onAgain: () => {}, ...o });
const html = (view: RaceView, o: Partial<RacePanelProps> = {}) => renderToStaticMarkup(<RacePanel {...props(view, o)} />);
/** The visible text, tags and React's text separators dropped. */
const text = (h: string) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const ids = (bs: RaceButton[]) => bs.map((b) => b.id);
const ctx = { near: false, joining: false, againSent: false, onAgain: () => {} };
const press = (bs: RaceButton[], id: string) => bs.find((b) => b.id === id)!.run();

describe("raceJoinMessage", () => {
  it("joins the invite's race for a valid ?race= code, else the public race", () => {
    expect(raceJoinMessage("?race=ABC234")).toEqual({ t: "rjoin", code: "ABC234" });
    expect(raceJoinMessage("?race=abc")).toEqual({ t: "rjoin" });
    expect(raceJoinMessage("")).toEqual({ t: "rjoin" });
  });
});

describe("the ?race= deep link's start pose", () => {
  it("starts on grid slot 0 behind the start gate with a code, on the spawn pad without", () => {
    const g = gridSlot(START_GATE, 0);
    expect(startPose("?race=ABC234")).toEqual({ x: g.p.x, y: g.p.y, z: g.p.z, heading: g.heading, pitch: g.pitch, race: true });
    expect(startPose("")).toEqual({ x: SPAWN.x, y: SPAWN.y, z: SPAWN.z, heading: null, pitch: 0, race: false });
    expect(startPose("?race=abc").race).toBe(false);
  });
  it("flightGate reads the code exactly as raceProtocol's isInviteCode does", () => {
    for (const c of ["ABC234", "abc234", "ABC23", "ABC2345", "ABO234", "AB1234", "ZZZZZZ", "222222"]) {
      expect(raceLinkCode({ search: `?race=${c}` }), c).toBe(isInviteCode(c) ? c : null);
    }
    expect(raceLinkCode({ search: "?cv" })).toBeNull();
  });
});

describe("RacePanel, phase by phase", () => {
  it("idle: nothing away from the gate; JOIN RACE (R) within reach, with the live-sky note when it is off", () => {
    expect(html(RACE_IDLE)).toBe("");
    const near = html(RACE_IDLE, { near: true });
    expect(near).toContain('data-testid="race-join"');
    expect(text(near)).toContain("JOIN RACE (R)");
    expect(text(near)).not.toMatch(/LIVE SKY/);
    expect(text(html(RACE_IDLE, { near: true, liveSky: false }))).toContain("JOINING TURNS LIVE SKY ON FOR THE RACE");
    // Touch: a button without a key; a pad names its button.
    expect(text(html(RACE_IDLE, { near: true, keyName: null }))).toContain("JOIN RACE");
    expect(text(html(RACE_IDLE, { near: true, keyName: null }))).not.toContain("(R)");
    expect(text(html(RACE_IDLE, { near: true, keyName: "L3" }))).toContain("JOIN RACE (L3)");
    const joining = html(RACE_IDLE, { near: true, joining: true });
    expect(text(joining)).toContain("JOINING");
    expect(joining).not.toContain('data-testid="race-join"');
  });

  it("lobby: pilots by country, YOU for the pilot; a countdown once it is set", () => {
    const h = text(html(lobby({ pilots: [you, other, { cc: null, you: false }], startsAt: T + 12_000 })));
    expect(h).toContain("YOU");
    expect(h).toContain("MY");
    expect(h).toContain("STARTS IN 0:12");
    expect(text(html(lobby()))).not.toContain("STARTS IN");
  });

  it("lobby buttons: invite (public), the best lap (alone), start (private host, 2+), leave", () => {
    expect(ids(raceButtons(lobby(), ctx))).toEqual(["invite", "solo", "leave"]);
    expect(ids(raceButtons(lobby({ pilots: [you, other] }), ctx))).toEqual(["invite", "leave"]);
    expect(ids(raceButtons(lobby({ kind: "private", code: "ABC234", host: true, pilots: [you, other] }), ctx))).toEqual(["start", "leave"]);
    expect(ids(raceButtons(lobby({ kind: "private", code: "ABC234", host: true }), ctx))).toEqual(["solo", "leave"]);
    expect(ids(raceButtons(lobby({ kind: "private", code: "ABC234", host: false, pilots: [you, other] }), ctx))).toEqual(["leave"]);
    const h = html(lobby());
    for (const id of ["invite", "solo", "leave"]) expect(h).toContain(`data-testid="race-${id}"`);
    expect(text(h)).toContain("INVITE FRIENDS");
    expect(text(h)).toContain("RACE THE BEST LAP");
    expect(text(h)).toContain("LEAVE (R)");
  });

  it("lobby clicks send the right messages; LEAVE also goes back to idle", () => {
    s().setRaceView(lobby({ kind: "private", code: "ABC234", host: true, pilots: [you, other] }));
    press(raceButtons(lobby({ kind: "private", code: "ABC234", host: true, pilots: [you, other] }), ctx), "start");
    press(raceButtons(lobby(), ctx), "solo");
    press(raceButtons(lobby(), ctx), "invite");
    expect(sent).toEqual([{ t: "rstart" }, { t: "rsolo" }, { t: "rinvite" }]);
    press(raceButtons(lobby(), ctx), "leave");
    expect(sent.at(-1)).toEqual({ t: "rleave" });
    expect(s().raceView).toEqual(RACE_IDLE);
  });

  it("the private lobby shows its code and the invite result: LINK COPIED, or the link to copy by hand", () => {
    const priv = lobby({ kind: "private", code: "ABC234", host: true });
    expect(text(html(priv))).toContain("ABC234");
    expect(text(html(priv, { copy: { link: "https://x.test/?race=ABC234", ok: true } }))).toContain("LINK COPIED");
    const failed = text(html(priv, { copy: { link: "https://x.test/?race=ABC234", ok: false } }));
    expect(failed).toContain("https://x.test/?race=ABC234");
    expect(failed).not.toContain("LINK COPIED");
  });

  it("idle JOIN sends rjoin once live sky is connected, then waits for the reply (no second JOIN)", () => {
    press(raceButtons(RACE_IDLE, { ...ctx, near: true }), "join");
    expect(sent).toEqual([{ t: "rjoin" }]);
    expect(joinPending()).toBe(true);
    expect(ids(raceButtons(RACE_IDLE, ctx))).toEqual([]);
    expect(ids(raceButtons(RACE_IDLE, { ...ctx, near: true, joining: true }))).toEqual([]);
  });

  it("grid: a big 3, 2, 1, then GO", () => {
    const grid: RaceView = { phase: "grid", race: "race-1", kind: "public", slot: 0, goAt: T + 3000 };
    expect(raceTicks(grid, T, null).big).toBe("3");
    expect(raceTicks(grid, T + 1500, null).big).toBe("2");
    expect(raceTicks(grid, T + 2001, null).big).toBe("1");
    expect(raceTicks(grid, T + 3000, null).big).toBe("GO");
    expect(text(html(grid))).toContain("3");
    expect(ids(raceButtons(grid, ctx))).toEqual([]);
  });

  it("running: RING n/N, the clock from GO, FINAL CALL once it is set", () => {
    const v = running();
    expect(text(html(v))).toContain(`RING 3/${N}`);
    expect(raceTicks(v, T, null).clock).toBe("0:12.3");
    expect(raceTicks(v, T, null).final).toBe("");
    expect(raceTicks(running({ goAt: T - 400 }), T, null).big).toBe("GO");
    expect(raceTicks(v, T, null).big).toBe("");
    const final = running({ finalEndsAt: T + 23_000 });
    expect(raceTicks(final, T, null).final).toBe("FINAL CALL 0:23");
    expect(text(html(final))).toContain("FINAL CALL 0:23");
    // Finished: the stamped lap time, not a clock still running.
    const done = running({ next: N + 1, finished: true });
    expect(raceTicks(done, T, 52_400).clock).toBe("0:52.4");
    expect(text(html(done, { lapMs: 52_400 }))).toContain("FINISHED");
    expect(ids(raceButtons(v, ctx))).toEqual([]);
  });

  it("over: SENDING RESULT…", () => {
    expect(text(html({ phase: "over", race: "race-1", uploadBy: T + 30_000, finished: true }))).toContain("SENDING RESULT…");
  });

  it("results: one row each, YOU marked; RACE AGAIN with its countdown, and CLOSE", () => {
    expect(resultRowText(rows[0], N)).toBe("P1  ID  0:52.4");
    expect(resultRowText(rows[1], N)).toBe(`DNF  MY  7/${N} RINGS`);
    expect(resultRowText({ place: 3, cc: null, timeMs: 61_000, rings: N, you: false }, N)).toBe("P3  --  1:01.0");
    const h = html(results);
    expect(h).toContain('data-testid="race-row-you"');
    expect(text(h)).toContain("YOU");
    expect(raceTicks(results, T, null).again).toBe("0:17");
    expect(text(h)).toContain("RACE AGAIN");
    expect(text(h)).toContain("0:17");
    expect(ids(raceButtons(results, ctx))).toEqual(["again", "close"]);
    expect(ids(raceButtons(results, { ...ctx, againSent: true }))).toEqual(["close"]);
  });

  it("results clicks: RACE AGAIN sends ragain; CLOSE goes back to idle and gives live sky back", () => {
    const onAgain = vi.fn();
    s().setRaceView(results);
    useSpaceStore.setState({ raceLiveSkyRestore: true });
    press(raceButtons(results, { ...ctx, onAgain }), "again");
    expect(sent).toEqual([{ t: "ragain" }]);
    expect(onAgain).toHaveBeenCalledOnce();
    press(raceButtons(results, ctx), "close");
    expect(s().raceView).toEqual(RACE_IDLE);
    expect(s().liveSky).toBe(false);
  });
});

describe("the invite link", () => {
  it("is the site's own address with the code", () => {
    expect(inviteLink("https://porto.example", "/", "ABC234")).toBe("https://porto.example/?race=ABC234");
    expect(inviteLink("https://x.github.io", "/3d-portfolio/", "ABC234")).toBe("https://x.github.io/3d-portfolio/?race=ABC234");
  });
  it("copies through the clipboard, false when it fails or is missing", async () => {
    const writeText = vi.fn(async () => {});
    expect(await copyText("L", { writeText })).toBe(true);
    expect(writeText).toHaveBeenCalledWith("L");
    expect(await copyText("L", { writeText: async () => { throw new Error("denied"); } })).toBe(false);
    expect(await copyText("L", undefined)).toBe(false);
  });
});
