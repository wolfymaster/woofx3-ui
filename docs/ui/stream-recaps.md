# Stream recaps

`/stream/recaps` lists every stream the engine has sent a summary for, newest
first, and
`/stream/recaps/:sessionId` shows one of them: how the stream went and who
supported it. The engine sends a summary when a session ends. The current
session shows too, from snapshots the UI takes itself (below), badged "In
progress" while its stream is live since its totals can still change. Both read the same `streamSessionSummaries` rows as the dashboard's
[recent streams](./dashboard#recent-streams) widget, whose rows link here.

## The session in progress

`streamRecap.refreshOpenSession` asks the engine for its newest session
(`listStreamSessions`, limit 1) and, when that session is open, for its totals
(`getStreamSessionTotals`): the two reads the engine builds its own summary
from. `sessionSnapshotPayload` (`convex/lib/sessionSummary.ts`) turns them into
the same payload the engine would send, which is parsed and stored as that
session's summary. The engine's summary at the session's end, and every later
snapshot, replaces it.

`useOpenSessionRefresh` calls it from the recap list, a recap page and the
Recent streams widget: once when one opens, then every minute while the stream
is live and someone is looking at the tab. Convex skips the engine when the
stored snapshot of the open session is under 30 seconds old, so many viewers
cost about one read per window.

A snapshot is stamped with Convex's clock, not the engine's, and may land after
the engine's summary of the session's end. `planOpenSnapshotWrite` therefore
never lets it replace a stored summary of a closed session.

In a snapshot the segment still live has no end. `summarySegments`
(`client/src/lib/session-summary.ts`) ends it at the snapshot's `generatedAt`,
the moment its totals describe, so the live time, the timeline (where it reads
"live" while the row is in progress) and the viewer chart include it. A recap page of an open session loads
the viewer chart and leaderboards again with each new snapshot, keeping the
ones on screen while it does.

## When a session is in progress

The engine keeps a session open after its stream goes offline: the next
`stream.online` either continues it (back within the engine's grace window, a
dropout) or closes it and starts another, and only then does the engine send
its summary. So a stored `status: "open"` means the engine has not closed the
session yet, not that the stream is live.

`listRecent` and `get` add `inProgress` to each row instead
(`isSummaryInProgress` in `convex/lib/sessionSummary.ts`): true only while the
instance's `instanceLiveState` says it is live and, when the engine has
announced its session, that session is this row's. It is derived on every read
and never stored, so a session reads as finished the moment its stream goes
down, reads as in progress again if the next broadcast continues it, and an
open row whose closing summary never arrived cannot stay stuck. Time live is
the segments added up, so the offline gap inside a continued session is never
counted.

On the live-to-offline transition, whether from the `stream.offline` callback
or a poll, `instanceLiveState` schedules `streamRecap.snapshotAfterStreamOffline`
15 seconds later, once the engine has closed the live segment. That snapshot
records the stream's final figures and the segment's end even when nobody has
a recap open. A redelivered offline callback finds the instance already offline
and schedules nothing.

## Where each part comes from

| Part | Source | When the engine is offline |
|------|--------|----------------------------|
| Date, time live, segment timeline | Stored summary (`streamSessionSummaries.get`) | Shown |
| Totals: viewers, follows, subs, bits, raids | Stored summary | Shown |
| Viewers per minute | Engine `getStreamSessionGauges`, through `streamRecap.loadEngineDetail` | Notice (retry when it can help) |
| Top gifters and cheerers | Engine `getLeaderboard` (`giftedSubs`, `bits`) for the session, same action | Hidden |
| Clips and the "Top clip" tile | Twitch Helix `GET /clips`, through `streamRecap.loadClips` | Shown (Twitch, not the engine) |

The stored summary is what makes the page load instantly and survive an engine
that is down or has lost its database. The engine detail is fetched once per
visit by a Convex action that checks instance membership and runs the three
engine calls concurrently, each on its own capnweb batch session. The action
copies only the fields the page shows (`convex/lib/streamRecap.ts`). A null
answer from the engine means it no longer knows the session (a later split or
merge retired its id), and the page says so. A failed call is sorted by
`classifyEngineCallError`: the gateway refusing this instance's client
credentials (`rejected`, fixed by registering again, so no retry), no answer or
a non-2xx batch response (`unreachable`), or an error the engine returned
(`failed`). The last two carry a short error text the notice shows.

Subs follow the engine's split: `subs` counts subs viewers took out or renewed
themselves and excludes gifts, which are only in `giftedSubs`. The recap shows
them as separate tiles and the list as "12 subs · 5 gifted"
(`formatSubsBreakdown`), never one as part of the other.

## Viewer chart

The engine samples viewers once a minute while live. A minute with no sample,
or whose read failed, is not zero viewers, so the chart draws it as a gap
(`buildViewerSeries` in `client/src/lib/stream-recap.ts`). A lone sampled
minute between gaps gets a marker, since a line has nothing to join it to. The
x axis spans the live segments, so unsampled time at either end shows as empty
space. "Show as table" lists every sampled minute.

## Thank-you message

`buildThankYouMessage` takes the top three gifters and top three cheerers and
mentions those with a display name on record; an unnamed entry in the top three
leaves a shorter list rather than promoting the fourth. It drops the lowest-ranked names until the line fits
Twitch's 500-character announcement limit. "Copy thank-you message" copies it;
"Send to chat" posts it as a chat announcement through
`twitchBroadcast.sendAnnouncement`, which needs the
`moderator:manage:announcements` scope on the instance's Twitch link.

## Clips

The Clips section lists the Twitch clips created during the session, most
viewed first, and the header shows the most viewed one as "Top clip".
`streamRecap.loadClips` checks instance membership, reads the stored summary's
segments, and asks Helix for the broadcaster's clips created between the first
going-live and the last going-down plus ten minutes (`clipWindow` in
`convex/lib/recapClips.ts`), since people keep clipping the last moments right
after a stream ends; a zero-length window is widened to one minute. It walks
at most five Helix pages and keeps up to 100 clips, so a stream with more
clips than that shows an incomplete list, and Helix itself may skip clips
when filtering by date. Listing clips needs no scope, so the Twitch link's token serves as is.

Clip data is never stored: each visit, or "Refresh", asks Twitch again, so
view counts stay current and a clip deleted on Twitch disappears. Twitch takes
a minute or two to list a new clip, which the empty state says.

Each clip shows its thumbnail (loaded lazily), title, who clipped it, views,
length, the time it was made, and how far into the stream that was, as
`h:mm:ss`: the clip's VOD offset when Twitch has one, otherwise the time from
the first going-live to the clip's creation (`formatStreamOffset` in
`client/src/lib/recap-clips.ts`). "Copy link" copies the clip URL, "Open on
Twitch" opens it, and "Share to chat" posts "Clip: " followed by the title (whitespace collapsed),
clipper and link as a
chat announcement through the same `twitchBroadcast.sendAnnouncement` path as
the thank-you message.
