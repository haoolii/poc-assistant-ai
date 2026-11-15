# 後端對話、工具與 AI Model 對接規格

本文提供後端團隊設計 MongoDB 持久化與模型串接時使用，範圍是**通用對話、工具呼叫、AG-UI 事件和前端 payload**。這是建議設計與目標 contract；目前 POC 尚未接入 MongoDB，也尚未將完整 payload 提供給模型。

前端實際收送格式請參考 [前端 API Contract](./FRONTEND_API_CONTRACT.md)。

## 1. 一次對話的資料流

```text
前端 POST /agent：messages、tools、context、forwardedProps 等
  ↓
後端保存／合併對話，組合模型請求
  ↓
AI Model 回覆文字或 tool call
  ↓
後端回傳 AG-UI SSE，保存最終訊息與工具結果
  ↓
若工具需要前端處理：前端執行／使用者操作
  ↓
前端在後續 /agent 請求帶回 tool result，模型繼續回答
```

`threadId` 代表一段對話；`runId` 代表一次 `/agent` 執行；`messageId` 代表一則訊息；`toolCallId` 關聯工具呼叫與結果。一次使用者互動可能產生多個 run。**run 結束不等於等待使用者的 tool call 已完成。**

## 2. 要保存什麼？

| 資料 | 必須保存的內容 | 用途 |
| --- | --- | --- |
| 對話 | `threadId`、使用者／租戶歸屬、建立與更新時間 | 找回對話及確認歸屬 |
| 訊息 | 穩定的 `messageId`、順序、完整 AG-UI 訊息 | 還原對話、工具呼叫和互動結果 |
| 工具呼叫 | assistant 訊息內完整 `toolCalls`，含 ID、名稱和 arguments | 顯示工具狀態與 Generative UI |
| 工具結果 | 獨立 `role: "tool"` 訊息及對應 `toolCallId` | 讓前端、模型辨識工具結果 |
| 工具等待狀態 | 原始 `metadata`、已完成的 tool results | 還原待操作或已完成的互動 |
| Run | `runId`、狀態、時間、失敗原因 | 建議保存，供追蹤、重試及中斷處理 |
| `CUSTOM` 事件 | 事件的 `name`、完整最終 `value` 及順序等 | 還原一般訊息外的應用事件 |
| 每筆文字／工具 delta | **不保存** | 串流時累加，僅保存完成後的訊息、工具參數和結果 |

`toolCalls[].function.arguments` 是 JSON **字串**；`prompt_user` 的 Generative UI 元件樹也放在這裡。`tool.content` 依目前 POC 為字串，可能是 JSON 字串。必須保留原始值，不要只保留解析後的顯示文字，也不要只保存最終 assistant 回答。

保留完整 AG-UI 訊息的 `content`、`toolCalls`、`toolCallId`、`metadata` 以及不認識的擴充欄位。不要把前端表單結果合併成普通文字，否則無法可靠還原互動。`metadata.agui.pendingToolCallIds` 可能是舊快照；是否已有結果應再檢查相同 `toolCallId` 的 tool 訊息。

## 3. MongoDB 建議 schema

建議使用 `chat_threads`、`chat_messages`、`chat_runs`、`chat_events`。這不是 POC 已有的 collection。例子使用字串 ID 和 BSON Date；`ObjectId(...)`、`ISODate(...)` 為 `mongosh` 寫法。`tenantId`／`userId` 請依公司身分系統調整。

### `chat_threads`

```javascript
{
  _id: ObjectId("65a000000000000000000001"),
  tenantId: "tenant-1",
  userId: "user-123",
  threadId: "thread-123",
  nextSeq: 4,
  createdAt: ISODate("2026-11-15T09:00:00Z"),
  updatedAt: ISODate("2026-11-15T09:01:00Z")
}
```

`nextSeq` 是下一個訊息序號，從 1 開始；需透過原子操作與並行控制分配。它不是 AG-UI 訊息的一部分。

### `chat_messages`

一筆 document 存一則訊息，`message` 保留完整 AG-UI 物件。以下三筆形成一次「使用者請求 → assistant 顯示表單 → 使用者提交」：

```javascript
{
  _id: ObjectId("65a000000000000000000011"),
  tenantId: "tenant-1", threadId: "thread-123",
  messageId: "user-1", seq: 1,
  message: { id: "user-1", role: "user", content: "請顯示表單" },
  createdAt: ISODate("2026-11-15T09:00:01Z"),
  updatedAt: ISODate("2026-11-15T09:00:01Z")
}
```

```javascript
{
  _id: ObjectId("65a000000000000000000012"),
  tenantId: "tenant-1", threadId: "thread-123",
  messageId: "assistant-1", seq: 2,
  message: {
    id: "assistant-1", role: "assistant", content: "",
    toolCalls: [{
      id: "call-1", type: "function",
      function: {
        name: "prompt_user",
        arguments: "{\"_type\":\"Form\",\"_action\":{\"type\":\"submit_form\"},\"children\":[{\"_type\":\"Input\",\"name\":\"name\",\"label\":\"姓名\"},{\"_type\":\"Button\",\"label\":\"送出\",\"submit\":true}]}"
      }
    }],
    metadata: { agui: { pendingToolCallIds: ["call-1"] } }
  },
  createdAt: ISODate("2026-11-15T09:00:02Z"),
  updatedAt: ISODate("2026-11-15T09:00:02Z")
}
```

