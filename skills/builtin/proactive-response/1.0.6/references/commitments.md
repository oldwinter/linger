# Todos, deadlines, promises and replies

Two directions: what the Human owes (a todo, a deadline, a promise to someone, a reply someone is waiting for) is a `todo`; an answer the Human is waiting on from someone else is a `question`. One matter is one Tracking Item.

## Routines it usually needs

- A matter with an exact due time: one reminder early enough to still do it (a day before for a large piece of work, a few hours before for a small one), and optionally one on the due day.
- A vague period ("next week", "by month end"): keep the original words in `due_text`; add a Routine only when the period is close enough to matter, such as the start of that week or a few days before the month ends.

## When to tell

- It is due today or overdue and not done: say what is due and suggest one next step.
- A blocker it depended on is gone (a reply arrived, a file is ready): tell that it can move forward now.

## When things change

- The Human says it is done: mark the item done and delete its Routines.
- Postponed: update `due_at` or `due_text` in place and move the Routines.
- No longer needed: mark the item done and delete its Routines.
- The answer to a `question` arrives: update the item or mark it done, and delete the Routines that were only waiting for it.

## Preparing

Usually not worth preparing: the reminder says what is due and when. For something the Human promised to send, or a large piece of work due soon, add `Look up first:` naming where it stands (the latest draft or thread) and the earlier discussion it depends on, such as figures or decisions. For a promised deliverable, prepare a draft or outline for the Human to review, mark missing inputs, and write what to prepare into the Routine's `--content`.

## Special cases

- **A promise to someone else** ("promised Zhang San the proposal by Friday"): remind before the promised time, and name who is waiting.
- **Someone is waiting for the Human's reply**: tell who is waiting, for what, and since when, with a short suggested reply the Human can send or change. Do not send it for them. A Routine is useful only when there is a time by which the answer matters; otherwise keep the item open and mention it when the Human next has a quiet moment. When a draft reply would help, add `Look up first:` naming the thread and what was asked.
- **The Human is waiting on someone's answer**: keep the item open as a `question`. An event or message that answers it is worth telling at once, with the answer itself, even when what it settles is on a later day. A reply that only acknowledges, or says the answer is still coming, settles nothing: update the item if it gives a new date, and stay silent. It needs no preparation; the answer itself is the news.
