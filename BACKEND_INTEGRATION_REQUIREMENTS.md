# 後端對接需求：保存對話與完整傳遞 AG-UI Payload

## 目的與範圍

請後端完成以下兩件事：

1. **完整保存對話、tool call、tool result 和 CUSTOM event**，讓前端可以還原互動過程。
2. **讓 AI Model 取得前端送到 `/agent` 的完整 AG-UI payload**，不能只傳部分欄位。

本文是交付給後端的目標需求。範例使用 MongoDB；目前 POC 尚未接入 MongoDB，也尚未實作完整 payload 傳遞。

---

## 一、保存完整對話與工具互動

### 1. 保存完整 AG-UI 訊息

每筆訊息請保留完整原始物件，包含 `id`、`role`、`content`、`metadata` 與其他擴充欄位；依照原本對話順序儲存和取回。

assistant 呼叫工具時，必須保存 `toolCalls`：

```json
{
  "id": "assistant-1",
  "role": "assistant",
  "content": "",
  "toolCalls": [
    {
      "id": "call-1",
      "type": "function",
      "function": {
        "name": "update_data",
        "arguments": "{\"id\":\"item-1\",\"status\":\"done\"}"
      }
    }
  ],
  "metadata": {
    "agui": { "pendingToolCallIds": ["call-1"] }
  }
}
```

工具執行成功或失敗，都要保存對應的 `tool` 結果：

```json
{
  "id": "tool-result-1",
  "role": "tool",
  "toolCallId": "call-1",
  "content": "{\"success\":true}"
}
```

必須維持以下關係與格式：

- `toolCalls[].id` 等於對應結果的 `toolCallId`。多個 tool calls 和結果必須能分別配對。
- `function.arguments` 是 **JSON 字串**；請原樣保存，不要只存解析後的 object 或顯示文字。
- `prompt_user` 的 Generative UI 元件樹位於 arguments；使用者提交結果同樣要保存為對應的 tool message。
- `metadata` 要保留，但 `pendingToolCallIds` 可能是舊快照；判斷是否已有結果時，仍要查看對應的 tool message。

### 2. 文字與工具參數的串流

後端應在處理串流時依 ID 累加片段，**只保存完成後的最終結果，不保存每筆 delta 或逐筆串流事件**：

| SSE 事件 | 累加結果 |
| --- | --- |
| `TEXT_MESSAGE_CONTENT.delta` | 完整 assistant 文字 |
| `TOOL_CALL_ARGS.delta` | 完整工具參數字串 |

必須保存**完整訊息、工具呼叫與結果**；不需要保存每筆 `TEXT_MESSAGE_CONTENT`、`TOOL_CALL_ARGS` 或其他串流片段。若串流中斷，應記錄 run 的失敗或中斷狀態，不將未完成的片段當作已完成結果。

`TEXT_MESSAGE_END` 代表文字結束；`TOOL_CALL_END` 只代表工具參數結束，**不能當成工具執行成功**。`RUN_FINISHED` 也不代表等待使用者的工具已完成。

### 3. 保存 CUSTOM event

請保存 CUSTOM event 的完整最終內容及其關聯資訊，以便查詢及歷史呈現；不保存相關串流片段。例如：

```json
{
  "threadId": "thread-123",
  "runId": "run-123",
  "eventId": "event-1",
  "eventSeq": 1,
  "event": {
    "type": "CUSTOM",
    "name": "data.updated",
    "value": { "resourceId": "item-1" }
  }
}
```

`eventId`、`eventSeq` 是建議的儲存欄位，並非 AG-UI 一定提供的欄位；沒有時由後端在首次寫入時產生並在重試時沿用。需保留 `threadId`、`runId`、事件順序、完整 `name` 和 `value`。

CUSTOM event 不是一般 message，**不會自動出現在目前的 `GET /threads/:threadId` 或被前端還原**。若前端需要顯示歷史 CUSTOM event，請另行約定查詢 API、回應格式及前端 mapping。刷新等一次性副作用不能在載入歷史時盲目重執行，需定義去重及重播規則。

### 4. MongoDB 建議 collections

| Collection | 建議欄位 |
| --- | --- |
| `chat_threads` | `threadId`、使用者／租戶歸屬、時間、訊息順序計數器 |
| `chat_messages` | `threadId`、`messageId`、`seq`、完整 AG-UI `message`、時間 |
| `chat_runs` | `threadId`、`runId`、狀態、時間、錯誤 |
| `chat_events` | `threadId`、`runId`、`eventId`、`eventSeq`、完整 CUSTOM event、時間 |

建議一筆 message 一個 MongoDB document。歷史 API 查詢時依 `seq` 排序，回傳 `{ "messages": [/* 原始 AG-UI message */] }`，不要回傳 MongoDB 外層 document。

