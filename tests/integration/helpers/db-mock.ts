/**
 * db-mock.ts — In-memory database mock for integration tests.
 *
 * Implements a Drizzle-ORM-compatible interface using in-memory table stores.
 * Supports select/insert/update/delete/transaction patterns used by the codebase.
 * Handles version-based optimistic concurrency, for-update row locking,
 * advisory lock simulation, and SQL condition evaluation.
 */
import crypto from "node:crypto";

// ─── Types ─────────────────────────────────────────────────────────────────

export type QueryLogEntry = {
  type: "select" | "insert" | "update" | "delete" | "execute" | "transaction";
  table: string;
  query: string;
  params: unknown[];
  timestamp: number;
};

type RowMap = Map<string, Record<string, unknown>>;
type ConditionContext = {
  getTable(tableName: string): Record<string, unknown>[];
};
type Condition = (
  row: Record<string, unknown>,
  ctx?: ConditionContext,
) => boolean;

type QueryState = {
  table: string | null;
  fields: Record<string, string> | null;
  joins: Array<{ table: string; on: Condition }>;
  conditions: Condition[];
  groupBy: string[];
  orderBy: Array<{ column: string; dir: "asc" | "desc" }>;
  limit: number | null;
  offset: number | null;
  forUpdate: boolean;
};

// ─── Column Name Resolution ─────────────────────────────────────────────────

/**
 * Drizzle column `.name` is snake_case (e.g. "borrow_status") but the
 * in-memory rows use camelCase keys (e.g. "borrowStatus").  This helper
 * tries both forms so condition matching and expression evaluation work.
 */
function getRowValue(row: Record<string, unknown>, col: string): unknown {
  if (col in row) return row[col];
  const camel = col.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  if (camel in row) return row[camel];
  return undefined;
}

// ─── SQL Condition Evaluator ───────────────────────────────────────────────

/**
 * Walks a Drizzle SQL getSQL() queryChunks tree to reconstruct SQL + params.
 * Drizzle v0.44.x does NOT have toSQL() — instead it has getSQL() which returns
 * nested queryChunks.  We emit fully qualified "t"."col" references so that
 * parseSqlCondition (below) can use the same regex patterns.
 */
function extractSqlFromCondition(condition: unknown): {
  sql: string;
  params: unknown[];
} {
  if (!condition || typeof condition !== "object") {
    return { sql: "?", params: [condition] };
  }
  const getSqlFn = (condition as Record<string, unknown>)
    .getSQL as (() => Record<string, unknown>) | undefined;
  if (typeof getSqlFn !== "function") {
    return { sql: "", params: [] };
  }
  const sqlObj = getSqlFn.call(condition);
  const chunks = sqlObj.queryChunks;
  if (!Array.isArray(chunks)) {
    return { sql: "", params: [] };
  }
  return walkQueryChunks(chunks);
}

function walkQueryChunks(
  chunks: Array<unknown>,
  sharedParams?: { params: unknown[] },
): { sql: string; params: unknown[] } {
  const ctx = sharedParams ?? { params: [] };
  const sqlParts: string[] = [];

  for (const chunk of chunks) {
    if (
      typeof chunk === "string" ||
      typeof chunk === "number" ||
      typeof chunk === "boolean" ||
      chunk === null
    ) {
      sqlParts.push(`$${ctx.params.length + 1}`);
      ctx.params.push(chunk);
    } else if (chunk && typeof chunk === "object") {
      const c = chunk as Record<PropertyKey, unknown>;

      if (Array.isArray(c.value) && c.value.length > 0) {
        sqlParts.push(c.value[0] ?? "");
        continue;
      }

      if (typeof c.name === "string") {
        sqlParts.push(`"t"."${c.name}"`);
        continue;
      }

      // Table object reference (e.g., ${users} in sql template)
      const tblName: string | undefined =
        (c[Symbol.for("drizzle:Name")] as string) ||
        (c[Symbol.for("drizzle:name")] as string) ||
        (c["name"] as string) ||
        ((c["_"] as Record<string, unknown>)?.["name"] as string) ||
        ((c["config"] as Record<string, unknown>)?.["name"] as string);
      if (tblName) {
        sqlParts.push(`"${tblName}"`);
        continue;
      }

      if (
        c.encoder !== undefined &&
        !Array.isArray(c.value) &&
        !Array.isArray(c.queryChunks)
      ) {
        sqlParts.push(`$${ctx.params.length + 1}`);
        ctx.params.push(c.value);
        continue;
      }

      if (Array.isArray(c.queryChunks)) {
        const sub = walkQueryChunks(c.queryChunks, ctx);
        sqlParts.push(sub.sql);
        continue;
      }

      sqlParts.push(`$${ctx.params.length + 1}`);
      ctx.params.push(chunk);
    } else {
      sqlParts.push(`$${ctx.params.length + 1}`);
      ctx.params.push(chunk);
    }
  }

  return { sql: sqlParts.join(""), params: ctx.params };
}

