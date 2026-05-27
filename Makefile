.PHONY: help test test-js test-phpunit test-integration \
				test-integration-auth test-integration-sync clean t\
				ypecheck build-spa build serve

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' Makefile | sort | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-30s\033[0m %s\n", $$1, $$2}'

test: test-js test-phpunit test-integration ## Run all tests (JS + PHPUnit + integration)

test-js: ## Run JavaScript unit tests (vitest)
	cd tests/spa && pnpm test

test-phpunit: ## Run PHPUnit unit tests
	(cd tests && composer install )
	tests/vendor/bin/phpunit -c tests/php/phpunit.xml

test-integration: ## Run integration tests (starts server, runs curl scripts)
	bash tests/integration/run.sh

clean: ## Remove leftover test temp directories
	rm -rf /tmp/leaf-phpunit-* /tmp/leaf-integration-* /tmp/leaf-integration-env-*
	( cd spa && rm -f app.js history-*.js chunk-*.js view-panel-*.js )

typecheck: ## Run TypeScript type checking (no emit)
	cd src && ./node_modules/.bin/tsc --noEmit

build-spa: typecheck ## Build the SPA bundle from TypeScript sources
	cd src && ./node_modules/.bin/esbuild ts/app.ts --bundle --format=esm --splitting --outdir=../spa/

build: build-spa ## Build everything (alias for build-spa)

serve: ## Run test web server
	php -S localhost:9000
