.DEFAULT_GOAL := help

LINEAGE_PACKAGE ?= @mean-weasel/lineage
PLUGIN_INSTALLER ?= lineage-plugin-installer
PROD_TAG ?= latest
DEV_TAG ?= next
LINEAGE_PROD_HOST ?= lineage.localhost
LINEAGE_PROD_PORT ?= 5197
LINEAGE_PROD_URL = http://$(LINEAGE_PROD_HOST):$(LINEAGE_PROD_PORT)
LINEAGE_LOCAL_DB ?= $(HOME)/Library/Application Support/Lineage/lineage.sqlite
LINEAGE_START_ARGS ?= --host lineage.localhost
LINEAGE_DEV_START_ARGS ?= --host lineage-dev.localhost
LINEAGE_RUN_DIR ?= .asset-scratch/lineage-runtime
LINEAGE_PROD_PID ?= $(LINEAGE_RUN_DIR)/lineage-prod.pid
LINEAGE_PROD_LOG ?= $(LINEAGE_RUN_DIR)/lineage-prod.log
LINEAGE_LOCAL_PROD_AGENT_LABEL ?= com.meanweasel.lineage.localprod
LINEAGE_LOCAL_PROD_PLIST ?= $(HOME)/Library/LaunchAgents/$(LINEAGE_LOCAL_PROD_AGENT_LABEL).plist
LINEAGE_LOCAL_PROD_LOG ?= $(LINEAGE_RUN_DIR)/launchd-local-prod.log
LINEAGE_LOCAL_PROD_ERR_LOG ?= $(LINEAGE_RUN_DIR)/launchd-local-prod.err.log
LINEAGE_DEV_PID ?= $(LINEAGE_RUN_DIR)/lineage-dev.pid
LINEAGE_DEV_LOG ?= $(LINEAGE_RUN_DIR)/lineage-dev.log
empty :=
space := $(empty) $(empty)
START_PROD_CMD = lineage start --open$(if $(strip $(LINEAGE_START_ARGS)),$(space)$(LINEAGE_START_ARGS))
START_LOCAL_PROD_CMD = env NODE_ENV=production HOST=$(LINEAGE_PROD_HOST) PORT=$(LINEAGE_PROD_PORT) LINEAGE_DB="$(LINEAGE_LOCAL_DB)" node dist/server.js
START_DEV_CMD = lineage-dev start --open$(if $(strip $(LINEAGE_DEV_START_ARGS)),$(space)$(LINEAGE_DEV_START_ARGS))

.PHONY: help init install-prod install-dev install-plugin-prod install-plugin-dev start-prod start-prod-bg status-prod stop-prod logs-prod start-local-prod-bg status-local-prod stop-local-prod logs-local-prod start-dev start-dev-bg status-dev stop-dev logs-dev dev check test lint build smoke ci release-status

help:
	@printf "Lineage shortcuts\\n"
	@printf "\\n"
	@printf "Setup and installs:\\n"
	@printf "  make init                 npm ci\\n"
	@printf "  make install-prod         npm install -g $(LINEAGE_PACKAGE)@$(PROD_TAG)\\n"
	@printf "  make install-dev          npm install -g $(LINEAGE_PACKAGE)@$(DEV_TAG)\\n"
	@printf "  make install-plugin-prod  $(PLUGIN_INSTALLER) install --channel $(PROD_TAG)\\n"
	@printf "  make install-plugin-dev   $(PLUGIN_INSTALLER) install --channel $(DEV_TAG)\\n"
	@printf "\\n"
	@printf "Start Lineage:\\n"
	@printf "  make start-prod           $(START_PROD_CMD)\\n"
	@printf "  make start-prod-bg        start prod detached with PID/log under $(LINEAGE_RUN_DIR)\\n"
	@printf "  make status-prod          show detached prod status\\n"
	@printf "  make stop-prod            stop detached prod server\\n"
	@printf "  make logs-prod            tail detached prod log\\n"
	@printf "  make start-local-prod-bg  start this checkout's built prod detached\\n"
	@printf "  make status-local-prod    show detached local prod status\\n"
	@printf "  make stop-local-prod      stop detached local prod server\\n"
	@printf "  make logs-local-prod      tail detached local prod log\\n"
	@printf "  make start-dev            $(START_DEV_CMD)\\n"
	@printf "  make start-dev-bg         start dev detached with PID/log under $(LINEAGE_RUN_DIR)\\n"
	@printf "  make status-dev           show detached dev status\\n"
	@printf "  make stop-dev             stop detached dev server\\n"
	@printf "  make logs-dev             tail detached dev log\\n"
	@printf "  make dev                  npm run dev\\n"
	@printf "\\n"
	@printf "Verification:\\n"
	@printf "  make check                npm run check\\n"
	@printf "  make test                 npm run test\\n"
	@printf "  make lint                 npm run lint\\n"
	@printf "  make build                npm run build\\n"
	@printf "  make smoke                npm run build && npm run public:readiness && npm run package:smoke\\n"
	@printf "  make ci                   npm run ci\\n"
	@printf "  make release-status       npm run release:status\\n"