```javascript
{
  _id: ObjectId("65a000000000000000000013"),
  tenantId: "tenant-1", threadId: "thread-123",
  messageId: "tool-1", seq: 3,
  message: {
    id: "tool-1", role: "tool", toolCallId: "call-1",
    content: "{\"name\":\"Amy\"}"
  },
  createdAt: ISODate("2026-11-15T09:00:10Z"),
  updatedAt: ISODate("2026-11-15T09:00:10Z")
}
```

外層 `messageId` 必須與 `message.id` 一致。`seq` 是後端維護的對話順序；重試或更新既有訊息時保留原值。若來源沒有 message ID，需在首次寫入時拒絕，或產生並保存穩定對應；不可每次重試都產生新的 ID。

`GET /threads/:threadId` 讀取並映射如下，回應是 `{ messages: [...] }`，而不是 MongoDB document：

```javascript
const docs = await db.collection("chat_messages")
  .find({ tenantId, threadId })
  .sort({ seq: 1 })
  .toArray();
return { messages: docs.map((doc) => doc.message) };
```

前端目前期待完整陣列。若要分頁或截斷歷史，須同步修改前端 history adapter 和 API contract。單獨儲存每則訊息可避免整個對話超過 16 MiB，但單筆訊息仍有 MongoDB document 大小限制；大型附件／結果應另定外部儲存及引用 contract，不可靜默截斷。

### `chat_runs`

```javascript
{
  _id: ObjectId("65a000000000000000000021"),
  tenantId: "tenant-1", threadId: "thread-123", runId: "run-123",
  status: "completed", // running | completed | failed | interrupted
  startedAt: ISODate("2026-11-15T09:00:01Z"),
  finishedAt: ISODate("2026-11-15T09:00:03Z"),
  error: null
}
```

狀態由後端依執行生命週期記錄。`completed` 表示此 run 結束，不代表尚待使用者操作的工具已完成；工具結果要透過 `toolCallId` 配對確認。

### `chat_events`：保存 CUSTOM 最終事件

AG-UI `CUSTOM` 是 `{ type: "CUSTOM", name, value }`；`name` 與 `value` 的意義由前後端約定，`value` 可以是 JSON 資料。它**不會自動變成一般訊息**，也不會自動被 `fromAgUiMessages` 還原或傳給 AI Model。

保存 CUSTOM 事件完整的最終內容及關聯資訊：

```javascript
{
  _id: ObjectId("65a000000000000000000031"),
  tenantId: "tenant-1", threadId: "thread-123", runId: "run-123",
  eventId: "event-123",
  eventSeq: 1,
  event: { type: "CUSTOM", name: "data.updated", value: { resourceId: "item-1" } },
  createdAt: ISODate("2026-11-15T09:00:03Z")
}
```

`eventId`、`eventSeq` 為本建議 schema 的外層欄位，不是必然存在於 AG-UI 事件中；若來源沒有 ID，由後端在**首次持久化時**產生，並在重試時沿用。事件需另外提供查詢／重播協議及前端處理方式；目前 `GET /threads` 只回傳 messages。若 CUSTOM 是刷新等一次性副作用，重新載入歷史時**不要盲目再次執行**，需定義去重和重播規則。

此 collection 只保存 CUSTOM 的完整最終事件，不保存 `TEXT_MESSAGE_*`、`TOOL_CALL_ARGS` 等逐筆 delta 或原始串流事件。目前 POC 未實作 CUSTOM 事件或事件儲存。

### 建議索引

```javascript
db.chat_threads.createIndex({ tenantId: 1, threadId: 1 }, { unique: true });
db.chat_threads.createIndex({ tenantId: 1, userId: 1, updatedAt: -1 });
db.chat_messages.createIndex({ tenantId: 1, threadId: 1, messageId: 1 }, { unique: true });
db.chat_messages.createIndex({ tenantId: 1, threadId: 1, seq: 1 }, { unique: true });
db.chat_runs.createIndex({ tenantId: 1, threadId: 1, runId: 1 }, { unique: true });
// CUSTOM 最終事件索引：
db.chat_events.createIndex({ tenantId: 1, threadId: 1, runId: 1, eventId: 1 }, { unique: true });
db.chat_events.createIndex({ tenantId: 1, threadId: 1, runId: 1, eventSeq: 1 }, { unique: true });
```

上例的 ID 以 tenant／thread 範圍唯一為前提；分片與多租戶設計不同時，應調整索引及唯一性範圍。

## 4. 寫入、完成狀態及重試

