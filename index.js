"use strict";

const { createHash, timingSafeEqual } = require("node:crypto");
const { appendFileSync, chmodSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { basename, join, resolve } = require("node:path");
const { spawn } = require("node:child_process");

const REPOSITORY = "r74tech/unitypackage";

function input(name, env = process.env) {
  return (env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
}

function lines(value) {
  return value
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function first(...values) {
  return values.find((value) => value) ?? "";
}

function buildInvocation(env = process.env) {
  const root = first(input("root", env), input("project-folder", env), ".");
  const output = first(input("dest", env), input("package-path", env));
  if (!output) throw new Error("the dest or package-path input is required");

  const args = ["pack", "--root", root, "--output", output];
  const filesFrom = input("include-files", env);
  if (filesFrom) args.push("--files-from", filesFrom);
  for (const pattern of lines(input("files-glob", env))) {
    args.push("--include", pattern);
  }
  args.push(...lines(input("files", env)));

  return {
    args,
    cwd: first(input("working-folder", env), process.cwd()),
    output,
  };
}

function platformArtifact(platform = process.platform, arch = process.arch) {
  const operatingSystems = { linux: "linux", darwin: "darwin", win32: "windows" };
  const architectures = { x64: "amd64", arm64: "arm64" };
  const os = operatingSystems[platform];
  const cpu = architectures[arch];
  if (!os || !cpu || (os === "windows" && cpu !== "amd64")) {
    throw new Error(`unsupported runner: ${platform}/${arch}`);
  }
  return `unitypackage-${os}-${cpu}${os === "windows" ? ".exe" : ""}`;
}

async function download(url, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, {
    headers: { "user-agent": "r74tech/create-unitypackage" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function expectedChecksum(checksums, artifact) {
  for (const line of checksums.toString("utf8").split(/\r?\n/)) {
    const match = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (match && basename(match[2]) === artifact) return match[1].toLowerCase();
  }
  throw new Error(`checksum not found for ${artifact}`);
}

async function installCLI(version, options = {}) {
  if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`invalid tool-version: ${version}`);
  }
  const artifact = platformArtifact(options.platform, options.arch);
  const base = `https://github.com/${REPOSITORY}/releases/download/${encodeURIComponent(version)}`;
  const [binary, checksums] = await Promise.all([
    download(`${base}/${artifact}`, options.fetchImpl),
    download(`${base}/checksums.txt`, options.fetchImpl),
  ]);
  const actual = createHash("sha256").update(binary).digest();
  const expected = Buffer.from(expectedChecksum(checksums, artifact), "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error(`checksum mismatch for ${artifact}`);
  }

  const directory = mkdtempSync(join(options.tempDirectory ?? process.env.RUNNER_TEMP ?? tmpdir(), "unitypackage-"));
  const filename = join(directory, artifact);
  writeFileSync(filename, binary, { flag: "wx", mode: 0o700 });
  if (process.platform !== "win32") chmodSync(filename, 0o700);
  return { directory, filename };
}

function execute(binary, invocation) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, invocation.args, {
      cwd: invocation.cwd,
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) return resolvePromise();
      reject(new Error(`unitypackage exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
    });
  });
}

async function main(env = process.env) {
  const invocation = buildInvocation(env);
  let installation;
  try {
    const binary = input("binary", env);
    const executable = binary
      ? resolve(invocation.cwd, binary)
      : (installation = await installCLI(input("tool-version", env) || "v1.0.0")).filename;
    await execute(executable, invocation);
    const outputPath = resolve(invocation.cwd, invocation.output);
    console.log(`created ${outputPath}`);
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `package-path=${outputPath}\n`);
  } finally {
    if (installation) rmSync(installation.directory, { recursive: true, force: true });
  }
}

module.exports = {
  buildInvocation,
  expectedChecksum,
  installCLI,
  lines,
  main,
  platformArtifact,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`::error::${String(error.message ?? error).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`);
    process.exitCode = 1;
  });
}
