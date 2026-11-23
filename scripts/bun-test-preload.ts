import { afterEach } from "bun:test";
import { settleBackends } from "../convex/lib/convexTest.testing";

afterEach(settleBackends);
