#!/usr/bin/env bun
import { Command } from "commander";
import { openCommand } from "./commands/open.js";

const program = new Command();

program
  .name("cray")
  .description("Claude Code session analyzer")
  .version("0.1.0")
  .argument("[path]", "Session or project path (default: ~/.claude/projects)")
  .option("-p, --port <number>", "Port for local server", "3333")
  .option("--no-browser", "Don't auto-open browser")
  .option("-t, --time-breakdown", "Print time breakdown table and exit")
  .action(openCommand);

program.parse();
