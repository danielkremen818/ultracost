#!/usr/bin/env node
// Thin entrypoint: all logic lives in the importable src/cli.js (run()), so it can be
// unit-tested in-process. This shim only forwards argv and translates the returned
// exit code. Behavior (output, exit codes, flags) is identical to calling run() directly.
import { run } from '../src/cli.js';

process.exitCode = await run(process.argv.slice(2), { cwd: process.cwd(), argv1: process.argv[1] });