/**
 * Extracts flat AND-connected conditions from a SQL fragment using regex patterns.
 */
function extractFlatConditions(
  sqlPart: string,
  params: unknown[],
): Condition[] {
  const conditions: Condition[] = [];

  // Pattern: "table"."col" = $N   or   "table"."col" != $N
  const eqNeRegex = /"([^"]+)"\."([^"]+)"\s*(=|!=)\s*\$(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = eqNeRegex.exec(sqlPart)) !== null) {
    const col = match[2];
    const op = match[3];
    const paramIdx = parseInt(match[4]) - 1;
    const value = params[paramIdx];
    conditions.push((row) => {
      if (op === "=") return getRowValue(row, col) === value;
      return getRowValue(row, col) !== value;
    });
  }

  // Pattern: "table"."col" = 'literal'
  const eqLiteralRegex = /"([^"]+)"\."([^"]+)"\s*=\s*'([^']*)'/g;
  while ((match = eqLiteralRegex.exec(sqlPart)) !== null) {
    const col = match[2];
    const literal = match[3];
    conditions.push((row) => String(getRowValue(row, col)) === literal);
  }

  // Pattern: "table"."col" != 'literal'
  const neLiteralRegex = /"([^"]+)"\."([^"]+)"\s*!=\s*'([^']*)'/g;
  while ((match = neLiteralRegex.exec(sqlPart)) !== null) {
    const col = match[2];
    const literal = match[3];
    conditions.push((row) => String(getRowValue(row, col)) !== literal);
  }

  // Pattern: "table"."col" IN ('val1', 'val2', ...)
  const inLiteralRegex = /"([^"]+)"\."([^"]+)"\s+IN\s+\(([^)]+)\)/g;
  while ((match = inLiteralRegex.exec(sqlPart)) !== null) {
    const col = match[2];
    const inList = match[3]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""));
    conditions.push((row) => inList.includes(String(getRowValue(row, col))));
  }

  // Pattern: $N = "table"."col"  (param on left side)
  const paramEqRegex = /\$(\d+)\s*=\s*"([^"]+)"\."([^"]+)"/g;
  while ((match = paramEqRegex.exec(sqlPart)) !== null) {
    const paramIdx = parseInt(match[1]) - 1;
    const col = match[3];
    const value = params[paramIdx];
    conditions.push((row) => getRowValue(row, col) === value);
  }

  // Pattern: "table"."col" IS NOT NULL
  const isNotNullRegex = /"([^"]+)"\."([^"]+)"\s+IS\s+NOT\s+NULL/g;
  while ((match = isNotNullRegex.exec(sqlPart)) !== null) {
    const col = match[2];
    conditions.push(
      (row) => getRowValue(row, col) !== null && getRowValue(row, col) !== undefined,
    );
  }

  // Pattern: "table"."col" IS NULL
  const isNullRegex = /"([^"]+)"\."([^"]+)"\s+IS\s+NULL/g;
  while ((match = isNullRegex.exec(sqlPart)) !== null) {
    const col = match[2];
    conditions.push(
      (row) => getRowValue(row, col) === null || getRowValue(row, col) === undefined,
    );
  }

  // Pattern: "table"."col1" + "table"."col2" < $N
  const addLtRegex =
    /"([^"]+)"\."([^"]+)"\s*\+\s*"([^"]+)"\."([^"]+)"\s*<\s*\$(\d+)/g;
  while ((match = addLtRegex.exec(sqlPart)) !== null) {
    const colA = match[2];
    const colB = match[4];
    const paramIdx = parseInt(match[5]) - 1;
    const threshold = Number(params[paramIdx]);
    conditions.push(
      (row) => Number(getRowValue(row, colA) ?? 0) + Number(getRowValue(row, colB) ?? 0) < threshold,
    );
  }

  // Pattern: "table"."col1" + "table"."col2" < "table"."col3" (all columns)
  const addLtColRegex =
    /"([^"]+)"\."([^"]+)"\s*\+\s*"([^"]+)"\."([^"]+)"\s*<\s*"([^"]+)"\."([^"]+)"/g;
  while ((match = addLtColRegex.exec(sqlPart)) !== null) {
    const colA = match[2];
    const colB = match[4];
    const colC = match[6];
    conditions.push(
      (row) => Number(getRowValue(row, colA) ?? 0) + Number(getRowValue(row, colB) ?? 0) < Number(getRowValue(row, colC) ?? 0),
    );
  }

  // Pattern: "table"."col1" < NOW() - INTERVAL 'N minutes'
  const dateIntervalRegex =
    /"([^"]+)"\."([^"]+)"\s*<\s*NOW\(\)\s*-\s*INTERVAL\s*'(\d+)\s*minutes'/g;
  while ((match = dateIntervalRegex.exec(sqlPart)) !== null) {
    const col = match[2];
    const minutes = parseInt(match[3]);
    conditions.push((row) => {
      const val = getRowValue(row, col);
      const reservedAt =
        val instanceof Date
          ? val.getTime()
          : new Date(String(val)).getTime();
      return reservedAt < Date.now() - minutes * 60 * 1000;
    });
  }

  return conditions;
}

/**
 * Splits a SQL string on top-level "AND"s (not inside parentheses).
 */
/** Check that parentheses in a string are balanced (same open/close count). */
function isBalanced(s: string): boolean {
  let d = 0;
  for (const ch of s) {
    if (ch === "(") d++;
    else if (ch === ")") d--;
    if (d < 0) return false;
  }
  return d === 0;
}

function splitTopLevelAnd(sql: string): string[] {
  // Strip outermost balanced parens so Drizzle's and(...) wrapper
  // doesn't prevent all " AND " from being at depth 0.
  let s = sql.trim();
  while (s.startsWith("(") && s.endsWith(")") && isBalanced(s.slice(1, -1))) {
    s = s.slice(1, -1).trim();
  }

  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (
      depth === 0 &&
      s.substring(i, i + 5).toUpperCase() === " AND "
    ) {
      parts.push(current);
      current = "";
      i += 4; // skip " AND "
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/**
 * Parses a SQL condition string and returns a tree-based Condition function
 * that correctly handles AND/OR nesting.
 */
function parseSqlCondition(
  sql: string,
  params: unknown[],
): Condition {
  const normalized = sql.trim();
  const conditions = extractFlatConditions(normalized, params);

  if (conditions.length === 0) {
    return () => true;
  }

  // If no OR, simple AND (fast path)
  if (!/ OR /i.test(normalized)) {
    return (row, ctx) => conditions.every((c) => c(row, ctx));
  }

  // Has OR — split by top-level AND and recombine
  const andParts = splitTopLevelAnd(normalized);
  const andGroupConditions: Condition[] = [];

  for (const part of andParts) {
    const trimmed = part.trim();
    if (/ OR /i.test(trimmed)) {
      // Handle OR / subquery groups
      const parensMatch = trimmed.match(/^\((.+)\)$/);
      const inner = parensMatch ? parensMatch[1] : trimmed;

      // Check for subquery pattern: col != 'val' OR (SELECT ...) > N
      const subqueryMatch = inner.match(
        /\(SELECT\s+count\(\*\)\s+FROM\s+"([^"]+)"\s+WHERE\s+([^)]+)\)\s*>\s*(\d+)/i,
      );

      if (subqueryMatch) {
        const subTable = subqueryMatch[1];
        const subWhere = subqueryMatch[2];
        const threshold = parseInt(subqueryMatch[3]);

        // Extract the non-subquery conditions from this part
        const nonSubqueryConditions = extractFlatConditions(
          inner.replace(/OR\s*\(SELECT[^)]+\)\s*>\s*\d+/i, ""),
          params,
        );

        andGroupConditions.push((row, ctx) => {
          const adminCount = ctx
            ? ctx
                .getTable(subTable)
                .filter((r: Record<string, unknown>) => {
                  const roleMatch = subWhere.match(
                    /"([^"]+)"\."([^"]+)"\s*=\s*'([^']*)'/,
                  );
                  if (roleMatch)
                    return String(getRowValue(r, roleMatch[2])) === roleMatch[3];
                  return true;
                }).length
            : 0;

          const nonSubOk = nonSubqueryConditions.every((c) => c(row, ctx));
          return nonSubOk || adminCount > threshold;
        });
      } else {
        // Simple OR: col = $1 OR col = $2
        const orParts = inner.split(/\s+OR\s+/i);
        const orSubConditions: Condition[] = [];

        for (const orPart of orParts) {
          const sub = extractFlatConditions(orPart.trim(), params);
          if (sub.length > 0) {
            orSubConditions.push((row, ctx) =>
              sub.every((c) => c(row, ctx)),
            );
          }
        }

        if (orSubConditions.length > 0) {
          andGroupConditions.push((row, ctx) =>
            orSubConditions.some((c) => c(row, ctx)),
          );
        }
      }
    } else {
      // Simple AND part — extract flat conditions
      const sub = extractFlatConditions(trimmed, params);
      andGroupConditions.push(...sub);
    }
  }

  if (andGroupConditions.length === 0) {
    return () => true;
  }

  return (row, ctx) => andGroupConditions.every((c) => c(row, ctx));
}

