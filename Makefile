.DEFAULT_GOAL := help

LINEAGE_PACKAGE ?= @mean-weasel/lineage
PLUGIN_INSTALLER ?= npx --yes @mean-weasel/lineage-plugin-installer@latest
PROD_TAG ?= latest
PREVIEW_TAG ?= next
LINEAGE_RUNTIME_ROOT ?= $(HOME)/Library/Application Support/Lineage/runtimes
LINEAGE_NPM_PREFIX ?= $(shell npm prefix --global)
LINEAGE_USER_BIN ?= $(LINEAGE_NPM_PREFIX)/bin
LINEAGE_CHANNEL_CLI ?= node dist/cli/lineage-channel.js
LINEAGE_STABLE_BIN ?= $(LINEAGE_USER_BIN)/lineage-stable
LINEAGE_PREVIEW_BIN ?= $(LINEAGE_USER_BIN)/lineage-preview
LINEAGE_STABLE_SERVICE_MANAGER ?= $(LINEAGE_USER_BIN)/lineage-stable-service
LINEAGE_PREVIEW_SERVICE_MANAGER ?= $(LINEAGE_USER_BIN)/lineage-preview-service
LINEAGE_DEV_SERVICE_MANAGER ?= node scripts/managed-service.mjs
LINEAGE_PROD_PROFILE ?=
LINEAGE_PREVIEW_PROFILE ?=
LINEAGE_DEV_PROFILE ?=

START_PROD_CMD = "$(LINEAGE_STABLE_BIN)" start --profile "$(LINEAGE_PROD_PROFILE)" --open
START_PREVIEW_CMD = "$(LINEAGE_PREVIEW_BIN)" start --profile "$(LINEAGE_PREVIEW_PROFILE)" --open
START_DEV_CMD = npm run --silent lineage:dev -- start --profile "$(LINEAGE_DEV_PROFILE)" --open

.PHONY: help init install-prod install-preview install-dev install-plugin-prod install-plugin-preview repin-dev start-prod start-preview start-dev start-prod-bg status-prod stop-prod logs-prod start-preview-bg status-preview stop-preview logs-preview start-dev-bg status-dev stop-dev logs-dev dev check test lint build smoke ci release-status

help:
	@printf "Lineage shortcuts\n"
	@printf "\n"
	@printf "Setup and installs:\n"
	@printf "  make init                   npm ci\n"
	@printf "  make install-prod           install npm latest into the isolated stable root\n"
	@printf "  make install-preview        install npm next into the isolated preview root\n"
	@printf "  make install-dev            install dependencies and build runnable dev artifacts\n"
	@printf "  make install-plugin-prod    $(PLUGIN_INSTALLER) install --channel $(PROD_TAG)\n"
	@printf "  make install-plugin-preview $(PLUGIN_INSTALLER) install --channel $(PREVIEW_TAG)\n"
	@printf "  make repin-dev LINEAGE_DEV_PROFILE=<profile>  intentionally pin a stopped dev profile to this checkout\n"
	@printf "\n"
	@printf "Foreground (browser opens only after exact runtime readiness):\n"
	@printf "  make start-prod LINEAGE_PROD_PROFILE=<profile>\n"
	@printf "  make start-preview LINEAGE_PREVIEW_PROFILE=<profile>\n"
	@printf "  make start-dev LINEAGE_DEV_PROFILE=<profile>\n"
	@printf "\n"
	@printf "Managed services (profile-scoped receipt, log, health, and stop):\n"
	@printf "  make start-prod-bg/status-prod/stop-prod/logs-prod LINEAGE_PROD_PROFILE=<profile>\n"
	@printf "  make start-preview-bg/status-preview/stop-preview/logs-preview LINEAGE_PREVIEW_PROFILE=<profile>\n"
	@printf "  make start-dev-bg/status-dev/stop-dev/logs-dev LINEAGE_DEV_PROFILE=<profile>\n"
	@printf "\n"
	@printf "Verification:\n"
	@printf "  make check                  npm run check\n"
	@printf "  make test                   npm run test\n"
	@printf "  make lint                   npm run lint\n"
	@printf "  make build                  npm run build\n"
	@printf "  make smoke                  build, public readiness, and package smoke\n"
	@printf "  make ci                     npm run ci\n"
	@printf "  make release-status         npm run release:status\n"

init:
	npm ci

install-prod:
	$(LINEAGE_CHANNEL_CLI) install stable --shim-dir "$(LINEAGE_USER_BIN)" --package $(LINEAGE_PACKAGE)@$(PROD_TAG)

install-preview:
	$(LINEAGE_CHANNEL_CLI) install preview --shim-dir "$(LINEAGE_USER_BIN)" --package $(LINEAGE_PACKAGE)@$(PREVIEW_TAG)

install-dev:
	npm ci
	npm run build

install-plugin-prod:
	$(PLUGIN_INSTALLER) install --channel $(PROD_TAG)

install-plugin-preview:
	$(PLUGIN_INSTALLER) install --channel $(PREVIEW_TAG)

repin-dev:
	@test -n "$(strip $(LINEAGE_DEV_PROFILE))" || { printf "LINEAGE_DEV_PROFILE is required\n"; exit 2; }
	npm run --silent lineage:dev -- runtime doctor --json
	npm run --silent lineage:dev -- profile repin-runtime --profile "$(LINEAGE_DEV_PROFILE)" --checkout-root "$(CURDIR)" --confirm-write --json
	npm run --silent lineage:dev -- profile doctor --profile "$(LINEAGE_DEV_PROFILE)" --json
	npm run --silent lineage:dev -- db info --profile "$(LINEAGE_DEV_PROFILE)" --json

