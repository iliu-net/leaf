PHPDOC_VERSION := v3.10.0
PHPDOC := phpDocumentor.phar

.PHONY: help test test-js test-phpunit test-integration \
				test-integration-auth test-integration-sync \
				clean dist-clean config-php config-samples \
				typecheck build-spa build serve \
				docs docs-php docs-spa docs-clean

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

api/config.php-sample: api/config.php
	sed -e "s!^[ 	]*define('JWT_SECRET',.*\$$!define('JWT_SECRET',   'CHANGE_ME_TO_A_LONG_RANDOM_STRING');!" < api/config.php > api/config.php-sample

demo/api/config.php-sample: demo/api/config.php
	sed -e "s!^[ 	]*define('JWT_SECRET',.*\$$!define('JWT_SECRET',   'CHANGE_ME_TO_A_LONG_RANDOM_STRING');!" < demo/api/config.php > demo/api/config.php-sample

config-samples:	api/config.php-sample demo/api/config.php-sample ## Rebuild config samples

config-php:
	@set -x ; [ -f api/config.php ] || sed -e "s!^[ 	]*define('JWT_SECRET',.*\$$!define('JWT_SECRET',   '$$(php -r "echo bin2hex(random_bytes(32));")');!" > api/config.php < api/config.php-sample
	@set -x ; [ -f demo/api/config.php ] || sed -e "s!^[ 	]*define('JWT_SECRET',.*\$$!define('JWT_SECRET',   '$$(php -r "echo bin2hex(random_bytes(32));")');!" > demo/api/config.php < demo/api/config.php-sample

clean:  config-samples ## Remove leftover test temp directories and build artifacts
	rm -rf /tmp/leaf-phpunit-* /tmp/leaf-integration-* /tmp/leaf-integration-env-*
	find spa -maxdepth 1 ! -name 'sw.js' -name '*.js' -type f -print0 | xargs -0r rm -v
	rm -f spa/build-meta.json spa/files-cache.json

dist-clean:	clean docs-clean ## Make the package ready for distibution

typecheck: ## Run TypeScript type checking (no emit)
	pnpm run typecheck

build-spa: typecheck ## Build the SPA bundle from TypeScript sources
	pnpm run build

build: build-spa config-samples ## Build everything (alias for build-spa)

serve: config-php ## Run test web server
	php -S localhost:9000

$(PHPDOC): ## Download the phpDocumentor PHAR (one-time)
	curl -sSLo $@ https://github.com/phpDocumentor/phpDocumentor/releases/download/$(PHPDOC_VERSION)/$@
	chmod +x $@

docs: docs-php docs-spa ## Generate all API documentation

docs-php: $(PHPDOC) ## Generate PHP API docs (phpDocumentor)
	./$(PHPDOC) -c phpdoc.dist.xml

docs-spa: ## Generate SPA API docs (TypeDoc)
	pnpm exec typedoc

docs-clean: ## Remove all generated documentation and the PHAR binary
	rm -rf docs/api docs/spa docs/.phpdoc-cache $(PHPDOC)
