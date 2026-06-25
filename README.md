# @lubo3395/mcp-sqlite-server

SQLite 数据库 MCP 服务器 — 让 AI 助手（Claude、Cursor、VS Code Copilot 等）通过 MCP 协议直接操作 SQLite 数据库。

> **Node 版本要求：>= 22**
> 基于 Node.js 内置 `node:sqlite`，**无需任何原生编译依赖**，开箱即用。
> 如果你的 Node 版本低于 22，请升级 Node 或联系我们讨论其他方案。

## 功能

| 工具 | 功能 | 读写 |
|------|------|------|
| `sqlite_query` | 执行任意 SQL 语句（支持参数化查询） | R+W |
| `sqlite_list_tables` | 列出所有表名及行数 | R |
| `sqlite_get_schema` | 查看表的结构、列、索引和 DDL | R |
| `sqlite_create_table` | 创建新表 | W |
| `sqlite_drop_table` | 删除表 | W |
| `sqlite_add_column` | 添加列 | W |
| `sqlite_create_index` | 创建索引 | W |
| `sqlite_drop_index` | 删除索引 | W |
| `sqlite_import_csv` | 从 CSV 文件导入数据 | W |
| `sqlite_import_json` | 从 JSON 文件导入数据 | W |
| `sqlite_export_csv` | 查询结果导出为 CSV | R |
| `sqlite_export_json` | 查询结果导出为 JSON | R |

## 安全

支持 `--readonly` 只读模式。启用后：
- better-sqlite3 驱动层拒绝写入
- `sqlite_query` 只允许 SELECT / PRAGMA / EXPLAIN / WITH
- DDL 和导入工具全部拦截

## 安装

### npx 直接使用（推荐）

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@lubo3395/mcp-sqlite-server", "--db", "./data.db"]
    }
  }
}
```

### 全局安装

```bash
npm install -g @lubo3395/mcp-sqlite-server
mcp-sqlite-server --db ./data.db
```

## 配置

### Claude Desktop / Claude Code

在 `claude_desktop_config.json` 或 `claude.json` 中添加：

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@lubo3395/mcp-sqlite-server", "--db", "D:/path/to/data.db"],
      "env": {}
    }
  }
}
```

只读模式：

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@lubo3395/mcp-sqlite-server", "--db", "D:/path/to/data.db", "--readonly"]
    }
  }
}
```

多数据库：

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@lubo3395/mcp-sqlite-server", "--db", "./main.db", "--db", "./reference.db"]
    }
  }
}
```

### VS Code / GitHub Copilot

在 `.vscode/mcp.json` 中添加：

```json
{
  "servers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@lubo3395/mcp-sqlite-server", "--db", "./data.db"]
    }
  }
}
```

### Cursor

在 `.cursor/mcp.json` 中添加：

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@lubo3395/mcp-sqlite-server", "--db", "./data.db"]
    }
  }
}
```

### Cline / Roo Code

在 `cline.json` 中添加：

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@lubo3395/mcp-sqlite-server", "--db", "./data.db"]
    }
  }
}
```

## Tool 详情

### sqlite_query

执行 SQL 语句，支持参数化查询防止注入。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sql` | string | 是 | SQL 语句 |
| `params` | array | 否 | 参数化查询参数（`?` 占位符） |
| `db_alias` | string | 否 | 数据库别名 |

示例：
```
查询: SELECT * FROM users WHERE age > ?
参数: [25]
```

### sqlite_list_tables

列出所有表名及行数。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `db_alias` | string | 否 | 数据库别名 |

### sqlite_get_schema

查看指定表的结构信息。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `table` | string | 是 | 表名 |
| `db_alias` | string | 否 | 数据库别名 |

### sqlite_create_table

创建新表。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `table` | string | 是 | 表名 |
| `columns` | string | 是 | 列定义 JSON（见下方说明） |
| `if_not_exists` | boolean | 否 | 是否添加 IF NOT EXISTS |
| `db_alias` | string | 否 | 数据库别名 |

`columns` 参数格式：
```json
[
  {"name": "id", "type": "INTEGER", "pk": true, "autoIncrement": true},
  {"name": "name", "type": "TEXT", "notnull": true},
  {"name": "email", "type": "TEXT", "unique": true},
  {"name": "age", "type": "INTEGER", "defaultValue": "0"}
]
```

### sqlite_drop_table / sqlite_add_column / sqlite_create_index / sqlite_drop_index

分别为删除表、添加列、创建索引、删除索引。支持 `if_exists` / `if_not_exists` 和 `db_alias` 参数。

### sqlite_import_csv / sqlite_import_json

从文件导入数据到表。支持 `create_if_not_exists` 自动建表。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_path` | string | 是 | 文件路径 |
| `table` | string | 是 | 目标表名 |
| `create_if_not_exists` | boolean | 否 | 自动建表 |
| `delimiter` | string | 否 | 分隔符（CSV，默认 `,`） |
| `has_header` | boolean | 否 | 是否含表头（CSV，默认 true） |

### sqlite_export_csv / sqlite_export_json

将查询结果导出到文件。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sql` | string | 是 | SELECT 查询 |
| `output` | string | 是 | 输出文件路径 |
| `params` | array | 否 | 参数化查询参数 |
| `overwrite` | boolean | 否 | 是否覆盖已有文件 |

## 命令行参数

```
mcp-sqlite-server --db <path> [--db <path>...] [--readonly]

--db <path>      SQLite 数据库文件路径（必填，可指定多个）
--readonly       只读模式（禁止写操作）
--help, -h       显示帮助
```

## 本地开发

```bash
git clone https://github.com/lubo3395/mcp-sqlite-server.git
cd mcp-sqlite-server
npm install
npm run dev        # 开发模式（热重载）
npm run build      # 构建
npm start          # 启动
```

使用 MCP Inspector 测试：

```bash
npx @modelcontextprotocol/inspector node dist/index.js --db ./test.db
```

## 技术栈

- **运行时**: Node.js 22+（内置 `node:sqlite`）
- **MCP SDK**: `@modelcontextprotocol/sdk`
- **校验**: `zod`
- **构建**: TypeScript + tsc

## License

MIT
