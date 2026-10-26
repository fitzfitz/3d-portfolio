# Ring race (design)

**Date:** 2026-10-26.
**Status:** decisions from the owner in conversation. The controller's calls are marked *(my call)*.
**Replaces:** the solo ring time trial (`RingCourse.tsx`, `src/utils/race.ts`, `src/data/ringCourse.ts`, `RaceHUD.tsx`).

## Why

The ring course is a solo time trial: 10 rings packed inside the inner system (r < 115), always on screen. The owner finds the rings too close together and their purpose unclear. The owner wants the rings to become a **race between visitors**: something to do in the universe with friends or strangers.

## Goals
- Pilots race each other through a ring course: friends invited by link, or strangers who happen to be flying at the same time.
- A lone pilot can still race, against a replay of the best lap.
- Results can't be faked by editing the browser's storage.
- **Little extra load on the server** (the owner's words: "I don't want to burden my server").

## Non-goals and anti-goals
- **Never forced on anyone.** A visitor (often a recruiter) who doesn't fly to the start or open a race link never sees a ring, a button or a popup. Racers' ships show as live-sky ghosts, as today. The one exception is an ambient radio line, the same kind as today's live-sky "charted" shout-out (see The start gate).
- No shooting, no collisions, no blocking: racers can't touch each other.
- No chat, no accounts, no names, no leaderboard pages. The one stored record is the best lap.
- **Shards stay as they are for now.** The owner agreed they become the game's money in the coins stage (later); race prizes in shards come then.

## Decisions (owner, 2026-10-26)

| Question | Decision |
|---|---|
| What the rings become | **A race between pilots**, minimum 2 |
| Who races | **Friends sent a link**, or **strangers flying at the same time** |
| Where it starts | Pilots **go to a start point**; the **rings appear when the race starts** |
| Course | Rings **spread much farther apart** than today |
| Alone at the start | After **about 30 s** with nobody else, **race a replay of the best lap** |
| Race records | Kept **on the pilot's device first, sealed so they can't be edited**, and **uploaded when the race is over** |
| Sealing | **The server stamps each ring as it is passed, with a signature only the server can make.** The browser stores the stamps. |
| Missed upload | **Anyone whose upload hasn't arrived 30 s after the race ends is not part of the results** |
| When a race ends | **30 s after the first pilot finishes ("final call"), or 3 minutes after the start**, whichever comes first |
| Pilots who don't finish | **DNF**, ranked after finishers by rings passed. Nobody waits for them. |
| Server storage | **The race lives only in the live-sky server's short-term memory**, gone once results are out. **Only the single best lap is stored permanently.** |
| Old stamps | Carry the race id and an expiry; cleared on the next visit |

## Behaviour

### The start gate
- One **start gate** in the inner system replaces today's ring 0 "TIME TRIAL GATE". It is always visible, scannable, on the radar, and reachable within about 20 s of the spawn pad *(my call)*. Its scan line says what it is: a race start.
- Fly within about 15 u of the gate and the HUD offers **JOIN RACE (R)** *(my call: R is unbound today)*. On touch it is a button; on a pad it is a free face button (the builder picks one and lists it).
- Joining needs live sky. If live sky is off, the prompt says joining turns it on for the race, and turns it back off afterwards.

### Two ways in
- **Strangers (the public race).** Everyone who joins at the gate is in the same public lobby.
  - The lobby shows who is waiting, by country code; "YOU" marks the pilot.
  - When a second pilot joins, a **15 s countdown to the start** runs, and others can still join *(my call)*.
  - The radio tells pilots anywhere in the sky when someone is waiting at the gate, at most once a minute *(my call)*. It is an ambient line only, like the "charted" shout-out: no button, no popup. The strangers' race depends on pilots hearing of it.
- **Friends (a private race).** In the lobby, **INVITE FRIENDS** makes a private race and copies a link: `?race=<code>` (6 characters).
  - Opening the link starts the visitor **at the start gate, already in that race**, instead of on the spawn pad *(my call; the owner said "all good" to it)*. The usual live-sky notice still shows.
  - The pilot who made it presses **START** when ready; it needs at least 2 pilots.
  - An unused code expires after 15 minutes. A late or expired link opens the normal site with a radio line: the race has ended *(my call)*.
- **Alone:** a pilot waiting 30 s with nobody else is offered **RACE THE BEST LAP**, or starts it right away. The replay is the stored best lap, drawn as today's sky-blue ghost ship.
  - It runs on the server as **a race of one**, with stamps like any race. It earns the badge, and beating the replay sets a new best lap *(my call)*.
  - **The first best lap** ships with the site: a steady lap through the ring centres at a pace a good pilot can beat (like today's par), stored as the D1 row's starting value. The first faster real lap replaces it *(my call)*.
- A race takes **up to 8 pilots** (`MAX_GHOSTS` is 8) *(my call)*.

### The race
- **The grid.** At 3-2-1, each racer is placed in a slot just behind the start gate, facing it, and held still. At GO the hold releases *(my call)*. Every racer's time runs from the server's GO, so nobody can creep ahead during the countdown.
- **3-2-1-GO.** At GO the rings appear, **for racers only**. Everyone else never sees them.
- **Speed.** While racing, the ship is held to normal warp (`SHIP_WARP_SPEED`, 39 u/s). The open-space cruise build-up (`CRUISE_MAX_FACTOR`, up to 12×) is off *(my call)*. Without this, a lap takes seconds, rings are missed between frames, and the server's speed check can't use one fixed number. With it, fuel matters: a 1,750 u lap is about 45 s of pure warp, and the tank holds 62.5 s.
- Fly the rings in order and back through the start gate. Crossing works as today (`crossesGate`: steps of 10 u or more don't count).
- While racing, jumps (keys 1–9), the guide's auto-travel, and dossiers opening by beam are **off** *(my call)*. Opening the classic CV or closing the tab makes the pilot **DNF**.
- The race clock is the server's: the start time and every stamp come from the server.
- **Final call:** when the first pilot finishes, every racer sees a 30 s countdown. When it ends, or at 3 minutes after GO, **the race is over**.

### Results
- When the race is over, each racer's device uploads its stamps in **one HTTP request** to the Worker, which passes the result to the race. A finisher whose time may beat the best lap sends their path in the same request *(my call)*. Live-sky messages stay small (256 bytes).
- The server waits **30 s** for uploads, then publishes results to everyone who uploaded:
  - finishers by time;
  - then DNF by rings passed (ties by the time of their last ring);
  - pilots with no upload don't appear.
- The results card shows place, time or DNF, country code, and "YOU". It offers:
  - **RACE AGAIN:** everyone who presses it within 20 s goes into a new countdown together *(my call)*.
  - **CLOSE:** back to free flight.
- The fastest valid finish, if it beats the stored best lap, becomes the new best lap: the lone-pilot replay.
- The "ring" badge ("Ring runner", magenta plume) now comes from **finishing a race**, against people or the best lap *(my call; today it is a lap under 1:00, which the longer course would break)*. Pilots who already hold it keep it. The personal best stays in `fitz-race-best`.

### Stamps (the sealing)
- When the client crosses ring *i*, it sends a small message on its live-sky socket. The server answers with a **stamp**: race id, pilot id, ring *i*, server time, and a signature.
  - The signature is an HMAC with a **new Worker secret** (not `IP_SALT`).
  - The server does not keep the stamps. It keeps only each race's roster, start time and state.
- Before signing, the server checks two things:
  - the pilot is in that race, and the race is running;
  - the pilot's last live-sky position is within the ring radius plus a margin of ring *i* (the builder sets the margin).
- **Who the racer is.** Joining gives the racer a **race token** (random, kept by the server in the roster). Stamps name the token, not the live-sky socket id, which changes on every reconnect *(my call)*.
  - A racer who reconnects or reloads during the race rejoins with the token and keeps flying and earning stamps.
  - The upload proves the sender by the token.
- **The start stamp.** GO is a signed stamp too: race id, start time. Uploads are checked against it, so a stamp set proves itself even after the race state is gone.
- The client stores the token and stamps in localStorage under one `fitz-race-*` key, with the race id and an expiry. A reload mid-race keeps them.
- **Positions while racing.** A racer sends its live-sky position while in a race even when no other pilot is connected. Today positions are sent only with peers, and the check before signing needs them.
- **At upload, the server rejects a set of stamps when:**
  - any signature fails, or any stamp names another race or pilot;
  - the rings are out of order;
  - any two stamps (including the start stamp) are closer in time than the straight-line distance between their rings at warp speed (39 u/s) allows, minus a small margin. This works because racing caps speed at normal warp.

  This stops faked laps, skipped rings and teleports without the server tracking anyone's flight.
- **The best-lap replay:**
  - The path is recorded at 10 Hz (as today) and uploaded **only** by a finisher whose time beats the stored best, in the results upload.
  - A pilot left out of the results (no upload within the window) can't set the best lap.
  - The server keeps it only if:
    - it matches the stamps: it passes each ring near its stamp time;
    - no step between samples is faster than warp allows.

### Course
- A new loop of 10–12 rings, spread out: about 1,500–2,000 u long *(my call)*. Target times are about 60–90 s for a good pilot and under 3 minutes when cruising.
- It still obeys today's placement tests: clear of orbits, wells, colliders, shards and the portal, and consecutive rings at least 20 u apart. The fuel tank (62.5 s of warp, refills when not warping) makes fuel part of racing.
- `PAR_SECONDS` goes; the best lap replaces it.

## Server notes (for the builder)
- **Room:** the race lives in the existing live-sky Durable Object (`Sky`, one room "sky", 40 sockets). Racers are live-sky pilots.
- **Hibernation:** the object sleeps, so race state and timers must survive it. Use Durable Object storage or socket attachments, and DO alarms instead of `setTimeout`.
- **Messages:** `parseClient` caps messages at 256 bytes and ignores unknown types, so an old client is unaffected.
  - Lobby and ring messages go over the socket.
  - The end-of-race upload (stamps, and the path when it may be a best lap) goes over HTTP.
- **Storage:** the best lap is one new D1 table (one row per course).
- **Deploy order (each step needs the owner's word, CLAUDE.md):**
  1. The new secret (`wrangler secret put … --config beacon-api/wrangler.toml`).
  2. The D1 migration.
  3. The Worker.
  4. The site.

## Safety and limits
- The race needs no new personal data: pilot ids and country codes already exist in live sky.
- The existing flood limit (10 messages/s) and request limiter stay. Ring messages are rare, at most one per ring.
- A visitor already limited to 3 live-sky places can't pad a race beyond that.

## Removed or changed
- **Removed:**
  - the solo time trial flow (the start through ring 0, `PAR_SECONDS`, "TIME TRIAL" HUD and radio lines);
  - the local-only race ghost key (`fitz-race-ghost`), superseded by the stored best lap;
  - the always-visible rings.
- **Changed:** the ring 0 "TIME TRIAL GATE" scannable becomes the start gate. The "ring" badge rule changes as above.
- **Tests:**
  - The course placement tests move to the new course.
  - New unit tests cover:
    - stamp signing and verification, including a forged signature, out-of-order rings, the too-fast check and another pilot's stamps;
    - the lobby and countdown rules;
    - the end rules: final call, the 3-minute limit, the 30 s upload window;
    - ranking, with finishers and DNF.
  - An e2e probe runs a race of two browser pages, plus a lone-pilot race against the best lap.
- **Changelog:** one visitor-facing entry.

## Out of scope
- Shards as money, and race prizes (the coins stage).
- Combat, PvP and power-ups on the course.
- More than one race at a time in the public lobby.
- Seasons, leaderboards beyond the one best lap, and names.