建議索引如下，假設 ID 在 tenant／thread 範圍內唯一；請依公司實際租戶與分片設計調整：

```javascript
db.chat_threads.createIndex({ tenantId: 1, threadId: 1 }, { unique: true });
db.chat_messages.createIndex({ tenantId: 1, threadId: 1, messageId: 1 }, { unique: true });
db.chat_messages.createIndex({ tenantId: 1, threadId: 1, seq: 1 }, { unique: true });
db.chat_runs.createIndex({ tenantId: 1, threadId: 1, runId: 1 }, { unique: true });
db.chat_events.createIndex({ tenantId: 1, threadId: 1, runId: 1, eventId: 1 }, { unique: true });
db.chat_events.createIndex({ tenantId: 1, threadId: 1, runId: 1, eventSeq: 1 }, { unique: true });
```

重試寫入同一 message 時應使用穩定 ID 並保留原 `seq`；不要以過期的前端歷史快照無條件覆蓋其他並行寫入。若工具會修改外部資料，需另外設計持久化冪等機制，避免重試時重複執行。

---

## 二、完整傳遞前端 AG-UI Payload 給模型

前端送到 `/agent` 的資料不只有 `messages`，例如：

```json
{
  "threadId": "thread-123",
  "runId": "run-123",
  "protocolVersion": "1.0",
  "messages": [
    { "id": "user-1", "role": "user", "content": "請幫我處理" }
  ],
  "tools": [],
  "context": [
    { "description": "目前頁面的背景資訊", "value": "使用者正在處理一筆資料" }
  ],
  "forwardedProps": { "resourceId": "item-1" },
  "state": null
}
```

### 必須提供模型的內容

| 欄位 | 要求 |
| --- | --- |
| `messages` | 轉為模型原生訊息；保留原始順序、內容、ID、metadata、工具呼叫與結果 |
| `tools` | 完整工具定義及 JSON Schema 以模型可呼叫工具提供；保留原始欄位 |
| `context` | 完整背景資訊，包含空陣列與巢狀值 |
| `forwardedProps` | 完整額外參數，包含空物件與巢狀值 |
| `threadId`、`runId`、`protocolVersion` | 保留前端實際傳入的名稱與原值；沒傳時不要捏造 |
| `state`、`resume` 和其他欄位 | 前端有傳入時也須保留並提供，不因欄位未列在此表就忽略 |

模型 API 不一定支援 AG-UI 的所有欄位。請將 `messages`／`tools` 轉成模型原生格式，並將**完整原始 payload** 以明確標示的資料上下文提供模型，補足轉換時原生格式放不下的欄位。原始 payload 要標示為前端提供的資料，不應讓其內容覆蓋後端規則。

例如 OpenAI 相容格式：

| AG-UI | 模型格式 |
| --- | --- |
| assistant `toolCalls` | assistant `tool_calls` |
| tool `toolCallId` | tool `tool_call_id` |
| `{ name, description, parameters }` | `{ type: "function", function: { name, description, parameters } }` |

轉換時不可改變工具呼叫 ID、arguments 字串、工具結果及訊息順序。即使模型原生格式沒有 message ID 或 metadata，仍需透過模型可讀取的原始 payload 提供。

**只把 payload 記錄在 log 或保存到 MongoDB，不算傳給模型。**若模型不支援某些內容或完整 payload 超過限制，應明確回報錯誤，不可靜默省略或截斷。完整 payload 會增加 token 用量，請依實際模型上下文限制處理。

CUSTOM event 若不是前端 `/agent` payload 的一部分，不會因上述要求自動進入模型；若產品需要模型使用它，需另行定義如何映射。不要把應用程式自行產生的事件假裝成模型自行發出的 tool call。

---

## 三、驗收條件

### 歷史保存與還原

1. 重新整理後，文字、tool call、參數及 tool result 仍可依原始順序顯示；`toolCallId` 能正確配對。
2. Generative UI 表單可依 arguments 還原，已提交結果與等待操作的狀態可辨識。
3. CUSTOM event 可依約定查詢；載入歷史不會重複執行刷新等副作用。
4. 測試中斷、重試、重複提交、多工具及同一 thread 並行寫入。

### 傳給模型

1. 攔截**實際送給模型的請求**，逐項核對非空 `context`、`forwardedProps`、訊息 metadata、完整工具 schema 及其他欄位。
2. 測試空陣列、空物件、巢狀資料、tool call／result 及順序保持。
3. 測試模型不支援資料類型或 payload 超限時，能明確回報錯誤而非靜默截斷。

目前 POC 的記憶體儲存已保存最終 tool call 和 tool result，但尚未保存 CUSTOM event；也尚未將完整前端 payload 傳給模型。MongoDB 的進一步 document 範例可參考 [通用對話 MongoDB 設計](./BACKEND_CONVERSATION_MONGODB.md)。
