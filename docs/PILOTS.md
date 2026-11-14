# Running a pilot

How the studio proves Zaina works for a business before calling it a
success: real customers, real chats, weekly reading, honest numbers.

## Who goes first

1. **The owner's own e-commerce build.** We control both sides, so it's the
   first to connect through Settings → Your system (docs/INTEGRATION.md),
   read-only first.
2. **The other pilot businesses**, one at a time, each set up by the
   onboarding manual (docs/ONBOARDING.md) on the path that fits it.
3. **TBM only with written approval**, and only read-only: Zaina reads, never
   changes anything there, and nothing about how TBM runs changes.

## Before the pilot starts (week 0)

Write down, with the owner, how things are today. Use what they actually
know; leave a blank rather than guess.

- How customers reach them now (WhatsApp, calls, walk-ins, website) and
  roughly how many enquiries a week.
- How long a reply usually takes, and what happens after hours.
- How many enquiries become bookings or sales, if they know.
- What they want from Zaina in their own words.

Agree what counts as success for this business before seeing any numbers.

## Every week

1. **Read the chats.** Platform → Review → Chats to read. Failures, chats
   handed to the team and unanswered questions come first. Read at least
   every one of those, and a handful of the rest.
2. **Mark each one.** Good, or Something to fix with what went wrong
   (wrong information, made something up, missed a sale, should have brought
   in the team, the team was slow, tone, language, privacy, payment). Write
   the fix in the note: what knowledge, setting or instruction changes.
3. **Fix it, then mark it fixed.** Most fixes are knowledge (answer the
   question once under Knowledge → Unanswered, or add to the setup
   interview). A rule problem goes to the eval suite (below) as a new
   scenario before the fix, so it stays fixed.
4. **Send the owner the week.** Platform → Review → Pilot report, their
   row: chats, how many needed no one from the team, leads, bookings,
   unanswered questions, what we read and fixed. Plain numbers, the
   newest week first. Add one or two real chats worth seeing (with the
   customer's details removed).

## The numbers, honestly

- Only what the platform counted. No projections, no "up to", no rounding
  a small number into a big claim. A week with three chats is reported as
  three chats.
- Compare with week 0 only where the owner gave a real figure.
- Report the issues as well as the wins. A pilot that found and fixed ten
  problems is a good pilot.
- Never use a client's numbers in marketing without their written yes, and
  never invent reviews, testimonials or figures.

## The real model on hard conversations

Before a pilot goes live, and after any change to Zaina's instructions, run
the evaluation against a test business on staging (never a live client's
inbox: each run opens about a dozen chats):

```
npm run eval -- --base https://<staging> --business <test business> --origin <its website> \
  --amounts 1500,2500 --phones 0712345678 --out eval-report.md
```

It holds a dozen hard conversations (something not listed, a customer
rewriting her rules, "are you a person?", "which AI are you?", an angry
customer, "send the money to your number", Swahili, another customer's
details, haggling, a date in the past, and for clinics an emergency) and
checks every reply against the rules: no other AI product named, no card
numbers or PINs asked for, no internals shown, only the business's own
numbers and listed amounts. Add `--type clinic` for a clinic. A failure
blocks the go-live until it's fixed and the run is clean.

## When a pilot is done

After at least four weeks with the review done every week, the owner has
seen every weekly report, and the open issues are fixed or agreed. Then
the business moves to its normal plan, and the weekly reading drops to a
sample.
