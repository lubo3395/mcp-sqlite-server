import { z } from "zod";

export const QuerySchema = z.object({
  sql: z.string().min(1, "SQL 语句不能为空").describe("要执行的 SQL 语句"),
  params: z.array(z.unknown()).optional().describe("参数化查询参数（可选），用于防止 SQL 注入"),
  db_alias: z.string().optional().describe("数据库别名（可选），默认为主数据库"),
}).strict();

export const ListTablesSchema = z.object({
  db_alias: z.string().optional().describe("数据库别名（可选）"),
}).strict();

export const GetSchemaSchema = z.object({
  table: z.string().min(1, "表名不能为空").describe("要查看结构的表名"),
  db_alias: z.string().optional().describe("数据库别名（可选）"),
}).strict();

export const CreateTableSchema = z.object({
  table: z.string().min(1, "表名不能为空").describe("要创建的表名"),
  columns: z.string().min(1, "列定义不能为空").describe(
    `列定义 JSON 字符串，格式: [{"name":"id","type":"INTEGER","pk":true,"autoIncrement":true},{"name":"name","type":"TEXT","notnull":true}]`
  ),
  if_not_exists: z.boolean().default(false).describe("是否添加 IF NOT EXISTS"),
  db_alias: z.string().optional().describe("数据库别名（可选）"),
}).strict();

export const DropTableSchema = z.object({
  table: z.string().min(1, "表名不能为空").describe("要删除的表名"),
  if_exists: z.boolean().default(false).describe("是否添加 IF EXISTS"),
  db_alias: z.string().optional().describe("数据库别名（可选）"),
}).strict();

export const AddColumnSchema = z.object({
  table: z.string().min(1, "表名不能为空").describe("要添加列的表名"),
  column_name: z.string().min(1, "列名不能为空").describe("新列名"),
  column_type: z.string().min(1, "列类型不能为空").describe("列类型（如 TEXT, INTEGER, REAL, BLOB）"),
  default_value: z.string().optional().describe("默认值（可选）"),
  notnull: z.boolean().default(false).describe("是否 NOT NULL"),
  db_alias: z.string().optional().describe("数据库别名（可选）"),
}).strict();

export const CreateIndexSchema = z.object({
  table: z.string().min(1, "表名不能为空").describe("要创建索引的表名"),
  index_name: z.string().min(1, "索引名不能为空").describe("索引名称"),
  columns: z.array(z.string()).min(1, "至少需要一个列名").describe("要索引的列名数组"),
  unique: z.boolean().default(false).describe("是否唯一索引"),
  if_not_exists: z.boolean().default(false).describe("是否添加 IF NOT EXISTS"),
  db_alias: z.string().optional().describe("数据库别名（可选）"),
}).strict();

export const DropIndexSchema = z.object({
  index_name: z.string().min(1, "索引名不能为空").describe("要删除的索引名称"),
  if_exists: z.boolean().default(false).describe("是否添加 IF EXISTS"),
  db_alias: z.string().optional().describe("数据库别名（可选）"),
}).strict();

export const ImportCsvSchema = z.object({
  file_path: z.string().min(1, "文件路径不能为空").describe("CSV 文件路径"),
  table: z.string().min(1, "表名不能为空").describe("目标表名"),
  create_if_not_exists: z.boolean().default(false).describe("表不存在时是否自动创建（基于 CSV 表头推断列类型）"),
  delimiter: z.string().default(",").describe("CSV 分隔符（默认逗号）"),
  has_header: z.boolean().default(true).describe("CSV 是否包含表头行"),
  db_alias: z.string().optional().describe("数据库别名（可选）"),
}).strict();

export const ImportJsonSchema = z.object({
  file_path: z.string().min(1, "文件路径不能为空").describe("JSON 文件路径"),
  table: z.string().min(1, "表名不能为空").describe("目标表名"),
  create_if_not_exists: z.boolean().default(false).describe("表不存在时是否自动创建（基于 JSON 对象键推断列类型）"),
  db_alias: z.string().optional().describe("数据库别名（可选）"),
}).strict();

export const ExportCsvSchema = z.object({
  sql: z.string().min(1, "SQL 语句不能为空").describe("用于导出数据的 SELECT 查询"),
  output: z.string().min(1, "输出路径不能为空").describe("CSV 输出文件路径"),
  params: z.array(z.unknown()).optional().describe("参数化查询参数（可选）"),
  delimiter: z.string().default(",").describe("CSV 分隔符（默认逗号）"),
  include_header: z.boolean().default(true).describe("是否包含表头行"),
  overwrite: z.boolean().default(false).describe("是否覆盖已存在的文件"),
  db_alias: z.string().optional().describe("数据库别名（可选）"),
}).strict();

export const ExportJsonSchema = z.object({
  sql: z.string().min(1, "SQL 语句不能为空").describe("用于导出数据的 SELECT 查询"),
  output: z.string().min(1, "输出路径不能为空").describe("JSON 输出文件路径"),
  params: z.array(z.unknown()).optional().describe("参数化查询参数（可选）"),
  pretty: z.boolean().default(false).describe("是否美化 JSON 输出"),
  overwrite: z.boolean().default(false).describe("是否覆盖已存在的文件"),
  db_alias: z.string().optional().describe("数据库别名（可选）"),
}).strict();
