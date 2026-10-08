#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
TEST_DIR=$(mktemp -d "${TMPDIR:-/tmp}/connectar-tests.XXXXXX")
trap 'rm -rf "$TEST_DIR"' EXIT
swiftc -module-cache-path "$TEST_DIR/cache" \
  ConnectAR/Models/AssemblyModels.swift \
  ConnectAR/Models/AssemblyPlanner.swift \
  ConnectAR/Data/BoardRepository.swift \
  ConnectAR/App/AssemblySession.swift \
  Tests/AssemblySessionTests.swift -o "$TEST_DIR/session-tests"
"$TEST_DIR/session-tests"
