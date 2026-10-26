/**
 * The world-event director's clock (flying seconds), written once per frame by
 * WorldEventDirector. Mutable outside React, like `flight`, so event
 * animations read it per frame without a subscription.
 */
export const worldClock = { now: 0 };
