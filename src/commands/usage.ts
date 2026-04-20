import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getLogger } from '@noego/logger';
import { createCliInstance } from '../create-instance.js';
import type { ToolService } from '@kazibee/core';

const logger = getLogger('kazibee:usage');

type Tool = Awaited<ReturnType<ToolService['list']>>[number];

function generateUsageContent(tools: Tool[]): string {
  const lines: string[] = [];

  lines.push('# Kazibee Tools');
  lines.push('');

  // Tool inventory
  lines.push('## Available Tools');
  lines.push('');
  if (tools.length === 0) {
    lines.push('No tools installed in this directory.');
  } else {
    for (const tool of tools) {
      const desc = tool.description ?? '(no description)';
      lines.push(`- **${tool.name}** — ${desc}`);
    }
  }
  lines.push('');

  // How to discover APIs
  lines.push('## Discovering Tool APIs');
  lines.push('');
  lines.push('Before using any tool, load its API on-demand:');
  lines.push('');
  lines.push('- `kazibee show` — print the .d.ts interface for all tools');
  lines.push('- `kazibee show <toolName>` — print the .d.ts interface for a specific tool');
  lines.push('- `kazibee llm <toolName>` — load tool-specific instructions and usage patterns');
  lines.push('');
  lines.push('Always run `kazibee show <tool>` before working with a tool to confirm method names and signatures.');
  lines.push('');

  // How to execute
  lines.push('## Executing Tools');
  lines.push('');
  lines.push('`kazibee exec` reads JavaScript from stdin. Tool APIs are available as `tools["<name>"]`.');
  lines.push('');
  lines.push('**Important:** Code must be piped via stdin. File path arguments are NOT supported (e.g. `kazibee exec myfile.js` will not work).');
  lines.push('');
  lines.push('**No HTML Entities:** Commands run in a real shell, not a browser. NEVER use HTML entities (`&lt;`, `&gt;`, `&amp;`, `&quot;`, `&apos;`) — always use raw characters (`<`, `>`, `&`, `"`, `\'`). HTML entities cause immediate shell parse errors.');
  lines.push('');
  lines.push('Heredoc (recommended):');
  lines.push('```');
  lines.push("kazibee exec <<'EOF'");
  lines.push('const result = await tools["<name>"].method(args);');
  lines.push('return result;');
  lines.push('EOF');
  lines.push('```');
  lines.push('');

  // Tool composability
  lines.push('## Tool Composability');
  lines.push('');
  lines.push('Kazibee tools are composable building blocks. Chain them together in a single `kazibee exec` to build workflows that span multiple services — similar to Unix pipes, but with full programming control.');
  lines.push('');
  lines.push('- **Sequential chaining** — output of tool A feeds into tool B: generate an image → edit it → upload to Drive');
  lines.push('- **Fan-out** — one result drives multiple actions: read a spreadsheet → create a doc summary AND send an email');
  lines.push('- **Conditional routing** — check a result before deciding the next tool: list calendar events → if conflicts exist, send a notification');
  lines.push('- **Aggregation** — gather from multiple tools, combine into one output: pull data from Sheets + Drive + Calendar → build a unified report');
  lines.push('');

  // Key commands
  lines.push('## Key Commands');
  lines.push('');
  lines.push('- `kazibee list` — list installed tools with descriptions');
  lines.push('- `kazibee show [toolName]` — print .d.ts interfaces');
  lines.push('- `kazibee llm [toolName]` — load usage instructions');
  lines.push('- `kazibee exec` — execute code with tool access');
  lines.push('- `kazibee info` — show tool details and env keys');
  lines.push('- `kazibee env <name> KEY=VALUE KEY2=VALUE2` — set or delete env vars (`KEY=` deletes)');
  lines.push('- `kazibee spec [specName]` — list or print built-in spec documents');
  lines.push('');

  return lines.join('\n');
}

function formatAsSkill(content: string, tools: Tool[]): string {
  const triggerNames = tools.length > 0 ? `, ${tools.map(t => t.name).join(', ')}` : '';

  const frontmatter = [
    '---',
    'name: kazibee',
    `description: Use kazibee to execute tools, run tool commands${triggerNames}. Invoke when the user mentions kazibee, tool execution, or any installed tool by name.`,
    '---',
    '',
  ].join('\n');

  return frontmatter + content;
}

const TARGETS: Record<string, string> = {
  claude: join(homedir(), '.claude', 'skills', 'kazibee', 'SKILL.md'),
  codex: join(homedir(), '.codex', 'skills', 'kazibee', 'SKILL.md'),
};

interface UsageOptions {
  install?: boolean;
}

export async function usage(target?: string, options: UsageOptions = {}): Promise<void> {
  const directory = process.cwd();
  const kazi = createCliInstance();

  try {
    const tools = await kazi.tools.list(directory);

    const content = generateUsageContent(tools);

    // No target: print plain content
    if (!target) {
      process.stdout.write(content);
      return;
    }

    const normalizedTarget = target.toLowerCase();
    if (!TARGETS[normalizedTarget]) {
      logger.error(`Unknown target "${target}". Supported targets: ${Object.keys(TARGETS).join(', ')}`);
      process.exit(1);
    }

    const skillContent = formatAsSkill(content, tools);

    // Target without --install: print to stdout
    if (!options.install) {
      process.stdout.write(skillContent);
      return;
    }

    // Target with --install: write to disk
    const destPath = TARGETS[normalizedTarget];
    const destDir = join(destPath, '..');
    mkdirSync(destDir, { recursive: true });
    writeFileSync(destPath, skillContent, 'utf-8');
    logger.info(`Skill installed to ${destPath}`);
  } finally {
    kazi.close();
  }
}
