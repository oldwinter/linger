GOTOOLCHAIN := auto
export GOTOOLCHAIN

BIN_DIR := .bin
APP_PKG := ./cmd/linger-mobile

.PHONY: tidy vet test golden update-golden build build-e2e build-release preview check clean

tidy:
	go mod tidy

vet:
	go vet ./...

test:
	go test -race -count=1 ./...

golden:
	go test -count=1 ./internal/screens/... ./cmd/linger-mobile/...

update-golden:
	MYGO_UPDATE_GOLDEN=1 go test -count=1 ./internal/screens/... ./cmd/linger-mobile/...

build:
	mkdir -p $(BIN_DIR)
	CGO_ENABLED=0 go build -o $(BIN_DIR)/linger-mobile $(APP_PKG)

build-e2e:
	mkdir -p $(BIN_DIR)
	CGO_ENABLED=0 go build -tags e2e -o $(BIN_DIR)/linger-mobile-e2e $(APP_PKG)

build-release:
	mkdir -p $(BIN_DIR)
	CGO_ENABLED=0 go build -trimpath -tags mygo_noinspector -ldflags "-s -w -X github.com/egoist/mygo.production=1" -o $(BIN_DIR)/linger-mobile-release $(APP_PKG)

preview:
	go run $(APP_PKG) $(ARGS)

check: vet test build-e2e build-release

clean:
	rm -rf $(BIN_DIR)
