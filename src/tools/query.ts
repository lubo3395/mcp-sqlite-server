import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DbState, QueryResult, TableInfo, SchemaResult, ColumnInfo, IndexInfo } from "../types.js";
import { QuerySchema, ListTablesSchema, GetSchemaSchema } from "../schemas.js";
import { isReadOnlyStatement, formatResultsAsTable, handleError, quoteIdentifier } from "../utils.js";

function handleQuery(
  dbState: DbState,
  sql: string,
  params?: unknown[],
  limit?: number,
  offset?: number,
): QueryResult {
  if (dbState.readonly && !isReadOnlyStatement(sql)) {
    throw new Error("当前为只读模式，不允许执行写操作");
  }

  const effectiveLimit = limit ?? dbState.maxRows;

  // Wrap with LIMIT/OFFSET for SELECT-like statements
  const trimmed = sql.trim().toUpperCase();
  const isSelect = trimmed.startsWith("SELECT") || trimmed.startsWith("WITH") || trimmed.startsWith("PRAGMA");
  const limitedSql = isSelect && effectiveLimit > 0
    ? `SELECT * FROM (${sql}) AS _mcp_limit LIMIT ${effectiveLimit}${offset ? ` OFFSET ${offset}` : ""}`
    : sql;

  // Count total rows for SELECT-like queries
  let totalCount = -1;
  if (isSelect) {
    try {
      const countRow = dbState.mainDb.prepare(
        `SELECT COUNT(*) as cnt FROM (${sql}) AS _mcp_count`
      ).get() as unknown as { cnt: number };
      totalCount = countRow.cnt;
    } catch {
      totalCount = -1;
    }
  }

  const stmt = dbState.mainDb.prepare(limitedSql);
  const rawRows = params && params.length > 0
    ? stmt.all(...(params as []))
    : stmt.all();

  const columns = stmt.columns().map((c) => c.name);
  const rows = (rawRows as Record<string, unknown>[]).map((row) =>
    columns.map((col) => row[col] ?? null)
  );

  const rowCount = rows.length;
  const hasMore = totalCount > 0 && (offset ?? 0) + rowCount < totalCount;

  return {
    sql,
    columns,
    rows,
    row_count: rowCount,
    total_count: totalCount > 0 ? totalCount : rowCount,
    has_more: hasMore,
  };
}

function handleListTables(dbState: DbState, dbAlias?: string): TableInfo[] {
  const schema = dbAlias || "main";
  const tables = dbState.mainDb.prepare(
    `SELECT name FROM "${schema}".sqlite_master WHERE type='table' ORDER BY name`
  ).all() as unknown as { name: string }[];

  return tables.map((t) => {
    const countRow = dbState.mainDb.prepare(
      `SELECT COUNT(*) as cnt FROM "${schema}".${quoteIdentifier(t.name)}`
    ).get() as unknown as { cnt: number };
    return { name: t.name, row_count: countRow.cnt };
  });
}

function handleGetSchema(dbState: DbState, table: string, dbAlias?: string): SchemaResult {
  const schema = dbAlias || "main";

  const columns = dbState.mainDb.prepare(
    `PRAGMA "${schema}".table_info(${quoteIdentifier(table)})`
  ).all() as unknown as ColumnInfo[];

  if (columns.length === 0) {
    throw new Error(`表不存在: ${table}`);
  }

  const rawIndexes = dbState.mainDb.prepare(
    `PRAGMA "${schema}".index_list(${quoteIdentifier(table)})`
  ).all() as unknown as { name: string; unique: number; seq: number }[];

  const indexes: IndexInfo[] = rawIndexes.map((idx) => {
    const idxCols = dbState.mainDb.prepare(
      `PRAGMA "${schema}".index_info(${quoteIdentifier(idx.name)})`
    ).all() as unknown as { name: string }[];
    return {
      name: idx.name,
      unique: idx.unique === 1,
      columns: idxCols.map((c) => c.name),
    };
  });

  const ddlRow = dbState.mainDb.prepare(
    `SELECT sql FROM "${schema}".sqlite_master WHERE type='table' AND name=?`
  ).get(table) as unknown as { sql: string | null } | undefined;

  return {
    table,
    columns,
    indexes,
    ddl: ddlRow?.sql || "",
  };
}

