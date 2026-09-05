<!--
Three questions the reviewer would otherwise have to ask you, then the
minimalism gate (PLAN.md §11.5). CI reads this body: a new top-level
Cargo.lock or pnpm-lock.yaml entry needs an `ADR-NNNN` reference here.
-->

**What does this change, and why?**


**How did you verify it?** Which `just` recipes you ran, and on which OS.


**What could this break?** The case you are least sure about. "Nothing" is a
valid answer if you mean it.


## Minimalism gate

- [ ] No new setting, feature, menu item, shortcut, dependency or outbound call — or the ADR number and the owner's quoted yes are in this description: `ADR-____`
- [ ] Every user-visible string is in both `i18n/en.json` and `i18n/de.json`
- [ ] No hard-coded colours, fonts or radii; tokens only
- [ ] Budgets (`docs/BUDGET.json`, PLAN.md §11.3) unchanged, or re-measured with the numbers in this description
- [ ] `just check` is green, nothing skipped
