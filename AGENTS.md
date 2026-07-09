# Agent Notes

Use an adversarial proof standard. Before declaring work complete, state the user-facing claim, name the top three realistic failure modes, and gather evidence with commands, tests, screenshots, traces, or direct inspection.

Do not commit private media, credentials, private campaign data, real presigned URLs, customer content, or local SQLite databases.

Runtime channel memory:

- `stable` is npm `latest` and daily-use data.
- `preview` is the published npm `next` candidate.
- `dev` is a local GitHub checkout or branch before publication.
- Check `lineage db info --json` or `lineage-dev db info --json` before assuming which SQLite database a CLI/app session is using.
- Do not point preview/dev code at the stable database unless it is an intentional test; prefer a copied snapshot for realistic preview/dev testing.

Local startup memory:

- `lineage start`, `lineage-dev start`, `make start-prod`, and `make start-dev` are foreground commands.
- Prefer `make start-prod-bg` or `make start-dev-bg` when the user wants a persistent local server; these use tmux when available and fall back to nohup/PID files.
- Use `make status-prod`/`make status-dev`, `make logs-prod`/`make logs-dev`, and `make stop-prod`/`make stop-dev` for detached servers.

For meaningful changes, prefer:

- `npm run ci` for the full public gate.
- `npm run public:readiness` for no-private-data and package-boundary proof.
- `npm run package:smoke` for installability proof.
- `npm run e2e` for browser workflow proof.
