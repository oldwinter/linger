# Proactive Another Me

**It decides what deserves your attention, and every "thanks" or "not now"
shapes what it does next.**

![An animation of Another Me reaching out on its own: an email from Acme asking for a revised quote is set to follow up later and comes back as a reminder on Wednesday; you say client replies should come right away, and that night it learns "Client replies → Tell me right away". A late-evening standup change is told at once, you say late meeting changes can wait, and that night it learns "Meeting changes, after 9 PM → Follow up in the morning". Acme's next reply then comes at once, and a Sunday-night design review change waits until Monday morning, each by the rule it learned](../assets/feature-proactive.gif)

Another Me watches your inbox and calendar, decides what deserves your
attention, and reaches out on its own. When you push back with "tell me sooner"
or "not at this hour", it learns from that each night, and once you name the
kind of thing, it handles that kind your way from then on. Your rules stay on
your machine, with the rest of your memory.

## Decision

Another Me judges each window or event in a run of its own, with the general
rules, the user's active rules and the open follow-up items, and acts on the
result.

| Stage           | Behavior                                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input           | The chat with Another Me in windows of 20 messages; Gmail and Outlook inboxes, Google Calendar changes and Slack mentions, polled every 10 minutes |
| Apps            | From 22:00 to 08:00, or after five reminders that day, an app event is only recorded; one item in one state is judged once a day                   |
| Coding agents   | A herdr agent on your computer that waits for an answer or finishes is judged as an app event; your answer to its card goes back to that pane      |
| Delivery        | Waits until the chat has been quiet for 3 minutes                                                                                                  |
| Tell now        | Another Me checks the facts that may have changed, then sends one short message: the point, the facts, the next step                               |
| Follow up later | A follow-up item with scheduled checks, recorded without a message                                                                                 |
| Stay silent     | The run ends without a reply                                                                                                                       |

## Learning rules

Each night, a model reads every message Another Me sent on its own with the 20
messages after it; a reply about how to be told becomes a clue, and clues of
the same kind become a rule.

| Reply                                              | Kept as                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| "Would have been good to hear this directly"       | Clue: Tell now                                                                                   |
| "From now on, tell me this kind directly"          | Rule: Tell now                                                                                   |
| "No need to push this"                             | Clue: Stay silent                                                                                |
| "Don't remind me now, but keep track of this kind" | Rule: Follow up later                                                                            |
| "Don't remind me about this kind"                  | Rule: Stay silent                                                                                |
| "Too late at night for this"                       | For a matter that needs follow-up: Follow up later in that time window, never straight to silent |
| "Great paper", "done", agreement, or no reply      | Nothing                                                                                          |

A rule learned this way starts in shadow: it does not decide yet. Each night
may add, merge or remove learned rules, but never one you pinned or edited, and
a rule you deleted is not learned again unless new replies ask for it.

![An animation of what Another Me learns from your replies: on Wed, Oct 28 you answer the AWS invoice reminder with "I'd rather have heard when it arrived", and that night it becomes a clue for vendor invoices, Tell now; on Wed, Nov 4 you answer the Figma invoice reminder with "Again, should have pinged me when it came", and that night a second clue of the same kind arrives and both leave the pool as one rule, "Vendor invoices → Tell now"](../assets/feature-proactive-learn.gif)

## Applying what was learned

The active rules are part of what Another Me reads before it judges a chat
window or an app event; clues are left out. Shadow rules are listed apart: when
one would have led to a different action (tell now, follow up later, stay
silent), the run records a shadow divergence with `teamhub proactive
shadow-divergence`, and says nothing about it to you.

Settings → My Rules lists your rules with their status, the clues not yet
strong enough to be rules, and, under each shadow rule, where it would have
decided differently. Each change makes a new version of your rules:

| Command | Effect                                                                |
| ------- | --------------------------------------------------------------------- |
| Promote | A shadow rule becomes active and decides from the next judgment on    |
| Pin     | Nightly learning keeps the rule as it is                              |
| Edit    | The rule becomes yours; nightly learning keeps it as you wrote it     |
| Delete  | The rule goes, and is not learned again from the replies it came from |
| Mandate | What Another Me may do beyond reminding when an active rule applies   |

## Acting under your mandate

Another Me only reminds, unless you allow more on an active rule in My Rules.
Nightly learning never grants or changes this, and never removes or rewrites a
rule that carries it; a shadow rule carries none until you promote it.

| Mandate             | When an outside event matches the rule                                    |
| ------------------- | ------------------------------------------------------------------------- |
| Only remind         | Tell now, follow up later, or stay silent, as above                       |
| Create a Work Item  | It may also create one Work Item for the event, and tells you             |
| Create and delegate | It may instead start a Task for its AlterEgo with the work, and tells you |

Each act happens once per rule and event, with `teamhub proactive act`, and
TeamHub checks your current rules every time. The Work Item keeps an unchangeable
record of its mandate: the rule and its text then, the version of your rules,
the event, and the strength. It shows on the Work Item and under the rule in
My Rules. Lowering the mandate, or deleting the rule, stops later acts; Work
Items already created stay and show the mandate as revoked.

## Coding agents in herdr

When [herdr](https://github.com/herdrdev/herdr) is on your computer's PATH, the
Linger Computer watches the coding agents in its panes. A pane that starts
waiting on an approval or a question, or an agent that finishes its work,
reaches Another Me as one event per pane state, with the agent, its folder and
the pane's last lines, obvious secrets removed. Quiet hours, the daily limit
and your rules apply as to any app event.

When the agent waits on a choice, Another Me asks you with a question card
bound to that pane and that question. Only your own answer on that card ever
reaches the pane: Linger, not Another Me, types the choice you picked or the
line you wrote, once, and only while the pane still waits on the same
question. Another Me has no way to type into a pane itself. Afterwards it
tells you whether your answer arrived, the pane had closed, or the agent had
already moved on; an answer whose delivery the computer did not confirm is
never sent again. A question that came in during quiet hours or past the
daily limit gets no card while that still holds, whatever Another Me tries;
it is followed up once that limit lifts.

Each pane state is its own event, so under a mandate a later block or
completion of the same pane may lead to a Work Item of its own.
