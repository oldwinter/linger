# Flights, trains and trips

A trip is one Tracking Item; its checks and reminders are separate Routines. A trip the Human has not booked yet is a `todo` to book it; once it is booked, update the same item with the flights and times and make it a `meeting`. These are typical shapes, not fixed rules: choose times from the actual schedule and what the Human said.

## Routines it usually needs

- **Status check** (purpose like "poll flight status"): start a few hours before departure, then check again as departure nears. Search the web for the live status by flight or train number on the carrier's or a flight-tracking site. Stop after departure or once it has left. Keep it a Routine of its own; a check-in reminder does not replace it.
- **Check-in or leave reminder** (purpose like "check-in reminder"): when online check-in opens or when the Human should leave for the airport or station, accounting for distance if known.
- Every leg gets its own status check and check-in reminder: the outbound and the return, and each flight of a connection.
- **Compensation check** (purpose like "compensation check"), for a cancelled flight or one whose arrival moves three hours or more later: one Routine shortly after the planned arrival. Write the flight, its planned and new times and the booking reference into its `--content`.
- **Trip preparation**, when a multi-day or multi-city trip has several arrangements still open: prepare a travel document early enough for the Human to choose and book, as described in Preparing. Do not wait for the day-before reminder.
- **Booking reminder**, for a trip not booked yet: when it is time to book, and once more if it is still not booked as the trip nears.

## When to tell

- A delay, a gate or platform change, a cancellation, a schedule change: tell at once with the new time and the source, and what it means ("the gate moved to B12" / "now departing about 1 h 20 min late, so the 16:40 meeting in Shanghai cannot be made"). For a cancellation or a large schedule change, add what the Human can choose under the rules that apply, such as a refund instead of the new flight.
- A compensation check fires: look up the rules that apply to that flight, for example EU261 or UK261, the US Department of Transportation refund rules or Canada's APPR, and its actual arrival time. Tell once what the Human can claim and how; when nothing is due, say nothing. Never quote thresholds or amounts from memory.
- Check-in opens, or it is time to leave: one short reminder.
- A trip not booked yet: when it is time to book, with the options found.

## When things change

- A delay moves the departure: move the check-in or leave reminder and the next status checks to fit the new time. A delay that moves the arrival three hours or more later gets a compensation check.
- A cancellation: tell the Human, mark nothing done, create a compensation check, and stop status checks until they rebook; record the rebooked flight as an update to the same item.
- The trip gets booked: update the item with the flights and times, make it a `meeting`, delete the booking reminders and create the Routines a booked trip needs.
- The Human cancels the trip or says "no need": mark the item done and delete its Routines.

## Preparing

For a multi-day or multi-city trip with several open arrangements, such as transport, accommodation and daily plans, prepare one Room document for the Human to make choices and use during the trip. A simple status check or a fully settled trip needs no document. Arrange a preparation Routine while those choices can still be made; if preparation is already due, do it now.

Write the reader, purpose and document deliverable into that Routine's `--content`, together with the known dates, booked arrangements, preferences and budget. Its `Look up first:` names the outstanding travel decisions and the current sources needed to compare them. Prepare the document with `teamhub docs create`, then send its link with the short reminder. Include the confirmed arrangements, a practical itinerary, relevant transport and accommodation options, budget tradeoffs and decisions still needed, choosing only the sections this trip calls for. Distinguish booked facts, suggestions and unverified details; missing flight numbers or reliable prices do not block the rest of the document.

Reuse that document for later preparation instead of creating another. Put its ID and what to update into the remaining preparation Routines so new findings and the Human's decisions stay together.

A status check or a compensation check already says what to look up. A booking reminder gets `Look up first:` naming the trip's current options from the web: flights or trains and their times, with a price only where a page shows a current one.

The reminder the day before departure, usually the check-in reminder, gets `Look up first:` once the trip is clear enough to look up: what this trip needs the Human to know before they go, judged from its connection and its arrival time and place, from the web. For example, a connection may need a terminal change, bags checked in again or a transit visa, and an arrival may need a way to get from the airport at that hour or a hotel told they arrive late. Name only what this trip calls for; an ordinary trip needs nothing here.

## Special cases

- **Separate tickets**: a connection booked as separate tickets is a self-transfer, so bags and a missed connection are the Human's own risk. The day-before reminder says so.
- **After arrival**: nothing is needed unless the Human asked for something, such as a pickup or a hotel check-in. Then arrange a Routine for it, with `Look up first:` naming the pickup or hotel details.
