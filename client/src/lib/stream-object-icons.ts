import { Bell, CalendarClock, Layers, ListOrdered, type LucideIcon, Tally5, Timer } from "lucide-react";

/**
 * The icons the streamer's own things wear wherever they appear: the sidebar entry
 * that lists them and the step picker's object that acts on them. One table, so
 * the picker's Counters reads as the same thing as the sidebar's Counters.
 */
export const STREAM_OBJECT_ICONS = {
  alerts: Bell,
  scenes: Layers,
  counters: Tally5,
  timers: Timer,
  queues: ListOrdered,
  schedules: CalendarClock,
} as const satisfies Record<string, LucideIcon>;
