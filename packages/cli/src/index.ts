#!/usr/bin/env bun
import { Command } from "commander";
import { openCommand } from "./commands/open.js";
import { statsCommand } from "./commands/stats.js";

const program = new Command();

program
  .name("ccray")
  .description("Claude Code trace debugger")
  .version("0.1.0");

program
  .command("open")
  .description("Parse sessions and launch the debugger UI")
  .argument("[path]", "Session or project path (default: ~/.claude/projects)")
  .option("-p, --port <number>", "Port for local server", "3333")
  .option("--no-browser", "Don't auto-open browser")
  .action(openCommand);

program
  .command("stats")
  .description("Print session statistics to terminal")
  .argument("[path]", "Session path")
  .option("--json", "Output as JSON")
  .action(statsCommand);

program.parse();
