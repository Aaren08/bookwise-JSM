// Inline mock of walkQueryChunks to test with actual drizzle-orm objects
import { eq, and } from "drizzle-orm";

function walkQueryChunks(chunks) {
  const sqlParts = [];
  const params = [];

  for (const chunk of chunks) {
    if (
      typeof chunk === "string" ||
      typeof chunk === "number" ||
      typeof chunk === "boolean" ||
      chunk === null
    ) {
      sqlParts.push("$" + (params.length + 1));
      params.push(chunk);
    } else if (chunk && typeof chunk === "object") {
      const c = chunk;
      if (Array.isArray(c.value) && c.value.length > 0) {
        sqlParts.push(c.value[0] ?? "");
        continue;
      }
      if (typeof c.name === "string") {
        sqlParts.push('"t"."' + c.name + '"');
        continue;
      }
      if (Array.isArray(c.queryChunks)) {
        const sub = walkQueryChunks(c.queryChunks);
        sqlParts.push(sub.sql);
        params.push(...sub.params);
        continue;
      }
      sqlParts.push("$" + (params.length + 1));
      params.push(chunk);
    } else {
      sqlParts.push("$" + (params.length + 1));
      params.push(chunk);
    }
  }
  return { sql: sqlParts.join(""), params };
}

function extractSqlFromCondition(condition) {
  if (!condition || typeof condition !== "object") {
    return { sql: "?", params: [condition] };
  }
  const getSqlFn = condition.getSQL;
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

// Test with a simple eq
const condition = eq({ name: "email" }, "test@test.com");
const result = extractSqlFromCondition(condition);
console.log("eq simple:", JSON.stringify(result));

// Test with eq where value is a real column reference
const condition2 = eq({ name: "email" }, { name: "other_email" });
const result2 = extractSqlFromCondition(condition2);
console.log("eq col ref:", JSON.stringify(result2));

// Test with and + eq
const condition3 = and(
  eq({ name: "email" }, "test@test.com"),
  eq({ name: "status" }, "APPROVED"),
);
const result3 = extractSqlFromCondition(condition3);
console.log("and + eq:", JSON.stringify(result3));

// Now test parseSqlCondition regex
const { sql, params } = result;
console.log("\n--- Testing regex parsing ---");
const eqNeRegex = /"([^"]+)"\."([^"]+)"\s*(=|!=)\s*\$(\d+)/g;
let match;
while ((match = eqNeRegex.exec(sql)) !== null) {
  console.log(
    "Match found:",
    match[0],
    "| table:",
    match[1],
    "| col:",
    match[2],
    "| op:",
    match[3],
    "| paramIdx:",
    match[4],
  );
  const value = params[parseInt(match[4]) - 1];
  console.log("  resolved value:", value);
}
