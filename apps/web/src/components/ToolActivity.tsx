import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

export const ToolActivity: ToolCallMessagePartComponent = ({ toolName, args, result, status }) => {
  let parsedResult = result;
  if (typeof result === "string") {
    try { parsedResult = JSON.parse(result) as unknown; } catch { /* Keep text results as-is. */ }
  }
  const failed = parsedResult !== null && typeof parsedResult === "object" && "success" in parsedResult && parsedResult.success === false;
  const completed = result !== undefined;
  const state = failed ? "失敗" : completed ? "完成" : status?.type === "incomplete" ? "未完成" : status?.type === "requires-action" ? "等待操作" : "處理中";
  const names: Record<string, string> = {
    get_case_detail: "MCP 查詢案件",
    update_case: "MCP 更新案件",
    refresh_case: "刷新案件畫面",
    prompt_user: "等待使用者輸入",
  };
  const name = names[toolName] ?? toolName;
  return (
    <section className="tool-call" aria-label={`${name}：${state}`}>
      <div className="tool-call-heading">
        <strong>{name}</strong><span className={failed ? "tool-call-failed" : "tool-call-state"}>{state}</span>
      </div>
      <span className="tool-call-name">{toolName}</span>
      <details>
        <summary>查看參數與結果</summary>
        <div className="tool-call-detail"><span>參數</span><pre>{JSON.stringify(args, null, 2)}</pre></div>
        {completed && <div className="tool-call-detail"><span>結果</span><pre>{typeof result === "string" ? result : JSON.stringify(result, null, 2)}</pre></div>}
      </details>
    </section>
  );
};
