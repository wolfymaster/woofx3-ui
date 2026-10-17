import type { EngineGateway } from "@/engine/gateway";
import { convexAlertLibraryGateway } from "./alert-library";
import { convexAlertQueueGateway } from "./alert-queue";
import { convexEventLogGateway } from "./event-log";
import { convexResourcesGateway } from "./resources";
import { convexStatusGateway } from "./status";

/**
 * The engine reached through Convex: reads and calls go to Convex functions
 * that relay to the engine or read what it has mirrored there, and realtime
 * goes over the browser transport. This directory is the only client code
 * allowed to name those Convex functions.
 */
export const convexEngineGateway: EngineGateway = {
  status: convexStatusGateway,
  resources: convexResourcesGateway,
  eventLog: convexEventLogGateway,
  alertQueue: convexAlertQueueGateway,
  alertLibrary: convexAlertLibraryGateway,
};
