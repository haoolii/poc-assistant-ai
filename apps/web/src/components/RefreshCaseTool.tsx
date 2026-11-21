import { useAssistantTool } from "@assistant-ui/react";
import { useMemo } from "react";
import { z } from "zod";

export type RefreshCase = (caseId: string) => Promise<void>;

export function RefreshCaseTool({ refreshCase }: { refreshCase?: RefreshCase }) {
  const tool = useMemo(() => ({
    toolName: "refresh_case",
    description: "Refresh the displayed case data after a successful case update, or when the user explicitly asks to refresh a case. This does not update the case itself.",
    parameters: z.object({
      caseId: z.string().min(1).describe("The ID of the case to refresh."),
    }),
    execute: async ({ caseId }: { caseId: string }) => {
      if (!refreshCase) {
        return { success: false, caseId, error: "No case refresh handler is configured." };
      }

      try {
        await refreshCase(caseId);
        return { success: true, caseId };
      } catch (error) {
        return {
          success: false,
          caseId,
          error: error instanceof Error ? error.message : "Case refresh failed.",
        };
      }
    },
  }), [refreshCase]);

  // useAssistantTool(tool);
  return null;
}
