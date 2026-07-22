PHPDOC_VERSION := v3.10.0
PHPDOC := phpDocumentor.phar
API_URL = https://leaf1.0ink.net/spa/notes/
REMOTE_SERVER = user1@leaf1.0ink.net

.PHONY: help test test-js test-phpunit test-integration \
				test-integration-auth test-integration-sync \
				clean dist-clean config-php config-samples \
				typecheck build-spa build serve serve-remote \
				docs docs-php docs-spa docs-clean \
				deploy

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

rotate-jwt: ## Rotate the JWT_SECRET in a config.php (usage: make rotate-jwt CONFIG=path/to/config.php)
	bin/rotate-jwt "$(CONFIG)"

clean:  config-samples ## Remove leftover test temp directories and build artifacts
	rm -rf /tmp/leaf-phpunit-* /tmp/leaf-integration-* /tmp/leaf-integration-env-*
	rm -rf dist/ dist.zip

dist-clean:	clean docs-clean ## Make the package ready for distibution

typecheck: ## Run TypeScript type checking (no emit)
	pnpm run typecheck

build-spa: typecheck ## Build the SPA bundle from TypeScript sources
	pnpm run build

build: build-spa config-samples ## Build everything (alias for build-spa)

serve: config-php ## Run test web server
	[ -d demo/spa ] || make demo-instance
	@datadir=$$(php api/index.php spacfg --data) ; \
		[ -d $$datadir ] || echo "DATA_ROOT: $$datadir -- will be created"
	@php -S localhost:9000 & php_pid=$$! ; \
	pnpm dev & dev_pid=$$! ; \
	trap "kill $$dev_pid $$php_id ; echo" EXIT ; \
	wait

# Override API_URL to point to a different remote (e.g. make serve-remote API_URL=https://other.example/api/)

serve-remote: ## Run dev server with API proxied to remote (API_URL)
	@echo "API → $(API_URL)"
	@API_PROXY_TARGET="$(API_URL)" pnpm dev

# ── Instance management ──────────────────────────────────────────────────

SPA_INSTANCE_SCRIPT = bin/leaf-instance

demo-instance: build-spa ## Create/update the demo SPA instance
	rm -rf demo/spa
	$(SPA_INSTANCE_SCRIPT) -n "Leaf Demo" -a "../api/" -d dist demo/spa/

instance: build-spa ## Create a new SPA instance (usage: make instance NAME="My App" API="../api/" OUT=path/to/spa/)
	$(SPA_INSTANCE_SCRIPT) -n "$(NAME)" -a "$(API)" -d dist "$(OUT)"

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

dist.zip:	build-spa ## Create a distibution zip file
	@set -e ;t=$$(mktemp -d) ; trap "rm -rf $$t" EXIT ; \
	mkdir -p "$$t/html/sample/spa" "$$t/html/sample/api" "$$t/leaf" "$$t/bin" ; \
	cp -av src/php "$$t/leaf/php" ; \
	cp -av dist "$$t/leaf/spa" ; \
	cp -av api "$$t/html/sample/api" ; \
	mv -v "$$t/leaf/spa/index.html" "$$t/leaf/spa/manifest.json" "$$t/html/sample/spa" ; \
	cp -av bin/leaf-instance bin/rotate-jwt "$$t/bin" ; \
	git describe --always --dirty=-M > "$$t/leaf/php/version.txt" ; \
	( cd "$$t" ; zip -r - * ) | dd of=$@ bs=1k

deployment.tar.gz:	build-spa	## Create a deployment tarball
	@set -e ;t=$$(mktemp -d) ; trap "rm -rf $$t" EXIT ; \
	mkdir -p "$$t/leaf" ; \
	cp -av src/php "$$t/leaf/php" ; \
	cp -av dist "$$t/leaf/spa" ; \
	git describe --always --dirty=-M > "$$t/leaf/php/version.txt" ; \
	( cd "$$t/leaf/spa" && rm -f index.html manifest.json ) ; \
	tar -C "$$t" -zcvf "$@" leaf

deploy:	deployment.tar.gz		## deploy to remote server
	scp deployment.tar.gz $(REMOTE_SERVER):
	@echo \
		'cd /mnt/data/WebApps && tar -zxvf ~/deployment.tar.gz && rm -rf leaf-old && mv leaf-rt leaf-old && mv leaf leaf-rt' \
		| ssh $(REMOTE_SERVER) sh -x
