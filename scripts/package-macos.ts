#!/usr/bin/env node
import { packageNative } from "../packages/packaging/src/package-cli.ts";

await packageNative("macos");