1. **Run 開始**：驗證對話歸屬、記錄 run，按 message ID 合併前端提供的訊息。不要用可能過期的前端完整快照無條件覆蓋並行寫入。
2. **串流**：依 `messageId` 累加 `TEXT_MESSAGE_CONTENT.delta`；依 `toolCallId` 累加 `TOOL_CALL_ARGS.delta`。`TEXT_MESSAGE_END` 只代表文字結束，`TOOL_CALL_END` 只代表工具參數結束。
3. **工具結果**：實際執行結果到達後，保存 assistant tool call 和對應 tool message。多個工具須一一配對；成功與失敗都需要可辨識的結果。
4. **前端互動**：表單提交或前端工具完成後，結果由後續 `/agent` 傳回並保存。若結果已在前端產生但請求未到達，POC 不保證保存；若產品要求可靠送達，需另外定義結果提交／確認和重試協議。
5. **Run 結束**：將 run 標記成功、失敗或中斷；僅保存完成後的訊息、工具呼叫及結果，不保存部分 delta。

可用 MongoDB transaction 與版本檢查，或將同一 thread 的寫入序列化，確保 seq 和訊息一致。交易需運行在支援交易的 MongoDB 部署。涉及外部工具或 MCP 更新時，不一定能與 MongoDB 處於同一交易；應另設持久化的工具執行／冪等規則，避免重試造成重複副作用或成功後未記錄。

## 5. 前端 payload 要如何提供給 AI Model？

### 目標 contract

**前端送到 `/agent` 的完整原始 payload 都要讓模型可取得**，不能只處理 `messages`：

| 欄位 | 目標處理方式 |
| --- | --- |
| `messages` | 按順序轉成模型原生訊息；保留完整原始訊息的 ID、metadata、content parts、工具呼叫及結果 |
| `tools` | 完整工具定義及 JSON Schema 要以模型可呼叫工具提供；保留其原始欄位 |
| `context` | 完整提供背景資訊，包含空陣列及巢狀值 |
| `forwardedProps` | 完整提供額外參數，包含空物件及巢狀值 |
| `threadId`、`runId`、`protocolVersion` | 提供前端實際傳入的名稱和原值；缺少時不要捏造 |
| `state`、`resume`、其他實際傳入欄位 | 原樣保留並提供；不得因不在清單中而忽略 |

模型 API 不一定支援全部 AG-UI 欄位。可將 `messages` 和 `tools` 轉為模型原生格式，**另將完整原始 payload 以明確標示的資料上下文提供模型**，確保原生轉換時沒有丟失資訊。只寫入 log、只在後端讀取或只保存到 MongoDB，均不等於提供給模型。應保留值、型別、陣列順序與巢狀結構，尤其勿改寫原本是字串的工具 `arguments`。

完整 payload 可能增加 token 用量，也可能超過模型上下文或傳輸限制；若無法完整提供，應明確回傳錯誤，不能靜默省略。需視模型支援度處理附件等非文字內容；若無法無損提供，同樣不能默默移除。

### 模型格式對應範例

以 OpenAI 相容 Chat Completions 為例，AG-UI 的名稱與模型格式不同：

| AG-UI | 模型格式 |
| --- | --- |
| assistant `toolCalls` | assistant `tool_calls` |
| tool `toolCallId` | tool `tool_call_id` |
| `{ name, description, parameters }` | `{ type: "function", function: { name, description, parameters } }` |

`tool_calls[].id` 與 `tool_call_id` 必須保持一致。轉換後原生模型格式不一定有原始 `message.id`、metadata 或 `forwardedProps`；目標 contract 仍要求透過其他模型可讀的上下文保留它們。

應用程式自行安排的工具事件、CUSTOM 或其他事件**是否提供給模型，須明確定義**；它們不是前端 `/agent` payload 的欄位時，不會因上述要求自動進入模型。若產品需要模型使用其結果，應明確映射為模型可接受的資料或訊息；不要將所有前端事件誤當成模型自行發出的 tool call。

### 目前 POC 與目標的差距

目前 POC 只傳送轉換後的 `messages`、工具定義、system prompt 與當次取得的資料；只讀取 `forwardedProps` 中的特定 ID。其他 `context`、`forwardedProps`、protocol／run ID、訊息 metadata 等尚未完整提供模型。也沒有保存 `reasoning_content`；若啟用需要回傳推理內容的模型工具流程，須依該供應商協議實作。

## 6. 驗收重點

- 多輪文字、工具呼叫及結果按順序保存，重新載入後 `toolCallId` 能配對，表單可還原。
- 測試工具等待中、提交成功／失敗、多個 tool calls、run 中斷、重複請求及並行寫入。
- 測試 CUSTOM 即時處理與最終事件保存，確認事件查詢、順序、去重及歷史載入時不重複觸發副作用。
- 攔截**實際送到模型的請求**，用非空的 `context`、`forwardedProps`、訊息 metadata、工具 schema 及額外欄位逐項比對；同時測試空值、巢狀資料及超過限制時的錯誤。
