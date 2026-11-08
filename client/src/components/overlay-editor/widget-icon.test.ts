import { describe, expect, test } from "bun:test";
import { Bell, Square } from "lucide-react";
import { STREAM_OBJECT_ICONS } from "@/lib/stream-object-icons";
import { widgetIconFor } from "./widget-icon";

describe("widgetIconFor", () => {
  const cases = [
    { name: "an alert widget", taxonomy: ["alert"], icon: Bell },
    { name: "a counter widget", taxonomy: ["data", "data.counter"], icon: STREAM_OBJECT_ICONS.counters },
    { name: "a timer widget", taxonomy: ["data", "data.timer"], icon: STREAM_OBJECT_ICONS.timers },
    { name: "a queue widget", taxonomy: ["data", "data.queue"], icon: STREAM_OBJECT_ICONS.queues },
    { name: "a database widget", taxonomy: ["data", "data.database"], icon: STREAM_OBJECT_ICONS.databases },
    { name: "a data widget of an unknown kind", taxonomy: ["data", "data.wheel"], icon: Square },
    { name: "a widget that declares nothing", taxonomy: undefined, icon: Square },
  ];

  for (const { name, taxonomy, icon } of cases) {
    test(name, () => {
      expect(widgetIconFor(taxonomy)).toBe(icon);
    });
  }
});
