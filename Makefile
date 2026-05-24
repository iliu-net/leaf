.PHONY: help test test-js test-phpunit test-integration test-integration-auth test-integration-sync clean

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

test-integration-auth: ## Run auth integration test against PORT (default 8080)
	BASE_URL="http://127.0.0.1:$${PORT:-8080}" bash tests/integration/test_auth.sh

test-integration-sync: ## Run sync integration test against PORT (default 8080)
	BASE_URL="http://127.0.0.1:$${PORT:-8080}" bash tests/integration/test_sync.sh

clean: ## Remove leftover test temp directories
	rm -rf /tmp/leaf-phpunit-* /tmp/leaf-integration-* /tmp/leaf-integration-env-*