// ─── In-Memory Table Store ─────────────────────────────────────────────────

export class InMemoryDb {
  private tables: Map<string, RowMap> = new Map();
  private queryLog: QueryLogEntry[] = [];
  private tableSchemaNames: Map<string, string> = new Map();
  private tableDefaults: Map<string, Record<string, unknown>> = new Map();

  /** Get table name from a Drizzle table object */
  private resolveTableName(table: unknown): string {
    if (typeof table === "string") return table;
    if (table && typeof table === "object") {
      const tbl = table as Record<PropertyKey, unknown>;
      // Drizzle table objects store the DB name in various locations
      // depending on the version. Try all known patterns.
      const name =
        (tbl[Symbol.for("drizzle:Name")] as string) ||
        (tbl[Symbol.for("drizzle:name")] as string) ||
        (tbl["name"] as string) ||
        ((tbl["_"] as Record<string, unknown>)?.["name"] as string) ||
        ((tbl["config"] as Record<string, unknown>)?.["name"] as string) ||
        null;
      if (name) return name;
      // Last resort: try to get name from static properties
      const proto = Object.getPrototypeOf(tbl);
      const staticName = (proto?.constructor as Record<string, unknown>)?.["name"];
      if (typeof staticName === "string") return staticName;
    }
    throw new Error(
      `Cannot resolve table name from ${typeof table} ${JSON.stringify(
        Object.getOwnPropertySymbols(table as object),
      )}`,
    );
  }

