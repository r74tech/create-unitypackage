# create-unitypackage

Cross-platform GitHub Action for
[`r74tech/unitypackage`](https://github.com/r74tech/unitypackage).

This repository contains no `.unitypackage` format implementation. The Node 24
bootstrap downloads a pinned native Go CLI release, verifies its SHA-256 digest
against the release checksum manifest, and executes it without a shell.

## Usage

```yaml
- uses: actions/checkout@v4
- uses: r74tech/create-unitypackage@v1
  with:
    root: .
    files-glob: |
      Assets/MyPackage/**
    dest: dist/MyPackage.unitypackage
```

The Action works on Linux, macOS, and Windows. `tool-version` defaults to the
pinned CLI version associated with the Action release.

## Inputs

| Input | Description |
| --- | --- |
| `tool-version` | `r74tech/unitypackage` release to download |
| `binary` | Optional local CLI path for development or self-hosted runners |
| `root` | Unity project or package root |
| `files` | Newline-delimited asset paths |
| `files-glob` | Newline-delimited glob patterns |
| `dest` | Output `.unitypackage` path |

For migration from the researched upstream Actions, `project-folder`,
`include-files`, `package-path`, and `working-folder` are also supported.
`include-files` is the path to the legacy newline-delimited `.meta` list.

## Security model

- Release versions must be explicit semantic versions such as `v1.0.0`.
- The downloaded binary must match `checksums.txt` from the same release.
- CLI arguments are passed through `spawn` with `shell: false`.
- Downloaded tools are removed after the Action finishes.

## Development

```sh
npm test
```

The bootstrap uses only Node built-ins and has no npm runtime dependencies.
