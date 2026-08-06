<!--
Security fixes do not go here. See SECURITY.md.
Three questions, all of which the reviewer would otherwise have to ask you.
-->

**What does this change, and why?**


**How did you verify it?** Which gates you ran, and on which OS. If you touched
IPC types, confirm `pnpm gen:bindings` was re-run and the result committed —
otherwise CI fails on a bindings diff with no explanation.


**What could this break?** The case you are least sure about. "Nothing" is a
valid answer if you mean it.