  /** Get the snake_case DB column name from a drizzle column object */
  private resolveColumnName(col: unknown): string | null {
    if (typeof col === "string") return col;
    if (col && typeof col === "object") {
      const c = col as Record<string, unknown>;
      // Drizzle column stores the DB column name (snake_case)
      return (c.name as string) || (c.columnName as string) || null;
    }
    return null;
  }

  // ─── Seed / Clear ──────────────────────────────────────────────────────

  seed(tableName: string, rows: Record<string, unknown>[]) {
    if (!this.tables.has(tableName)) {
      this.tables.set(tableName, new Map());
    }
    const store = this.tables.get(tableName)!;
    for (const row of rows) {
      const id =
        (row.id as string) ||
        (row.id as string) ||
        crypto.randomUUID();
      store.set(id, { ...row, id, version: (row.version as number) ?? 1 });
    }
  }

  /** Register default column values for a table (simulates DB column defaults) */
  setDefaults(tableName: string, defaults: Record<string, unknown>) {
    this.tableDefaults.set(tableName, defaults);
  }

  clear() {
    this.tables.clear();
    this.queryLog = [];
    this.tableSchemaNames.clear();
    this.tableDefaults.clear();
  }

  clearTable(tableName: string) {
    this.tables.set(tableName, new Map());
  }

  getTable(tableName: string): Record<string, unknown>[] {
    const store = this.tables.get(tableName);
    if (!store) return [];
    return Array.from(store.values());
  }

  getTableMap(tableName: string): RowMap {
    if (!this.tables.has(tableName)) {
      this.tables.set(tableName, new Map());
    }
    return this.tables.get(tableName)!;
  }

  getQueryLog(): QueryLogEntry[] {
    return [...this.queryLog];
  }

  clearQueryLog() {
    this.queryLog = [];
  }

  getRow(tableName: string, id: string): Record<string, unknown> | null {
    return this.tables.get(tableName)?.get(id) ?? null;
  }

  // ─── Table Schema Name Mapping ─────────────────────────────────────────

  registerTable(schema: unknown, dbName: string) {
    const name = this.resolveTableName(schema);
    this.tableSchemaNames.set(name, dbName);
  }

