# What sync actually does, and what novalis can see

Measured, not assumed. Every claim here has a run behind it in `docs/spikes/`
and a row in `docs/FILE-PROVIDER-CHECKLIST.md`. Where something is still
inferred, it says so.

## The short version

novalis stores plain files in a folder your sync client owns. That is the whole
design and it is what makes the notes yours. The cost is that the sync client,
not novalis, decides what happens when the same file changes in two places, and
the two providers do not agree.

## Google Drive resolves conflicts silently

Measured on 2026-09-08 with a full evidence chain (Drive 130, Stream and Mirror
both behave the same):

A note was edited on a phone, and the same note edited on the Mac while the Mac
was offline. On reconnect **Drive kept the Mac's version, discarded the phone's,
and created no second file of any kind.** The discarded edit was the *later* one.

Consequences you should know:

- **novalis cannot tell you this happened.** Its save protection compares the
  file on disk against what the editor loaded. A version discarded on the server
  changes nothing on disk and produces no filesystem event, so there is nothing
  to notice. This is a limit of the design, not a bug that can be fixed in the
  app; seeing it would mean tracking server-side revisions, which is the job of
  the account-based sync mode (PLAN.md §5.7), not of a plain folder.
- **The edit is overwritten, not destroyed.** Drive's own version history still
  listed the losing edit afterwards. It is recoverable from Drive on the web.
  Whether that restore actually works was not tested.
- **The conflict-copy machinery in novalis will not fire on Drive** for this
  case, because there is no second file to find.

## OneDrive is expected to differ, and that is still only expected

Spike A found the mechanisms novalis depends on (`SF_DATALESS`, the
materialize-off guard, atomic writes, renames) behave the same on OneDrive. What
it did **not** verify is the conflict case: nobody has yet edited the same note
on two devices against OneDrive. The plan assumes a conflict copy named after
the machine appears. Until that run happens, treat it as an assumption.

## What novalis does do about conflicts

- When *its own* save is refused because the file changed underneath it, it
  writes your buffer to a conflict copy immediately and shows a banner. Nothing
  you typed is lost, and this path is exercised and tested.
- When it finds a file that looks like a vendor conflict copy — the naming
  patterns of OneDrive, Dropbox and the numbered form — it counts it, in the
  sidebar and the status bar. Both counts now come from the same detector in
  the core, so they agree with `novalis doctor`.
- On a Kanban board it resolves conflicting card files on read: the newer card
  wins, the older is preserved under `conflicts/`, and the board says so once.
- A card file it cannot use at all is now reported rather than dropped in
  silence.

## What it deliberately does not do

- It does not guess at conflict names it has not measured. Drive names a *trash*
  collision `Note 2.md`, and it would be easy to match that — and then an
  ordinary note called `Chapter 2` sitting beside `Chapter` would be flagged as
  a conflict copy of it. Until a real Drive sync conflict is observed producing
  a name, no pattern is added for it.
- It does not offer to resolve vendor conflict copies from the app yet. It only
  counts them. PLAN.md §5.3 promises a list with keep-original / keep-copy /
  keep-both; that is not built, and the count is honest about being a count.

## Practical advice

Quit or close novalis on a device before editing the same notes on another one,
and let sync settle. That is the only reliable way to avoid the case above, on
any provider, with any app that stores plain files.
