import { useCallback, useEffect, useState } from "react";
import { ChatThread } from "./ChatThread";
import { AgUiProvider } from "./AgUiProvider";

type CaseDetail = {
  id: string;
  title: string;
  status: string;
  priority: string;
  assignee: string;
  customer: string;
  description: string;
};

const labels: Record<string, string> = {
  open: "待處理", in_progress: "處理中", resolved: "已解決", closed: "已結案",
  low: "低", medium: "中", high: "高", urgent: "緊急",
};
const currentCaseId = "sample-0";

export function CaseWorkspacePage() {
  const [item, setItem] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshCase = useCallback(async (caseId: string) => {
    try {
      if (caseId !== currentCaseId) throw new Error("無法刷新目前頁面以外的案件");
      const response = await fetch(`/cases/${encodeURIComponent(caseId)}`);
      if (!response.ok) throw new Error(`案件載入失敗 (${response.status})`);
      const data = await response.json() as CaseDetail;
      setItem(data);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "案件載入失敗");
      throw reason;
    }
  }, []);

  useEffect(() => { void refreshCase(currentCaseId).catch(() => {}); }, [refreshCase]);

  return (
    <main className="app-shell">
      <div className="workspace">
        <div className="case-column">
          <header className="workspace-header">
            <p className="eyebrow">CASE MANAGEMENT · AI ASSISTANT</p>
            <h1>案件工作台</h1>
            <p className="subtitle">透過對話更新案件，資料會自動同步。</p>
          </header>
          <section className="case-panel" aria-labelledby="case-heading">
            <div className="panel-heading">
              <div><p className="eyebrow">CASE DETAIL</p><h2 id="case-heading">案件資訊</h2></div>
              <span className="case-id">{item?.id ?? currentCaseId}</span>
            </div>
            {error && <p className="message-error" role="alert">{error}</p>}
            {!item && !error && <p className="subtitle">正在載入案件...</p>}
            {item && <>
              <h3 className="case-title">{item.title}</h3>
              <dl className="case-fields">
                <div><dt>狀態</dt><dd><span className="case-badge">{labels[item.status] ?? item.status}</span></dd></div>
                <div><dt>優先級</dt><dd><span className="case-badge priority">{labels[item.priority] ?? item.priority}</span></dd></div>
                <div><dt>負責人</dt><dd>{item.assignee}</dd></div>
                <div><dt>客戶</dt><dd>{item.customer}</dd></div>
                <div className="case-description"><dt>案件描述</dt><dd>{item.description}</dd></div>
              </dl>
            </>}
          </section>
        </div>
        <section className="chat-panel" aria-labelledby="chat-heading">
          <div className="panel-heading"><div><p className="eyebrow">AI ASSISTANT</p><h2 id="chat-heading">案件助理</h2></div></div>
          <AgUiProvider key={currentCaseId} caseId={currentCaseId} refreshCase={refreshCase}>
            <ChatThread />
          </AgUiProvider>
        </section>
      </div>
    </main>
  );
}