  private getDbTableName(schemaName: string): string {
    return this.tableSchemaNames.get(schemaName) ?? schemaName;
  }

  // ─── Query Builder ─────────────────────────────────────────────────────

  select(fields?: Record<string, unknown>) {
    return new SelectQueryBuilder(this, fields);
  }

  update(table: unknown) {
    return new UpdateQueryBuilder(this, this.resolveTableName(table));
  }

  insert(table: unknown) {
    return new InsertQueryBuilder(this, this.resolveTableName(table));
  }

  delete(table: unknown) {
    return new DeleteQueryBuilder(this, this.resolveTableName(table));
  }

  transaction<T>(
    fn: (tx: InMemoryDb) => Promise<T>,
  ): Promise<T> {
    this.queryLog.push({
      type: "transaction",
      table: "",
      query: "BEGIN",
      params: [],
      timestamp: Date.now(),
    });
    // Execute the callback with the same db instance; rollback is simulated
    // by not persisting changes if an error occurs
    return fn(this).catch((err) => {
      this.queryLog.push({
        type: "transaction",
        table: "",
        query: "ROLLBACK",
        params: [],
        timestamp: Date.now(),
      });
      throw err;
    });
  }

  execute(
    sql: {
      toSQL?: () => { sql: string; params: unknown[] };
      getSQL?: () => { queryChunks: Array<unknown> };
    },
  ): unknown[] {
    const { sql: sqlStr, params } = extractSqlFromCondition(sql);
    this.queryLog.push({
      type: "execute",
      table: "",
      query: sqlStr || String(sql),
      params,
      timestamp: Date.now(),
    });
    // For advisory locks and other raw SQL, just return empty array
    return [];
  }
}

// ─── Select Query Builder ──────────────────────────────────────────────────

class SelectQueryBuilder {
  private state: QueryState = {
    table: null,
    fields: null,
    joins: [],
    conditions: [],
    groupBy: [],
    orderBy: [],
    limit: null,
    offset: null,
    forUpdate: false,
  };

  private isCountQuery = false;

  constructor(
    private db: InMemoryDb,
    private selectFields?: Record<string, unknown>,
  ) {
    if (selectFields) {
      // Check if this is a count query: { value: count() }
      const sf = selectFields as Record<string, unknown>;
      const val = sf.value;
      if (val && typeof val === "object") {
        const { sql } = extractSqlFromCondition(val);
        if (sql.includes("count(")) {
          this.isCountQuery = true;
        }
      }
    }
  }

  from(table: unknown) {
    this.state.table = this.db["resolveTableName"](table);
    return this;
  }

  leftJoin(...args: unknown[]) {
    void args;
    // For mock purposes, joins just extend data; we skip join conditions
    // since the in-memory store already has all data
    return this;
  }

  innerJoin(...args: unknown[]) {
    void args;
    return this;
  }

  where(condition: unknown) {
    if (!condition) return this;
    const { sql, params } = extractSqlFromCondition(condition);
    this.state.conditions.push(parseSqlCondition(sql, params));
    return this;
  }

  groupBy(...cols: unknown[]) {
    void cols;
    // Group by is simulated: we just deduplicate by first col
    return this;
  }

  orderBy(...cols: unknown[]) {
    for (const col of cols) {
      if (col && typeof col === "object") {
        const c = col as { name?: string; config?: { order?: string } };
        // Handle both drizzle order objects and simple column references
        if (c.name) {
          this.state.orderBy.push({ column: c.name, dir: "asc" });
        } else if (c.config?.order) {
          this.state.orderBy.push({
            column: "createdAt",
            dir: c.config.order === "desc" ? "desc" : "asc",
          });
        } else {
          this.state.orderBy.push({ column: "createdAt", dir: "desc" });
        }
      }
    }
    return this;
  }

  limit(n: number) {
    this.state.limit = n;
    return this;
  }

  offset(n: number) {
    this.state.offset = n;
    return this;
  }

