import type { Clock, IdSource, Random } from "./deps";

// The real clock, random source and ids an engine session runs on
// in the app. Tests pass fakes instead (./testing).

export const systemClock: Clock = {
  now: () => Date.now(),
  schedule: (delayMs, run) => {
    const timer = setTimeout(run, delayMs);
    return () => clearTimeout(timer);
  },
};

export const systemRandom: Random = Math.random;

export const systemIds: IdSource = () => crypto.randomUUID();
