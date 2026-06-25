import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DbState, CreateTableResult, DropTableResult, AddColumnResult, CreateIndexResult, DropIndexResult, ColumnDef } from "../types.js";
import {
  CreateTableSchema,
  DropTableSchema,
  AddColumnSchema,
  CreateIndexSchema,
  DropIndexSchema,
} from "../schemas.js";
import { handleError, buildColumnDefs, safeJsonParse, quoteIdentifier } from "../utils.js";

function checkReadonly(dbState: DbState): void {
  if (dbState.readonly) {
    throw new Error("当前为只读模式，不允许执行 DDL 操作。请移除 --readonly 参数重启服务");
  }
}

function getQualifiedName(dbAlias: string | undefined, objName: string): string {
  if (!dbAlias || dbAlias === "main") return quoteIdentifier(objName);
  return `"${dbAlias}".${quoteIdentifier(objName)}`;
}

function handleCreateTable(dbState: DbState, params: {
  table: string;
  columns: string;
  if_not_exists: boolean;
  db_alias?: string;
}): CreateTableResult {
  checkReadonly(dbState);

  const colDefs = safeJsonParse<ColumnDef[]>(params.columns);
  if (!Array.isArray(colDefs) || colDefs.length === 0) {
    throw new Error("列定义必须是非空 JSON 数组");
  }

  const qualifiedName = getQualifiedName(params.db_alias, params.table);
  const ifNot = params.if_not_exists ? "IF NOT EXISTS" : "";
  const colSql = buildColumnDefs(colDefs);
  const sql = `CREATE TABLE ${ifNot} ${qualifiedName} (${colSql})`;

  dbState.mainDb.exec(sql);

  return { table: params.table, if_not_exists: params.if_not_exists };
}

function handleDropTable(dbState: DbState, params: {
  table: string;
  if_exists: boolean;
  db_alias?: string;
}): DropTableResult {
  checkReadonly(dbState);

  const qualifiedName = getQualifiedName(params.db_alias, params.table);
  const ifE = params.if_exists ? "IF EXISTS" : "";
  dbState.mainDb.exec(`DROP TABLE ${ifE} ${qualifiedName}`);

  return { table: params.table, if_exists: params.if_exists };
}

function handleAddColumn(dbState: DbState, params: {
  table: string;
  column_name: string;
  column_type: string;
  default_value?: string;
  notnull: boolean;
  db_alias?: string;
}): AddColumnResult {
  checkReadonly(dbState);

  const qualifiedName = getQualifiedName(params.db_alias, params.table);
  const colName = quoteIdentifier(params.column_name);
  let sql = `ALTER TABLE ${qualifiedName} ADD COLUMN ${colName} ${params.column_type}`;
  if (params.notnull) sql += " NOT NULL";
  if (params.default_value !== undefined) sql += ` DEFAULT ${params.default_value}`;

  dbState.mainDb.exec(sql);

  return { table: params.table, column_name: params.column_name };
}

function handleCreateIndex(dbState: DbState, params: {
  table: string;
  index_name: string;
  columns: string[];
  unique: boolean;
  if_not_exists: boolean;
  db_alias?: string;
}): CreateIndexResult {
  checkReadonly(dbState);

  const qualifiedTable = getQualifiedName(params.db_alias, params.table);
  const idxName = getQualifiedName(params.db_alias, params.index_name);
  const unique = params.unique ? "UNIQUE" : "";
  const ifNot = params.if_not_exists ? "IF NOT EXISTS" : "";
  const cols = params.columns.map((c) => quoteIdentifier(c)).join(", ");

  dbState.mainDb.exec(`CREATE ${unique} INDEX ${ifNot} ${idxName} ON ${qualifiedTable} (${cols})`);

  return {
    index_name: params.index_name,
    table: params.table,
    unique: params.unique,
  };
}