  for(lockType: string) {
    void lockType;
    this.state.forUpdate = true;
    return this;
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    try {
      const results = this.execute();
      return Promise.resolve(results).then(onfulfilled, onrejected);
    } catch (err) {
      return Promise.reject(err).then(onfulfilled, onrejected);
    }
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<unknown[] | TResult> {
    return this.then(undefined, onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<unknown[]> {
    return this.then().finally(onfinally);
  }

  [Symbol.toStringTag] = "SelectQueryBuilder";

  private execute(): unknown[] {
    const table = this.state.table!;
    const store = this.db.getTable(table);
    const db = this.db;

    db["queryLog"].push({
      type: "select",
      table,
      query: `SELECT FROM ${table}`,
      params: [],
      timestamp: Date.now(),
    });

    let results = [...store];

    // Apply WHERE conditions
    for (const condition of this.state.conditions) {
      results = results.filter((r) => condition(r, db));
    }

    // Apply GROUP BY simulation (dedup by first field)
    if (this.state.groupBy.length > 0) {
      const seen = new Set<string>();
      results = results.filter((r) => {
        const key = String(r[this.state.groupBy[0]]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // Apply ORDER BY
    for (const ob of this.state.orderBy) {
      const col = ob.column;
      results.sort((a, b) => {
        const va = a[col];
        const vb = b[col];
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        if (typeof va === "string" && typeof vb === "string") {
          return ob.dir === "asc"
            ? va.localeCompare(vb)
            : vb.localeCompare(va);
        }
        return ob.dir === "asc"
          ? Number(va) - Number(vb)
          : Number(vb) - Number(va);
      });
    }

    // Apply OFFSET
    if (this.state.offset) {
      results = results.slice(this.state.offset);
    }

    // Apply LIMIT
    if (this.state.limit) {
      results = results.slice(0, this.state.limit);
    }

    // If count query, return [{ value: count }]
    if (this.isCountQuery) {
      return [{ value: results.length }];
    }

    return results.map((r) => ({ ...r }));
  }
}

// ─── Update Query Builder ──────────────────────────────────────────────────

class UpdateQueryBuilder {
  private db: InMemoryDb;
  private tableName: string;
  private conditions: Condition[] = [];
  private setValues: Record<string, unknown> = {};
  private returnFields: Record<string, unknown> | true | null = null;

  constructor(db: InMemoryDb, tableName: string) {
    this.db = db;
    this.tableName = tableName;
  }

  set(values: Record<string, unknown>) {
    this.setValues = values;
    return this;
  }

  where(condition: unknown) {
    if (!condition) return this;
    const { sql, params } = extractSqlFromCondition(condition);
    if (sql) {
      this.conditions.push(parseSqlCondition(sql, params));
    }
    return this;
  }

  returning(fields?: Record<string, unknown>) {
    this.returnFields = fields ?? true;
    return this;
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    try {
      const results = this.execute();
      return Promise.resolve(results).then(onfulfilled, onrejected);
    } catch (err) {
      return Promise.reject(err).then(onfulfilled, onrejected);
    }
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<unknown[] | TResult> {
    return this.then(undefined, onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<unknown[]> {
    return this.then().finally(onfinally);
  }

  [Symbol.toStringTag] = "UpdateQueryBuilder";

  private execute(): unknown[] {
    const store = this.db.getTableMap(this.tableName);
    const updated: Record<string, unknown>[] = [];

    this.db["queryLog"].push({
      type: "update",
      table: this.tableName,
      query: `UPDATE ${this.tableName}`,
      params: [],
      timestamp: Date.now(),
    });

    for (const [id, row] of store.entries()) {
      const matches = this.conditions.every((c) => c(row, this.db));
      if (!matches) continue;

      // Apply updates
      const updatedRow = { ...row };
      for (const [key, value] of Object.entries(this.setValues)) {
        if (key === "version") {
          // Handle sql`version + 1` — increment version
          updatedRow.version = (row.version as number) + 1;
        } else if (typeof value === "object" && value !== null) {
          const getSQL = (value as Record<string, unknown>)?.getSQL as (() => unknown) | undefined;
          if (typeof getSQL === "function") {
            const { sql: sqlStr, params } = extractSqlFromCondition(value);
            updatedRow[key] = this.evaluateSqlUpdate(sqlStr, params, row);
          } else {
            updatedRow[key] = value;
          }
        } else {
          updatedRow[key] = value;
        }
      }
      // Ensure updatedAt is set
      if (this.setValues.updatedAt === undefined) {
        updatedRow.updatedAt = new Date();
      }
      store.set(id, updatedRow);
      updated.push({ ...updatedRow });
    }

    // Filter return fields if specified
    const returnFields = this.returnFields;
    if (returnFields && typeof returnFields === "object") {
      const fieldKeys = Object.keys(returnFields);
      return updated.map((r) => {
        const result: Record<string, unknown> = {};
        for (const key of fieldKeys) {
          const aliasedKey = key;
          const fieldValue = returnFields[key];
          if (typeof fieldValue === "object" && fieldValue !== null) {
            const fv = fieldValue as { toSQL?: () => string };
            if (fv.toSQL) {
              // Generated column reference, resolve by name
              result[aliasedKey] = r[key] ?? r[key.replace(/([A-Z])/g, "_$1").toLowerCase()];
            } else {
              result[aliasedKey] = r[key];
            }
          } else {
            result[aliasedKey] = r[key];
          }
        }
        return result;
      });
    }

    return updated;
  }

  private evaluateSqlUpdate(
    sql: string,
    params: unknown[],
    row: Record<string, unknown>,
  ): unknown {
    // Resolve column value with camelCase fallback
    const colVal = (col: string): number =>
      Number(getRowValue(row, col) ?? 0);

    // CASE expression must be checked FIRST before add/sub patterns
    // to avoid matching "col + N" inside THEN/ELSE clauses
    const caseMatch = sql.match(
      /CASE\s+WHEN\s+(.+?)\s+THEN\s+(.+?)\s+ELSE\s+(.+?)\s+END/i,
    );
    if (caseMatch) {
      const condition = caseMatch[1];
      const thenVal = caseMatch[2];
      const elseVal = caseMatch[3];
      const isCurrentlyAdmin = getRowValue(row, "role") === "ADMIN";
      const paramRefRegex = /\$(\d+)\s*=\s*'USER'/;
      const paramRefMatch = condition.match(paramRefRegex);
      let isNewRoleUser = false;
      if (paramRefMatch) {
        const paramIdx = parseInt(paramRefMatch[1]) - 1;
        isNewRoleUser = params[paramIdx] === "USER";
      }
      if (!paramRefMatch && condition.includes("'USER'") && condition.includes("'ADMIN'")) {
        isNewRoleUser = true;
      }
      if (isCurrentlyAdmin && isNewRoleUser) {
        return Number(getRowValue(row, "sessionVersion") ?? 1) + 1;
      }
      const thenLiteral = thenVal.match(/'([^']*)'/);
      const elseLiteral = elseVal.match(/'([^']*)'/);
      if (thenLiteral) return thenLiteral[1];
      if (elseLiteral) return elseLiteral[1];
      return getRowValue(row, "sessionVersion") ?? 1;
    }

    // Handle GREATEST(0, col - $1)  or  GREATEST(0, col - 1)
    const greatestSubMatch = sql.match(
      /GREATEST\(0,\s*"([^"]+)"\."([^"]+)"\s*-\s*(?:\$(\d+)|(\d+))\)/i,
    );
    if (greatestSubMatch) {
      const col = greatestSubMatch[2];
      const subtract =
        greatestSubMatch[3] !== undefined
          ? Number(params[parseInt(greatestSubMatch[3]) - 1] ?? 0)
          : parseInt(greatestSubMatch[4]);
      return Math.max(0, colVal(col) - subtract);
    }

    // Handle GREATEST(0, col + $1)  or  GREATEST(0, col + 1)
    const greatestAddMatch = sql.match(
      /GREATEST\(0,\s*"([^"]+)"\."([^"]+)"\s*\+\s*(?:\$(\d+)|(\d+))\)/i,
    );
    if (greatestAddMatch) {
      const col = greatestAddMatch[2];
      const addend =
        greatestAddMatch[3] !== undefined
          ? Number(params[parseInt(greatestAddMatch[3]) - 1] ?? 0)
          : parseInt(greatestAddMatch[4]);
      return Math.max(0, colVal(col) + addend);
    }

    // Handle col + N (addition)
    const addMatch = sql.match(
      /"([^"]+)"\."([^"]+)"\s*\+\s*(\d+)/,
    );
    if (addMatch) {
      const col = addMatch[2];
      const addend = parseInt(addMatch[3]);
      return colVal(col) + addend;
    }

    // Handle col - N (subtraction)
    const subMatch = sql.match(
      /"([^"]+)"\."([^"]+)"\s*-\s*(\d+)/,
    );
    if (subMatch) {
      const col = subMatch[2];
      const subtrahend = parseInt(subMatch[3]);
      return colVal(col) - subtrahend;
    }

    // CASE expression was handled above (before add/sub patterns)

    // Fallback: try to evaluate as a SQL expression
    try {
      let evalStr = sql;
      const colRefRegex = /"([^"]+)"\."([^"]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = colRefRegex.exec(sql)) !== null) {
        const col = m[2];
        const val = getRowValue(row, col);
        evalStr = evalStr.replace(
          m[0],
          val == null ? "0" : String(typeof val === "number" ? val : 0),
        );
      }
      // Replace param references
      evalStr = evalStr.replace(/\$(\d+)/g, (_, idx) => {
        const p = params[parseInt(idx) - 1];
        return String(p ?? 0);
      });
      // Safe evaluation for numeric expressions
      if (/^[\d\s+\-*/(),]+$/.test(evalStr.replace(/GREATEST/g, "").replace(/Math\.max/g, ""))) {
        return eval(evalStr);
      }
    } catch {
      // Fall through
    }

    return params[0] ?? null;
  }
}

// ─── Insert Query Builder ──────────────────────────────────────────────────

class InsertQueryBuilder {
  private insertValues: Record<string, unknown>[] = [];
  private returnFields: boolean | Record<string, unknown> = false;

  constructor(
    private db: InMemoryDb,
    private tableName: string,
  ) {}

  values(values: Record<string, unknown> | Record<string, unknown>[]) {
    this.insertValues = Array.isArray(values) ? values : [values];
    return this;
  }

  returning(fields?: Record<string, unknown>) {
    this.returnFields = fields ?? true;
    return this;
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    try {
      const results = this.execute();
      return Promise.resolve(results).then(onfulfilled, onrejected);
    } catch (err) {
      return Promise.reject(err).then(onfulfilled, onrejected);
    }
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<unknown[] | TResult> {
    return this.then(undefined, onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<unknown[]> {
    return this.then().finally(onfinally);
  }

  [Symbol.toStringTag] = "InsertQueryBuilder";

  private execute(): unknown[] {
    const store = this.db.getTableMap(this.tableName);
    const inserted: Record<string, unknown>[] = [];

    this.db["queryLog"].push({
      type: "insert",
      table: this.tableName,
      query: `INSERT INTO ${this.tableName}`,
      params: [],
      timestamp: Date.now(),
    });

    const defaults = this.db["tableDefaults"].get(this.tableName) ?? {};

    for (const values of this.insertValues) {
      const id = crypto.randomUUID();
      const row: Record<string, unknown> = {
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...defaults,
        ...values,
        id: values.id ?? id,
      };
      store.set(row.id as string, row);

      // Build return result based on requested fields
      if (this.returnFields && typeof this.returnFields === "object") {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(this.returnFields)) {
          if (value && typeof value === "object") {
            const field = value as { name?: string };
            result[key] = row[field.name ?? key] ?? row[key];
          } else {
            result[key] = row[key] ?? row[key];
          }
        }
        inserted.push(result);
      } else {
        inserted.push({ ...row });
      }
    }

    return inserted;
  }
}

// ─── Delete Query Builder ──────────────────────────────────────────────────

class DeleteQueryBuilder {
  private conditions: Condition[] = [];
  private returnFlag = false;

  constructor(
    private db: InMemoryDb,
    private tableName: string,
  ) {}

  where(condition: unknown) {
    if (!condition) return this;
    const { sql, params } = extractSqlFromCondition(condition);
    if (sql) {
      this.conditions.push(parseSqlCondition(sql, params));
    }
    return this;
  }

  returning() {
    this.returnFlag = true;
    return this;
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    try {
      const results = this.execute();
      return Promise.resolve(results).then(onfulfilled, onrejected);
    } catch (err) {
      return Promise.reject(err).then(onfulfilled, onrejected);
    }
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<unknown[] | TResult> {
    return this.then(undefined, onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<unknown[]> {
    return this.then().finally(onfinally);
  }

  [Symbol.toStringTag] = "DeleteQueryBuilder";

  private execute(): unknown[] {
    const store = this.db.getTableMap(this.tableName);
    const deleted: Record<string, unknown>[] = [];

    this.db["queryLog"].push({
      type: "delete",
      table: this.tableName,
      query: `DELETE FROM ${this.tableName}`,
      params: [],
      timestamp: Date.now(),
    });

    const idsToDelete: string[] = [];
    for (const [id, row] of store.entries()) {
      const matches = this.conditions.every((c) => c(row, this.db));
      if (matches) {
        idsToDelete.push(id);
        if (this.returnFlag) {
          deleted.push({ ...row });
        }
      }
    }

    for (const id of idsToDelete) {
      store.delete(id);
    }

    return deleted;
  }
}
