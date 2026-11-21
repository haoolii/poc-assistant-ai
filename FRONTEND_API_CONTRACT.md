# 前端 API Contract

本文件描述目前 POC 的前端請求、回應與 AG-UI 事件。資料庫與 MCP 的實作細節請參考 [後端文件](./BACKEND_MESSAGE_CONTRACT.md)。範例為示意；實際 payload 由 `@ag-ui/client` 和 `@assistant-ui/react-ag-ui` 產生，可能包含額外欄位。

## API 一覽

| API | 前端用途 | 回應 |
| --- | --- | --- |
| `GET /cases/:caseId` | 載入或刷新案件 | 案件 JSON；找不到時 404 |
| `GET /threads/:threadId` | 還原對話 | `{ "messages": [...] }` |
| `POST /agent` | 送出訊息或工具結果 | AG-UI `text/event-stream` |

前端以 `caseId` 分別保存 thread ID。`threadId` 識別對話、`runId` 識別一次執行、`messageId` 識別訊息；`toolCallId` 則關聯工具呼叫和結果。

## 案件資料

`GET /cases/sample-0` 的成功回應：

```json
{
  "id": "sample-0",
  "title": "客戶反映無法登入會員帳號",
  "status": "open",
  "priority": "medium",
  "assignee": "王小明",
  "customer": "陳小姐",
  "description": "客戶表示重設密碼後仍無法登入，需協助確認帳號狀態。"
}
```

`status` 為 `open`、`in_progress`、`resolved`、`closed`；`priority` 為 `low`、`medium`、`high`、`urgent`。前端可轉成顯示文字，但 API 值保持不變。

## 載入對話

`GET /threads/:threadId` 回傳依對話順序排列的 AG-UI 訊息，沒有歷史時回傳 `{ "messages": [] }`。以下示範 assistant 呼叫工具及其結果：

```json
{
  "messages": [
    { "id": "user-1", "role": "user", "content": "目前案件負責人是誰？" },
    {
      "id": "assistant-1",
      "role": "assistant",
      "content": "負責人是王小明。",
      "toolCalls": [
        {
          "id": "call-1",
          "type": "function",
          "function": {
            "name": "get_case_detail",
            "arguments": "{\"caseId\":\"sample-0\"}"
          }
        }
      ]
    },
    {
      "id": "tool-1",
      "role": "tool",
      "toolCallId": "call-1",
      "content": "{\"success\":true,\"case\":{\"id\":\"sample-0\",\"assignee\":\"王小明\"}}"
    }
  ]
}
```

`toolCalls[].function.arguments` 與 `tool.content` 是**字串**；上面的案件結果內容經簡化。`toolCallId` 必須對應原本的 `toolCalls[].id`。歷史可包含 `metadata`，應保留並原樣回傳；不要刪除工具訊息。

### 前端 mapping

`apps/web/src/pages/case-workspace/ui/AgUiProvider.tsx` 以 `fromAgUiMessages(messages)` 將 AG-UI 歷史轉成 assistant-ui 訊息，再透過 `ExportedMessageRepository.fromArray(...)` 載入。相同 ID 的工具結果會關聯到原工具呼叫。API 回傳的是 AG-UI 格式，不是轉換後的 assistant-ui 內部格式。

## 執行 Agent

前端以 `HttpAgent` 送出 `POST /agent`。以下僅示範核心欄位：

```json
{
  "threadId": "thread-1",
  "runId": "run-1",
  "protocolVersion": "1.0",
  "forwardedProps": { "caseId": "sample-0" },
  "context": [],
  "messages": [
    { "id": "user-1", "role": "user", "content": "請把案件優先級改成高" }
  ],
  "tools": [
    {
      "name": "refresh_case",
      "description": "刷新案件資料",
      "parameters": { "type": "object" }
    }
  ]
}
```

- `forwardedProps.caseId` 是本 POC **必填的目前案件 ID**。前端透過 `HttpAgent` 的 fetch 包裝將它加入每次請求；API 檢查案件存在，並拒絕模型更新其他案件。
- `messages` 是目前的 AG-UI 對話；互動結果會以 `role: "tool"` 訊息放入後續請求，使用相同的 `toolCallId`。
- `tools` 由前端 runtime 提供。上面的 `parameters` 是**簡化示意**，不是完整 schema；不要寫死或簡化實際傳來的 schema。
- runtime 也可能傳送 `state` 等其他欄位。請容許額外欄位，勿依賴範例只包含這些鍵。

