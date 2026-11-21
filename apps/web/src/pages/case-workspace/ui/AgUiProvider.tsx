import { AuiConfig, AssistantRuntimeProvider, ExportedMessageRepository, Tools } from "@assistant-ui/react";
import { fromAgUiMessages, useAgUiRuntime } from "@assistant-ui/react-ag-ui";
import { HttpAgent, type Message } from "@ag-ui/client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import generativeToolkit from "./generative-toolkit";
import { RefreshCaseTool, type RefreshCase } from "./RefreshCaseTool";

const config = AuiConfig({ tools: Tools({ toolkit: generativeToolkit }) });

type AgUiProviderProps = { children: ReactNode; caseId: string; refreshCase?: RefreshCase };

export function AgUiProvider(props: AgUiProviderProps) {
  return <CaseAgUiProvider key={props.caseId} {...props} />;
}

function CaseAgUiProvider({ children, caseId, refreshCase }: AgUiProviderProps) {
  const [threadId] = useState(() => {
    const key = `ag-ui-local-poc-thread-id:${caseId}`;
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(key, created);
    return created;
  });
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/threads/${threadId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load conversation history");
        return response.json() as Promise<{ messages: Message[] }>;
      })
      .then(({ messages: storedMessages }) => {
        if (active) {
          setMessages(storedMessages);
          setLoadError(null);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(error instanceof Error ? error.message : "Unable to load conversation history");
        }
      });
    return () => { active = false; };
  }, [threadId]);

  if (loadError) return <p className="history-error" role="alert">無法載入對話紀錄：{loadError}</p>;
  if (messages === null) return <p className="history-loading">正在載入對話紀錄...</p>;
  return <AgUiRuntimeProvider threadId={threadId} messages={messages} caseId={caseId} refreshCase={refreshCase}>{children}</AgUiRuntimeProvider>;
}

function AgUiRuntimeProvider({
  children,
  threadId,
  messages,
  caseId,
  refreshCase,
}: {
  children: ReactNode;
  threadId: string;
  messages: Message[];
  caseId: string;
  refreshCase?: RefreshCase;
}) {
  const agent = useMemo(() => new HttpAgent({
    url: "/agent",
    threadId,
    fetch: (input, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected an AG-UI JSON request body");
      const body = JSON.parse(init.body) as { forwardedProps?: Record<string, unknown> };
      return fetch(input, {
        ...init,
        body: JSON.stringify({ ...body, forwardedProps: { ...body.forwardedProps, caseId } }),
      });
    },
  }), [threadId, caseId]);
  const history = useMemo(() => ({
    scopeId: threadId,
    load: async () => ExportedMessageRepository.fromArray(fromAgUiMessages(messages)),
    append: async () => {},
    update: async () => {},
  }), [messages, threadId]);
  const runtime = useAgUiRuntime({ agent, adapters: { history } });

  return (
    <AssistantRuntimeProvider runtime={runtime} config={config}>
      <RefreshCaseTool refreshCase={refreshCase} />
      {children}
    </AssistantRuntimeProvider>
  );
}
