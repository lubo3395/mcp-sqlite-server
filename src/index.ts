#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDbState } from "./db.js";
import type { DbState } from "./types.js";
import { registerQueryTools } from "./tools/query.js";
import { registerDdlTools } from "./tools/ddl.js";
import { registerIoTools } from "./tools/io.js";

const MIN_NODE_MAJOR = 22;
if (Number(process.versions.node.split(".")[0]) < MIN_NODE_MAJOR) {
  console.error(
    `错误: 需要 Node.js >= ${MIN_NODE_MAJOR}（当前版本: ${process.versions.node}）\n` +
    `此 MCP 服务基于 Node 内置的 node:sqlite 模块，请升级 Node.js 后重试。`
  );
  process.exit(1);
}

function parseArgs(): { dbPaths: string[]; readonly: boolean } {
  const args = process.argv.slice(2);
  const dbPaths: string[] = [];
  let readonly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--db" && i + 1 < args.length) {
      dbPaths.push(args[++i]);
    } else if (args[i] === "--readonly") {
      readonly = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
@lubo3395/mcp-sqlite-server — SQLite 数据库 MCP 服务器

用法:
  mcp-sqlite-server --db <path> [--db <path>...] [--readonly]

参数:
  --db <path>      SQLite 数据库文件路径（必填，可指定多个支持多库）
  --readonly       以只读模式启动（禁止任何写操作）
  --help, -h       显示此帮助信息

示例:
  mcp-sqlite-server --db ./data.db
  mcp-sqlite-server --db ./data.db --readonly
  mcp-sqlite-server --db ./main.db --db ./ref.db
`);
      process.exit(0);
    }
  }

  return { dbPaths, readonly };
}

async function main(): Promise<void> {
  const args = parseArgs();
  let dbState: DbState | null = null;

  try {
    dbState = createDbState(args);

    const server = new McpServer({
      name: "@lubo3395/mcp-sqlite-server",
      version: "1.0.0",
    });

    registerQueryTools(server, dbState);
    registerDdlTools(server, dbState);
    registerIoTools(server, dbState);

    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    console.error("启动失败:", error instanceof Error ? error.message : String(error));
    if (dbState) {
      try { dbState.mainDb.close(); } catch { /* ignore */ }
    }
    process.exit(1);
  }
}

main();