init:
	npm ci

install-prod:
	npm install -g $(LINEAGE_PACKAGE)@$(PROD_TAG)

install-dev:
	npm install -g $(LINEAGE_PACKAGE)@$(DEV_TAG)

install-plugin-prod:
	$(PLUGIN_INSTALLER) install --channel $(PROD_TAG)

install-plugin-dev:
	$(PLUGIN_INSTALLER) install --channel $(DEV_TAG)

start-prod:
	$(START_PROD_CMD)

start-prod-bg:
	@mkdir -p "$(LINEAGE_RUN_DIR)"
	@if [ -f "$(LINEAGE_PROD_PID)" ] && kill -0 "$$(cat "$(LINEAGE_PROD_PID)")" 2>/dev/null; then \
		printf "Lineage prod already running (pid %s)\\n" "$$(cat "$(LINEAGE_PROD_PID)")"; \
	else \
		rm -f "$(LINEAGE_PROD_PID)"; \
		nohup $(START_PROD_CMD) > "$(LINEAGE_PROD_LOG)" 2>&1 & \
		printf "%s\\n" "$$!" > "$(LINEAGE_PROD_PID)"; \
		printf "Lineage prod started detached (pid %s)\\n" "$$(cat "$(LINEAGE_PROD_PID)")"; \
		printf "Log: %s\\n" "$(LINEAGE_PROD_LOG)"; \
	fi

status-prod:
	@if [ -f "$(LINEAGE_PROD_PID)" ] && kill -0 "$$(cat "$(LINEAGE_PROD_PID)")" 2>/dev/null; then \
		printf "Lineage prod running (pid %s)\\n" "$$(cat "$(LINEAGE_PROD_PID)")"; \
	else \
		printf "Lineage prod is not running\\n"; \
	fi

stop-prod:
	@if [ -f "$(LINEAGE_PROD_PID)" ] && kill -0 "$$(cat "$(LINEAGE_PROD_PID)")" 2>/dev/null; then \
		kill "$$(cat "$(LINEAGE_PROD_PID)")"; \
		printf "Stopped Lineage prod (pid %s)\\n" "$$(cat "$(LINEAGE_PROD_PID)")"; \
		rm -f "$(LINEAGE_PROD_PID)"; \
	else \
		printf "Lineage prod is not running\\n"; \
		rm -f "$(LINEAGE_PROD_PID)"; \
	fi

logs-prod:
	@tail -n 80 "$(LINEAGE_PROD_LOG)" 2>/dev/null || true

