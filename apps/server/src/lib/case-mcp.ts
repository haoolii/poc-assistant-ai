import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { getCase, updateCase, type CaseDetail } from "./case-store.js";

export const getCaseDetailInput = z.object({
  caseId: z.string().min(1).describe("The current case ID supplied by the application."),
}).strict();

export const updateCaseInput = z.object({
  caseId: z.string().min(1).describe("The current case ID supplied by the application."),
  changes: z.object({
    title: z.string().min(1).optional(),
    status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    assignee: z.string().min(1).optional(),
    customer: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
  }).strict().describe("Only the fields the user wants to change."),
}).strict();

async function callCaseTool(name: "get_case_detail" | "update_case", input: Record<string, unknown>) {
  const server = new McpServer({ name: "case-server", version: "1.0.0" });
  server.registerTool("get_case_detail", {
    description: "Get the current case detail by case ID.",
    inputSchema: getCaseDetailInput,
  }, async ({ caseId }) => {
    const item = getCase(caseId);
    if (!item) return { isError: true, content: [{ type: "text" as const, text: `Case not found: ${caseId}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(item) }], structuredContent: { case: item } };
  });
  server.registerTool("update_case", {
    description: "Update the requested case fields.",
    inputSchema: updateCaseInput,
  }, async ({ caseId, changes }) => {
    try {
      const item = updateCase(caseId, changes);
      return { content: [{ type: "text" as const, text: JSON.stringify(item) }], structuredContent: { case: item } };
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Case update failed" }] };
    }
  });
  const client = new Client({ name: "case-agent", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({ name, arguments: input });
    if (result.isError) throw new Error(JSON.stringify(result.content));
    return result.structuredContent;
  } finally {
    await client.close();
    await server.close();
  }
}

export async function callGetCaseDetail(args: unknown): Promise<CaseDetail> {
  const input = getCaseDetailInput.parse(args);
  const result = await callCaseTool("get_case_detail", input);
  if (!result || typeof result !== "object" || !("case" in result) || !result.case) {
    throw new Error("MCP get_case_detail returned no case detail.");
  }
  return result.case as CaseDetail;
}

export async function callUpdateCase(args: unknown) {
  const input = updateCaseInput.parse(args);
  if (Object.keys(input.changes).length === 0) throw new Error("No changes provided.");
  return callCaseTool("update_case", input);
}

export async function updateCurrentCase(caseId: string, args: unknown) {
  const parsed = updateCaseInput.parse(args);
  if (parsed.caseId !== caseId) throw new Error("Tool caseId does not match the current case.");
  return callUpdateCase(parsed);
}
