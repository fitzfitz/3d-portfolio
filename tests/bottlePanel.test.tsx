import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import BottlePanel from "../src/components/layout/BottlePanel";
import { useSpaceStore } from "../src/store/spaceStore";
import { EMPTY_DRAFT, draftReducer, draftView, sendDraft, type Draft } from "../src/utils/bottleDraft";
import { bottleReasonMessage, BOTTLE_MAX_CHARS } from "../src/utils/bottleFilter";
import type { DropResult } from "../src/utils/beaconApi";

/*
 * The writing panel (spec "Writing a note"): a text box with a live counter,
 * instant filter feedback, Send and Cancel, and the text kept after an error.
 * There is no DOM in these tests, so the panel's state lives in a pure
 * reducer (src/utils/bottleDraft.ts) that the component drives.
 */

const initialState = useSpaceStore.getInitialState();
const pristine = { ...initialState };
const seed = (patch: Partial<typeof pristine>) => { Object.assign(initialState, patch); useSpaceStore.setState(patch); };
afterEach(() => { Object.assign(initialState, pristine); useSpaceStore.setState(pristine, true); });

const typed = (text: string): Draft => draftReducer(EMPTY_DRAFT, { type: "edit", text });

describe("draftView", () => {
  it("counts characters, not UTF-16 units, against the 140 limit", () => {
    expect(draftView(typed("hello")).count).toBe(5);
    expect(draftView(typed("🌊🍾")).count).toBe(2);
    expect(draftView(EMPTY_DRAFT).max).toBe(BOTTLE_MAX_CHARS);
  });
  it("says nothing about an empty box, and lets nothing send", () => {
    expect(draftView(EMPTY_DRAFT)).toMatchObject({ hint: null, canSend: false });
    expect(draftView(typed("   "))).toMatchObject({ hint: null, canSend: false });
  });
  it("gives the filter's reason at once, with the same function the Worker runs", () => {
    expect(draftView(typed("mail me at a@b.com"))).toMatchObject({ hint: bottleReasonMessage("contact"), canSend: false });
    expect(draftView(typed("hi"))).toMatchObject({ hint: bottleReasonMessage("too_short"), canSend: false });
    const long = typed("a ".repeat(BOTTLE_MAX_CHARS));
    expect(draftView(long)).toMatchObject({ over: true, canSend: false });
  });
  it("lets a good note send", () => {
    expect(draftView(typed("Clear skies, pilot!"))).toMatchObject({ hint: null, canSend: true, over: false });
  });
  it("cannot send twice while one is in flight", () => {
    expect(draftView(draftReducer(typed("Clear skies, pilot!"), { type: "sending" })).canSend).toBe(false);
  });
});

