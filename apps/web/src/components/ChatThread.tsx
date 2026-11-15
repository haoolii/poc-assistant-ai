import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import { ToolActivity } from "./ToolActivity";
import { PromptUserRender } from "./generative-toolkit";

export function ChatThread() {
  return (
    <ThreadPrimitive.Root className="thread">
      <ThreadPrimitive.Viewport className="thread-viewport">
        <div className="thread-empty">
          <ThreadPrimitive.Empty>試試輸入「把案件優先級改成高，負責人改成李小華」。</ThreadPrimitive.Empty>
        </div>
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        <ThreadPrimitive.ScrollToBottom className="scroll-bottom">最新訊息</ThreadPrimitive.ScrollToBottom>
      </ThreadPrimitive.Viewport>
      <ComposerPrimitive.Root className="composer">
        <ComposerPrimitive.Input className="composer-input" placeholder="輸入訊息..." aria-label="訊息內容" />
        <ComposerPrimitive.Send className="send-button">傳送</ComposerPrimitive.Send>
      </ComposerPrimitive.Root>
    </ThreadPrimitive.Root>
  );
}

function UserMessage() {
  return <MessagePrimitive.Root className="message message-user"><MessagePrimitive.Content /></MessagePrimitive.Root>;
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="message message-assistant">
      <MessagePrimitive.Content components={{ tools: { Override: ToolWithActivity } }} />
      <div className="message-error"><MessagePrimitive.Error /></div>
    </MessagePrimitive.Root>
  );
}

const ToolWithActivity: ToolCallMessagePartComponent = (props) => (
  <>
    <ToolActivity {...props} />
    {props.toolName === "prompt_user" && <PromptUserRender {...props} />}
  </>
);
