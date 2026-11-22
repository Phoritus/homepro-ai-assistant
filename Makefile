# No database: the catalog and policies are compiled-in fixtures and sessions live in memory.
# .env is read only so `make tunnel` uses the server's PORT; its values are not exported to recipes.
-include .env
PORT ?= 3000
VERIFY_PORT ?= 3299
VERIFY = node .claude/skills/verify/scripts/verify.mjs

.PHONY: help install start test typecheck scenarios scenarios-llm eval verify verify-llm verify-doctor verify-stop tunnel

help:
	@echo make install        Install dependencies
	@echo make start          Start the server with .env, override with: make start PORT=8081
	@echo make test           Typecheck and run all unit tests
	@echo make typecheck      Typecheck only
	@echo make scenarios      Run the 6 spec scenarios with keyword rules, writes docs/test-results.md
	@echo make scenarios-llm  Run the 6 spec scenarios with Groq, writes docs/test-results-llm.md
	@echo make eval           Run the live Groq eval, one probe per spec requirement
	@echo make verify         Start a verify instance on VERIFY_PORT, default 3299, keyword rules
	@echo make verify-llm     Start a verify instance on VERIFY_PORT with Groq
	@echo make verify-doctor  Check the verify instance is healthy
	@echo make verify-stop    Stop the verify instance
	@echo make tunnel         Expose PORT over HTTPS with ngrok for the LINE webhook

install:
	npm install

start:
	npm start

test:
	npm test

typecheck:
	npm run typecheck

scenarios:
	npm run scenarios

scenarios-llm:
	npm run scenarios -- --llm

eval:
	npm run eval:llm

verify:
	$(VERIFY) start --port $(VERIFY_PORT)

verify-llm:
	$(VERIFY) start --llm --port $(VERIFY_PORT)

verify-doctor:
	$(VERIFY) doctor --port $(VERIFY_PORT)

verify-stop:
	$(VERIFY) stop --port $(VERIFY_PORT)

tunnel:
	ngrok http $(PORT)