start-local-prod-bg:
	@mkdir -p "$(LINEAGE_RUN_DIR)"
	@if [ ! -f "$(LINEAGE_LOCAL_PROD_PLIST)" ]; then \
		printf "Missing launch agent plist: %s\\n" "$(LINEAGE_LOCAL_PROD_PLIST)"; \
		exit 1; \
	fi
	@launchctl print "gui/$$(id -u)/$(LINEAGE_LOCAL_PROD_AGENT_LABEL)" >/dev/null 2>&1 || launchctl bootstrap "gui/$$(id -u)" "$(LINEAGE_LOCAL_PROD_PLIST)"
	@launchctl kickstart -k "gui/$$(id -u)/$(LINEAGE_LOCAL_PROD_AGENT_LABEL)"
	@open "$(LINEAGE_PROD_URL)" >/dev/null 2>&1 || true
	@printf "Lineage local prod launch agent started: %s\\n" "$(LINEAGE_LOCAL_PROD_AGENT_LABEL)"
	@printf "Logs: %s %s\\n" "$(LINEAGE_LOCAL_PROD_LOG)" "$(LINEAGE_LOCAL_PROD_ERR_LOG)"

status-local-prod:
	@if launchctl print "gui/$$(id -u)/$(LINEAGE_LOCAL_PROD_AGENT_LABEL)" >/dev/null 2>&1; then \
		launchctl print "gui/$$(id -u)/$(LINEAGE_LOCAL_PROD_AGENT_LABEL)" | grep -E "state =|pid =|runs =" || true; \
	else \
		printf "Lineage local prod is not running\\n"; \
	fi

stop-local-prod:
	@if launchctl print "gui/$$(id -u)/$(LINEAGE_LOCAL_PROD_AGENT_LABEL)" >/dev/null 2>&1; then \
		launchctl bootout "gui/$$(id -u)" "$(LINEAGE_LOCAL_PROD_PLIST)"; \
		printf "Stopped Lineage local prod launch agent: %s\\n" "$(LINEAGE_LOCAL_PROD_AGENT_LABEL)"; \
	else \
		printf "Lineage local prod is not running\\n"; \
	fi

logs-local-prod:
	@tail -n 80 "$(LINEAGE_LOCAL_PROD_LOG)" "$(LINEAGE_LOCAL_PROD_ERR_LOG)" 2>/dev/null || true

start-dev:
	$(START_DEV_CMD)

start-dev-bg:
	@mkdir -p "$(LINEAGE_RUN_DIR)"
	@if [ -f "$(LINEAGE_DEV_PID)" ] && kill -0 "$$(cat "$(LINEAGE_DEV_PID)")" 2>/dev/null; then \
		printf "Lineage dev already running (pid %s)\\n" "$$(cat "$(LINEAGE_DEV_PID)")"; \
	else \
		rm -f "$(LINEAGE_DEV_PID)"; \
		nohup $(START_DEV_CMD) > "$(LINEAGE_DEV_LOG)" 2>&1 & \
		printf "%s\\n" "$$!" > "$(LINEAGE_DEV_PID)"; \
		printf "Lineage dev started detached (pid %s)\\n" "$$(cat "$(LINEAGE_DEV_PID)")"; \
		printf "Log: %s\\n" "$(LINEAGE_DEV_LOG)"; \
	fi

status-dev:
	@if [ -f "$(LINEAGE_DEV_PID)" ] && kill -0 "$$(cat "$(LINEAGE_DEV_PID)")" 2>/dev/null; then \
		printf "Lineage dev running (pid %s)\\n" "$$(cat "$(LINEAGE_DEV_PID)")"; \
	else \
		printf "Lineage dev is not running\\n"; \
	fi

stop-dev:
	@if [ -f "$(LINEAGE_DEV_PID)" ] && kill -0 "$$(cat "$(LINEAGE_DEV_PID)")" 2>/dev/null; then \
		kill "$$(cat "$(LINEAGE_DEV_PID)")"; \
		printf "Stopped Lineage dev (pid %s)\\n" "$$(cat "$(LINEAGE_DEV_PID)")"; \
		rm -f "$(LINEAGE_DEV_PID)"; \
	else \
		printf "Lineage dev is not running\\n"; \
		rm -f "$(LINEAGE_DEV_PID)"; \
	fi

logs-dev:
	@tail -n 80 "$(LINEAGE_DEV_LOG)" 2>/dev/null || true

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
