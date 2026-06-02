.PHONY: help test test-js test-phpunit test-integration \
				test-integration-auth test-integration-sync clean t\
				ypecheck build-spa build serve

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' Makefile | sort | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-30s\033[0m %s\n", $$1, $$2}'

test: test-js test-phpunit test-integration ## Run all tests (JS + PHPUnit + integration)

test-js: ## Run JavaScript unit tests (vitest)
	pnpm test

test-phpunit: ## Run PHPUnit unit tests
	# Do a basic syntax check first
	rc=0 ; 	for i in $$(find src/php -type f -name "*.php") ; do php -l $$i || rc=1 ; done ; exit $$rc
	composer install
	vendor/bin/phpunit -c tests/php/phpunit.xml

test-integration: ## Run integration tests (starts server, runs curl scripts)
	bash tests/integration/run.sh

clean: ## Remove leftover test temp directories and build artifacts
	rm -rf /tmp/leaf-phpunit-* /tmp/leaf-integration-* /tmp/leaf-integration-env-*
	find spa -maxdepth 1 ! -name 'sw.js' -name '*.js' -type f -print0 | xargs -0r rm -v
	rm -f spa/build-meta.json spa/files-cache.json

typecheck: ## Run TypeScript type checking (no emit)
	pnpm run typecheck

build-spa: typecheck ## Build the SPA bundle from TypeScript sources
	pnpm run build

build: build-spa ## Build everything (alias for build-spa)

serve: ## Run test web server
	php -S localhost:9000
