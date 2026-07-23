"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { constants, readFileSync, statSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");

const { buildInvocation, expectedChecksum, installCLI, platformArtifact } = require("./index.js");

test("maps current and legacy inputs to CLI arguments", () => {
  assert.deepEqual(
    buildInvocation({
      "INPUT_ROOT": "project",
      "INPUT_FILES": "Assets/A.cs\nAssets/B.cs",
      "INPUT_FILES-GLOB": "Assets/**/*.png",
      "INPUT_DEST": "dist/out.unitypackage",
    }).args,
    [
      "pack", "--root", "project", "--output", "dist/out.unitypackage",
      "--include", "Assets/**/*.png", "Assets/A.cs", "Assets/B.cs",
    ],
  );

  assert.deepEqual(
    buildInvocation({
      "INPUT_PROJECT-FOLDER": "project",
      "INPUT_INCLUDE-FILES": "metaList",
      "INPUT_PACKAGE-PATH": "out.unitypackage",
    }).args,
    ["pack", "--root", "project", "--output", "out.unitypackage", "--files-from", "metaList"],
  );
});

test("maps supported runner platforms to release assets", () => {
  assert.equal(platformArtifact("linux", "x64"), "unitypackage-linux-amd64");
  assert.equal(platformArtifact("darwin", "arm64"), "unitypackage-darwin-arm64");
  assert.equal(platformArtifact("win32", "x64"), "unitypackage-windows-amd64.exe");
  assert.throws(() => platformArtifact("win32", "arm64"), /unsupported runner/);
});

test("selects the exact checksum entry", () => {
  const value = Buffer.from(`${"a".repeat(64)}  other\n${"b".repeat(64)} *unitypackage-linux-amd64\n`);
  assert.equal(expectedChecksum(value, "unitypackage-linux-amd64"), "b".repeat(64));
});

test("downloads and verifies a release binary", async (t) => {
  const binary = Buffer.from("test executable");
  const checksum = createHash("sha256").update(binary).digest("hex");
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => url.endsWith("checksums.txt")
      ? Buffer.from(`${checksum}  unitypackage-linux-amd64\n`)
      : binary,
  });
  const installed = await installCLI("v1.0.0", {
    platform: "linux",
    arch: "x64",
    fetchImpl,
    tempDirectory: tmpdir(),
  });
  t.after(() => require("node:fs").rmSync(installed.directory, { recursive: true, force: true }));
  assert.deepEqual(readFileSync(installed.filename), binary);
  if (process.platform !== "win32") {
    const mode = statSync(installed.filename).mode;
    assert.equal(mode & constants.S_IRWXU, constants.S_IRWXU);
    assert.equal(mode & (constants.S_IRWXG | constants.S_IRWXO), 0);
  }
});

test("rejects a checksum mismatch", async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => url.endsWith("checksums.txt")
      ? Buffer.from(`${"0".repeat(64)}  unitypackage-linux-amd64\n`)
      : Buffer.from("tampered"),
  });
  await assert.rejects(
    installCLI("v1.0.0", { platform: "linux", arch: "x64", fetchImpl }),
    /checksum mismatch/,
  );
});