start-prod:
	@test -n "$(strip $(LINEAGE_PROD_PROFILE))" || { printf "LINEAGE_PROD_PROFILE is required\n"; exit 2; }
	$(START_PROD_CMD)

start-preview:
	@test -n "$(strip $(LINEAGE_PREVIEW_PROFILE))" || { printf "LINEAGE_PREVIEW_PROFILE is required\n"; exit 2; }
	$(START_PREVIEW_CMD)

start-dev:
	@test -n "$(strip $(LINEAGE_DEV_PROFILE))" || { printf "LINEAGE_DEV_PROFILE is required\n"; exit 2; }
	$(START_DEV_CMD)

start-prod-bg:
	@test -n "$(strip $(LINEAGE_PROD_PROFILE))" || { printf "LINEAGE_PROD_PROFILE is required\n"; exit 2; }
	"$(LINEAGE_STABLE_SERVICE_MANAGER)" start --channel stable --profile "$(LINEAGE_PROD_PROFILE)" --launcher "$(LINEAGE_STABLE_BIN)" --open

status-prod:
	@test -n "$(strip $(LINEAGE_PROD_PROFILE))" || { printf "LINEAGE_PROD_PROFILE is required\n"; exit 2; }
	"$(LINEAGE_STABLE_SERVICE_MANAGER)" status --channel stable --profile "$(LINEAGE_PROD_PROFILE)" --launcher "$(LINEAGE_STABLE_BIN)"

stop-prod:
	@test -n "$(strip $(LINEAGE_PROD_PROFILE))" || { printf "LINEAGE_PROD_PROFILE is required\n"; exit 2; }
	"$(LINEAGE_STABLE_SERVICE_MANAGER)" stop --channel stable --profile "$(LINEAGE_PROD_PROFILE)" --launcher "$(LINEAGE_STABLE_BIN)"

logs-prod:
	@test -n "$(strip $(LINEAGE_PROD_PROFILE))" || { printf "LINEAGE_PROD_PROFILE is required\n"; exit 2; }
	"$(LINEAGE_STABLE_SERVICE_MANAGER)" logs --channel stable --profile "$(LINEAGE_PROD_PROFILE)" --launcher "$(LINEAGE_STABLE_BIN)"

start-preview-bg:
	@test -n "$(strip $(LINEAGE_PREVIEW_PROFILE))" || { printf "LINEAGE_PREVIEW_PROFILE is required\n"; exit 2; }
	"$(LINEAGE_PREVIEW_SERVICE_MANAGER)" start --channel preview --profile "$(LINEAGE_PREVIEW_PROFILE)" --launcher "$(LINEAGE_PREVIEW_BIN)" --open

status-preview:
	@test -n "$(strip $(LINEAGE_PREVIEW_PROFILE))" || { printf "LINEAGE_PREVIEW_PROFILE is required\n"; exit 2; }
	"$(LINEAGE_PREVIEW_SERVICE_MANAGER)" status --channel preview --profile "$(LINEAGE_PREVIEW_PROFILE)" --launcher "$(LINEAGE_PREVIEW_BIN)"

stop-preview:
	@test -n "$(strip $(LINEAGE_PREVIEW_PROFILE))" || { printf "LINEAGE_PREVIEW_PROFILE is required\n"; exit 2; }
	"$(LINEAGE_PREVIEW_SERVICE_MANAGER)" stop --channel preview --profile "$(LINEAGE_PREVIEW_PROFILE)" --launcher "$(LINEAGE_PREVIEW_BIN)"

logs-preview:
	@test -n "$(strip $(LINEAGE_PREVIEW_PROFILE))" || { printf "LINEAGE_PREVIEW_PROFILE is required\n"; exit 2; }
	"$(LINEAGE_PREVIEW_SERVICE_MANAGER)" logs --channel preview --profile "$(LINEAGE_PREVIEW_PROFILE)" --launcher "$(LINEAGE_PREVIEW_BIN)"

start-dev-bg:
	@test -n "$(strip $(LINEAGE_DEV_PROFILE))" || { printf "LINEAGE_DEV_PROFILE is required\n"; exit 2; }
	$(LINEAGE_DEV_SERVICE_MANAGER) start --channel dev --profile "$(LINEAGE_DEV_PROFILE)" --open

status-dev:
	@test -n "$(strip $(LINEAGE_DEV_PROFILE))" || { printf "LINEAGE_DEV_PROFILE is required\n"; exit 2; }
	$(LINEAGE_DEV_SERVICE_MANAGER) status --channel dev --profile "$(LINEAGE_DEV_PROFILE)"

stop-dev:
	@test -n "$(strip $(LINEAGE_DEV_PROFILE))" || { printf "LINEAGE_DEV_PROFILE is required\n"; exit 2; }
	$(LINEAGE_DEV_SERVICE_MANAGER) stop --channel dev --profile "$(LINEAGE_DEV_PROFILE)"

logs-dev:
	@test -n "$(strip $(LINEAGE_DEV_PROFILE))" || { printf "LINEAGE_DEV_PROFILE is required\n"; exit 2; }
	$(LINEAGE_DEV_SERVICE_MANAGER) logs --channel dev --profile "$(LINEAGE_DEV_PROFILE)"

dev:
	npm run dev

check:
	npm run check

test:
	npm run test

lint:
	npm run lint

build:
	npm run build

smoke:
	npm run build
	npm run public:readiness
	npm run package:smoke

ci:
	npm run ci

release-status:
	npm run release:status
