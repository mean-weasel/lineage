# T999 pre-audit — not complete

The first final audit accepted release identity, ambiguous surface choice,
locked rerolls, agent scaffolding/import, wrong-size atomic rejection, published
stable replay, explicit deferrals, and board structure.

It rejected completion on one explicit board contract: T005 said final release
was blocked until the T006 repairs were both released **and re-dogfooded**.
Although T006 has strong unit/E2E coverage and its exact product files shipped in
0.1.28, T012 replayed the stable scaffold/import/canvas-output path rather than
the repaired two-source draft-retention and large-JSON paths.

Required closure:

1. In a fresh identity-gated stable 0.1.28 profile, retain two-source
   destination, split, count, prompt, and custom-dimension edits across every
   interaction and an unrelated parent rerender.
2. Submit and inspect exactly three canonical groups and five outputs.
3. Prove a published-stable subprocess emits complete parseable JSON larger than
   65,536 bytes and that it equals persisted state.
4. Rerun T999 after the evidence is recorded.

No product or release change is justified unless this released-runtime replay
fails.
