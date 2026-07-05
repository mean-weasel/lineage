.DEFAULT_GOAL := help

LINEAGE_PACKAGE ?= @mean-weasel/lineage
PLUGIN_INSTALLER ?= lineage-plugin-installer
PROD_TAG ?= latest
DEV_TAG ?= next
LINEAGE_START_ARGS ?=
LINEAGE_DEV_START_ARGS ?=
empty :=
space := $(empty) $(empty)
START_PROD_CMD = lineage start --open$(if $(strip $(LINEAGE_START_ARGS)),$(space)$(LINEAGE_START_ARGS))
START_DEV_CMD = lineage-dev start --open$(if $(strip $(LINEAGE_DEV_START_ARGS)),$(space)$(LINEAGE_DEV_START_ARGS))

.PHONY: help init install-prod install-dev install-plugin-prod install-plugin-dev start-prod start-dev dev check test lint build smoke ci release-status

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
	@printf "  make start-dev            $(START_DEV_CMD)\\n"
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

start-dev:
	$(START_DEV_CMD)

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
