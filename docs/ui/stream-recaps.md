# Stream recaps

`/stream/recaps` lists the instance's finished streams, newest first, and
`/stream/recaps/:sessionId` shows one of them: how the stream went and who
supported it. Both read the same `streamSessionSummaries` rows as the dashboard's
[recent streams](./dashboard#recent-streams) widget, whose rows link here.

## Where each part comes from

| Part | Source | When the engine is offline |
|------|--------|----------------------------|
| Date, time live, segment timeline | Stored summary (`streamSessionSummaries.get`) | Shown |
| Totals: viewers, follows, subs, bits, raids | Stored summary | Shown |
| Viewers per minute | Engine `getStreamSessionGauges`, through `streamRecap.loadEngineDetail` | Notice with a retry |
| Top gifters and cheerers | Engine `getLeaderboard` (`giftedSubs`, `bits`) for the session, same action | Hidden |

The stored summary is what makes the page load instantly and survive an engine
that is down or has lost its database. The engine detail is fetched once per
visit by a Convex action that checks instance membership and runs the three
engine calls concurrently, each on its own capnweb batch session. The action
copies only the fields the page shows (`convex/lib/streamRecap.ts`). A null
answer from the engine means it no longer knows the session (a later split or
merge retired its id), and the page says so.

## Viewer chart

The engine samples viewers once a minute while live. A minute with no sample,
or whose read failed, is not zero viewers, so the chart draws it as a gap
(`buildViewerSeries` in `client/src/lib/stream-recap.ts`). A lone sampled
minute between gaps gets a marker, since a line has nothing to join it to. The
x axis spans the live segments, so unsampled time at either end shows as empty
space. "Show as table" lists every sampled minute.

## Thank-you message

`buildThankYouMessage` names up to three top gifters and three top cheerers who
have a name on record, and drops the lowest-ranked names until the line fits
Twitch's 500-character announcement limit. "Copy thank-you message" copies it;
"Send to chat" posts it as a chat announcement through
`twitchBroadcast.sendAnnouncement`, which needs the
`moderator:manage:announcements` scope on the instance's Twitch link.