describe("sending a draft", () => {
  const fail: DropResult = { ok: false, reason: "rate", rate: "wait", retryAfter: 372 };

  it("keeps the text after an error, and shows the friendly reason", async () => {
    let d = draftReducer(typed("Clear skies, pilot!"), { type: "sending" });
    d = draftReducer(d, await sendDraft(d.text, async () => fail));
    expect(d.text).toBe("Clear skies, pilot!");
    expect(d.sending).toBe(false);
    expect(draftView(d).hint).toBe("One bottle every 10 minutes. Next in 6:12.");
    expect(draftView(d).canSend).toBe(true);
  });
  it("keeps the text after a server rejection too", async () => {
    let d = typed("Clear skies, pilot!");
    d = draftReducer(d, await sendDraft(d.text, async () => ({ ok: false, reason: "rejected", filter: "profanity" })));
    expect(d.text).toBe("Clear skies, pilot!");
    expect(draftView(d).hint).toBe(bottleReasonMessage("profanity"));
  });
  it("clears the error as soon as the pilot edits", async () => {
    let d = draftReducer(typed("Clear skies, pilot!"), await sendDraft("Clear skies, pilot!", async () => fail));
    d = draftReducer(d, { type: "edit", text: "Clear skies, pilot!!" });
    expect(d.error).toBeNull();
    expect(draftView(d).hint).toBeNull();
  });
  it("forgets the failure on Cancel or reopen, but keeps the text", async () => {
    const failed = draftReducer(typed("Clear skies, pilot!"), await sendDraft("Clear skies, pilot!", async () => fail));
    expect(failed.error).not.toBeNull();
    const d = draftReducer(failed, { type: "dismiss" });
    expect(d.error).toBeNull();
    expect(d.text).toBe("Clear skies, pilot!");
    expect(draftView(d).hint).toBeNull();
    // Nothing to forget: the same draft back, so React skips the render.
    expect(draftReducer(d, { type: "dismiss" })).toBe(d);
  });
  it("keeps a send in flight across a dismiss", () => {
    const d = draftReducer(draftReducer(typed("Clear skies, pilot!"), { type: "sending" }), { type: "dismiss" });
    expect(d.sending).toBe(true);
  });
  it("empties the box once the bottle is away", async () => {
    const sent = await sendDraft("Clear skies, pilot!", async () => ({
      ok: true, bottle: { id: "n1", x: 1, y: 2, z: 3, text: "Clear skies, pilot!", at: 1, country: null },
    }));
    expect(sent).toEqual({ type: "sent" });
    expect(draftReducer(typed("Clear skies, pilot!"), sent)).toEqual(EMPTY_DRAFT);
  });
  it("reads a thrown send as offline, never as a stuck panel", async () => {
    const d = draftReducer(draftReducer(typed("Clear skies, pilot!"), { type: "sending" }),
      await sendDraft("Clear skies, pilot!", async () => { throw new Error("boom"); }));
    expect(d.sending).toBe(false);
    expect(d.text).toBe("Clear skies, pilot!");
    expect(d.error).toMatch(/offline/);
  });
});

describe("BottlePanel", () => {
  it("renders nothing while closed", () => {
    seed({ bottlePanelOpen: false });
    expect(renderToStaticMarkup(<BottlePanel />)).toBe("");
  });
  it("renders a labelled text box, a counter, Send and Cancel", () => {
    seed({ bottlePanelOpen: true });
    const html = renderToStaticMarkup(<BottlePanel />);
    expect(html).toContain('data-testid="bottle-panel"');
    expect(html).toMatch(/<textarea[^>]*data-testid="bottle-text"/);
    expect(html).toMatch(/<textarea[^>]*aria-describedby="[^"]*bottle-count/);
    expect(html).toContain(`0/${BOTTLE_MAX_CHARS}`);
    expect(html).toMatch(/<button[^>]*data-testid="bottle-send"[^>]*disabled=""/);
    expect(html).toContain('data-testid="bottle-cancel"');
    // The disclosure: where it goes and who sees what.
    expect(html).toMatch(/country/i);
  });
  // Spec "Safety": the note is plain text, always.
  it("never renders text as markup", () => {
    const src = readFileSync("src/components/layout/BottlePanel.tsx", "utf8");
    expect(src).not.toContain("dangerouslySetInnerHTML");
    expect(src).not.toContain("innerHTML");
  });
});

describe("BottlePanel, while sending", () => {
  it("makes the textarea read-only during SENDING so edits are not lost", () => {
    const src = readFileSync("src/components/layout/BottlePanel.tsx", "utf8");
    expect(src).toMatch(/<textarea[^>]*readOnly=\{draft\.sending\}/s);
  });
});

describe("BottlePanel, touch", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("asks the on-screen keyboard for sentences and a Send key", () => {
    seed({ bottlePanelOpen: true });
    const html = renderToStaticMarkup(<BottlePanel />);
    expect(html).toMatch(/<textarea[^>]*enterKeyHint="send"/i);
    expect(html).toMatch(/<textarea[^>]*autoCapitalize="sentences"/i);
  });
});