function handleDropIndex(dbState: DbState, params: {
  index_name: string;
  if_exists: boolean;
  db_alias?: string;
}): DropIndexResult {
  checkReadonly(dbState);

  const idxName = getQualifiedName(params.db_alias, params.index_name);
  const ifE = params.if_exists ? "IF EXISTS" : "";
  dbState.mainDb.exec(`DROP INDEX ${ifE} ${idxName}`);

  return { index_name: params.index_name, if_exists: params.if_exists };
}

export function registerDdlTools(server: McpServer, dbState: DbState): void {
  server.registerTool(
    "sqlite_create_table",
    {
      title: "创建表",
      description: `创建新表。

columns 参数为 JSON 数组字符串，每个元素支持:
  - name: 列名（必填）
  - type: 列类型（必填，如 INTEGER, TEXT, REAL, BLOB）
  - pk: 是否主键（布尔值）
  - autoIncrement: 是否自增（仅 INTEGER 主键可用）
  - notnull: 是否 NOT NULL
  - unique: 是否 UNIQUE
  - defaultValue: 默认值

示例 columns:
[{"name":"id","type":"INTEGER","pk":true,"autoIncrement":true},{"name":"name","type":"TEXT","notnull":true}]`,
      inputSchema: CreateTableSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = handleCreateTable(dbState, params);
        const ifNot = result.if_not_exists ? "（IF NOT EXISTS）" : "";
        return {
          content: [{ type: "text", text: `表 ${result.table} 创建成功 ${ifNot}` }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleError(error) }] };
      }
    }
  );

  server.registerTool(
    "sqlite_drop_table",
    {
      title: "删除表",
      description: `删除指定表。

参数:
  - table: 表名（必填）
  - if_exists: 表不存在时是否忽略错误
  - db_alias: 数据库别名（可选）`,
      inputSchema: DropTableSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = handleDropTable(dbState, params);
        const ifE = result.if_exists ? "（IF EXISTS）" : "";
        return {
          content: [{ type: "text", text: `表 ${result.table} 已删除 ${ifE}` }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleError(error) }] };
      }
    }
  );

  server.registerTool(
    "sqlite_add_column",
    {
      title: "添加列",
      description: `为指定表添加新列。

参数:
  - table: 表名（必填）
  - column_name: 新列名（必填）
  - column_type: 列类型（必填，如 TEXT, INTEGER, REAL, BLOB）
  - default_value: 默认值（可选）
  - notnull: 是否 NOT NULL
  - db_alias: 数据库别名（可选）`,
      inputSchema: AddColumnSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = handleAddColumn(dbState, params);
        return {
          content: [{ type: "text", text: `列 ${result.column_name} 已添加到表 ${result.table}` }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleError(error) }] };
      }
    }
  );

  server.registerTool(
    "sqlite_create_index",
    {
      title: "创建索引",
      description: `为表创建索引。

参数:
  - table: 表名（必填）
  - index_name: 索引名称（必填）
  - columns: 要索引的列名数组（必填）
  - unique: 是否唯一索引
  - if_not_exists: 索引不存在时创建
  - db_alias: 数据库别名（可选）`,
      inputSchema: CreateIndexSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = handleCreateIndex(dbState, params);
        const unique = result.unique ? "唯一索引" : "索引";
        return {
          content: [{ type: "text", text: `已创建${unique} ${result.index_name}（表: ${result.table}）` }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleError(error) }] };
      }
    }
  );

  server.registerTool(
    "sqlite_drop_index",
    {
      title: "删除索引",
      description: `删除指定索引。

参数:
  - index_name: 索引名（必填）
  - if_exists: 索引不存在时是否忽略错误
  - db_alias: 数据库别名（可选）`,
      inputSchema: DropIndexSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = handleDropIndex(dbState, params);
        const ifE = result.if_exists ? "（IF EXISTS）" : "";
        return {
          content: [{ type: "text", text: `索引 ${result.index_name} 已删除 ${ifE}` }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleError(error) }] };
      }
    }
  );
}
