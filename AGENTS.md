# Agent Notes

Use an adversarial proof standard. Before declaring work complete, state the user-facing claim, name the top three realistic failure modes, and gather evidence with commands, tests, screenshots, traces, or direct inspection.

Do not commit private media, credentials, private campaign data, real presigned URLs, customer content, or local SQLite databases.

For meaningful changes, prefer:

- `npm run ci` for the full public gate.
- `npm run public:readiness` for no-private-data and package-boundary proof.
- `npm run package:smoke` for installability proof.
- `npm run e2e` for browser workflow proof.