function formatQueryResult(result: QueryResult): string {
  let text = `> SQL: \`${result.sql}\`\n\n`;
  text += `**总行数**: ${result.total_count}`;
  if (result.has_more) {
    text += `，**返回**: ${result.row_count} 行（已截断，使用 limit/offset 分页查看剩余）`;
  } else {
    text += `，**影响行数**: ${result.row_count}`;
  }
  text += "\n\n";
  if (result.columns.length > 0) {
    text += formatResultsAsTable(result.columns, result.rows);
  }
  return text;
}

function formatTableList(tables: TableInfo[]): string {
  if (tables.length === 0) return "（数据库中暂无表）";
  const cols = ["表名", "行数"];
  const rows = tables.map((t) => [t.name, String(t.row_count)]);
  return formatResultsAsTable(cols, rows);
}

function formatSchema(schema: SchemaResult): string {
  let text = `### 表结构: ${schema.table}\n\n`;

  text += `**DDL**:\n\`\`\`sql\n${schema.ddl}\n\`\`\`\n\n`;

  text += "**列**:\n";
  const colData = schema.columns.map((c) => [
    c.name,
    c.type,
    c.pk === 1 ? "是" : "",
    c.notnull === 1 ? "NOT NULL" : "",
    c.dflt_value ?? "",
  ]);
  text += formatResultsAsTable(["列名", "类型", "主键", "约束", "默认值"], colData);

  if (schema.indexes.length > 0) {
    text += "\n\n**索引**:\n";
    const idxData = schema.indexes.map((idx) => [
      idx.name,
      idx.unique ? "唯一" : "普通",
      idx.columns.join(", "),
    ]);
    text += formatResultsAsTable(["索引名", "类型", "列"], idxData);
  }

  return text;
}

export function registerQueryTools(server: McpServer, dbState: DbState): void {
  server.registerTool(
    "sqlite_query",
    {
      title: "执行 SQL 查询",
      description: `执行 SQL 查询语句，返回结果集表格。

支持 SELECT、INSERT、UPDATE、DELETE、PRAGMA、EXPLAIN 等语句。
支持参数化查询（使用 ? 占位符）防止 SQL 注入。

参数:
  - sql: SQL 语句
  - params: 参数数组（可选）
  - db_alias: 数据库别名（可选）

返回:
  - 查询结果表格 + 行数`,
      inputSchema: QuerySchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = handleQuery(dbState, params.sql, params.params, params.limit, params.offset);
        return {
          content: [{ type: "text", text: formatQueryResult(result) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleError(error) }] };
      }
    }
  );

  server.registerTool(
    "sqlite_list_tables",
    {
      title: "列出所有表",
      description: `列出数据库中所有表名及对应的行数。

参数:
  - db_alias: 数据库别名（可选）

返回:
  - 表名和行数的表格`,
      inputSchema: ListTablesSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = handleListTables(dbState, params.db_alias);
        return {
          content: [{ type: "text", text: formatTableList(result) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleError(error) }] };
      }
    }
  );

  server.registerTool(
    "sqlite_get_schema",
    {
      title: "查看表结构",
      description: `查看指定表的完整结构信息。

包括:
  - CREATE TABLE DDL 语句
  - 所有列的名称、类型、主键、约束、默认值
  - 所有索引的名称、类型、涉及的列

参数:
  - table: 表名（必填）
  - db_alias: 数据库别名（可选）

返回:
  - 表结构详细信息`,
      inputSchema: GetSchemaSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = handleGetSchema(dbState, params.table, params.db_alias);
        return {
          content: [{ type: "text", text: formatSchema(result) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleError(error) }] };
      }
    }
  );
}