### 前端工具

| 名稱 | 參數與結果 | 行為 |
| --- | --- | --- |
| `prompt_user` | 參數是 Generative UI 元件樹；結果是使用者輸入 | 顯示可互動表單，提交後回傳結果 |
| `refresh_case` | `{ "caseId": "sample-0" }`；結果含 `success`、`caseId`，失敗另含 `error` | 呼叫 `refreshCase(caseId)`，重新 GET 案件並更新左側畫面 |

`get_case_detail` 和 `update_case` 是後端執行的 MCP 工具。它們的呼叫與結果也會透過 AG-UI 事件顯示於對話中。

## SSE 事件

`POST /agent` 回傳 `Content-Type: text/event-stream`。每個事件格式為 `data: <JSON>`，以空行分隔；`: keep-alive` 是註解，不是資料事件。

| 事件 | 核心欄位 | 意義 |
| --- | --- | --- |
| `RUN_STARTED` | `threadId`, `runId` | 執行開始 |
| `TEXT_MESSAGE_START` | `messageId`, `role` | 開始 assistant 訊息 |
| `TEXT_MESSAGE_CONTENT` | `messageId`, `delta` | 追加文字片段 |
| `TEXT_MESSAGE_END` | `messageId` | 文字傳送結束 |
| `TOOL_CALL_START` | `toolCallId`, `toolCallName`, `parentMessageId` | 開始工具呼叫 |
| `TOOL_CALL_ARGS` | `toolCallId`, `delta` | 追加 JSON 參數字串片段 |
| `TOOL_CALL_END` | `toolCallId` | 參數傳送結束，**不代表工具執行成功** |
| `TOOL_CALL_RESULT` | `messageId`, `toolCallId`, `content`, `role` | 後端工具執行結果 |
| `RUN_FINISHED` | `threadId`, `runId`；可含 `outcome` | 本次 run 結束 |
| `RUN_ERROR` | `message` | 本次 run 失敗 |

一筆案件讀取的事件片段如下；POC 每次 run 在呼叫模型前由後端安排此 MCP 查詢，因此它不是模型自行決定的工具呼叫：

```text
data: {"type":"RUN_STARTED","threadId":"thread-1","runId":"run-1"}

data: {"type":"TEXT_MESSAGE_START","messageId":"assistant-1","role":"assistant"}

data: {"type":"TOOL_CALL_START","toolCallId":"call-1","toolCallName":"get_case_detail","parentMessageId":"assistant-1"}

data: {"type":"TOOL_CALL_ARGS","toolCallId":"call-1","delta":"{\"caseId\":\"sample-0\"}"}

data: {"type":"TOOL_CALL_END","toolCallId":"call-1"}

data: {"type":"TOOL_CALL_RESULT","messageId":"tool-1","toolCallId":"call-1","content":"{\"success\":true}","role":"tool"}

data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"assistant-1","delta":"目前案件為待處理。"}

data: {"type":"TEXT_MESSAGE_END","messageId":"assistant-1"}

data: {"type":"RUN_FINISHED","threadId":"thread-1","runId":"run-1"}

```

實際 `TOOL_CALL_RESULT.content` 含完整案件。文字與參數的 `delta` 應依 ID、依序累加。更新成功後，後端另發 `refresh_case`；`RUN_FINISHED.outcome.pendingToolCallIds` 列出仍等待前端處理的工具。前端工具完成後，runtime 透過後續 `/agent` 傳回結果。錯誤以 `RUN_ERROR` 傳遞，不應只靠 HTTP status 判斷成功與否。

## 目前行為與待實作的目標

目前後端將轉換後的 `messages`、工具定義與 MCP 取得的案件內容提供給模型；`forwardedProps.caseId` 用於選取案件。`context`、`forwardedProps` 其他欄位、ID 與訊息 metadata **尚未完整提供給模型**。

先前約定的目標是：**前端送出的完整 payload 都要讓模型可取得**，包含額外欄位、空值和巢狀結構；目前尚未實作，詳見[後端文件](./BACKEND_MESSAGE_CONTRACT.md#待實作完整-payload-提供給模型)。

## 對接驗收

1. 載入案件與空／既有歷史；文字可串流顯示。
2. 模型可讀到最新案件；修改成功後前端 `refresh_case` 更新畫面。
3. `prompt_user` 可顯示及提交；工具結果與歷史還原保持相同 ID。
4. 測試案件不存在、工具失敗、`RUN_ERROR`、串流中斷及刷新失敗。
