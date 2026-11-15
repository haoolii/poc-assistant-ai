# 後端 API、訊息儲存與模型對接

本文說明 POC 後端應提供給前端的行為與目前實作。前端請求及 SSE payload 詳見 [前端 API Contract](./FRONTEND_API_CONTRACT.md)。

## 核心流程

```text
前端 GET /cases/:caseId 與 GET /threads/:threadId
  ↓
前端 POST /agent（messages、tools、forwardedProps.caseId）
  ↓
後端透過 MCP get_case_detail 取得目前案件 → 提供模型最新案件資料
  ↓
模型可回答、呼叫前端 prompt_user，或呼叫後端 MCP update_case
  ↓
update_case 成功 → 後端發出前端 refresh_case tool call
  ↓
前端重新 GET 案件 → 工具結果進入下一次 /agent → 模型繼續回答
```

POC 的 MCP client 和 MCP server 使用 in-memory transport，案件也存在同一程序記憶體；不是外部 MCP 服務。每次 run 的 `get_case_detail` 是**後端主動執行**，並非模型自行選擇。`update_case` 由模型呼叫；後端檢查其 ID 必須與目前頁面相同。更新成功後由後端安排刷新，更新失敗時不發成功刷新。

## 必要 API

| API | 目前 POC 行為 |
| --- | --- |
| `GET /cases/:caseId` | 回傳案件 JSON；不存在回 404 |
| `GET /threads/:threadId` | 回傳 `{ "messages": [...] }`；無歷史時為空陣列 |
| `POST /agent` | 接收 AG-UI 請求，回傳 AG-UI SSE 事件 |

`POST /agent` 需要 `forwardedProps.caseId`。案件 ID 缺失或不存在時，POC 以 `RUN_ERROR` 回報。實際格式與事件範例請參考[前端文件](./FRONTEND_API_CONTRACT.md#執行-agent)。

## 訊息保存格式

歷史以 AG-UI 訊息陣列按原始順序回傳；最少要能還原以下資訊：

| 訊息 | 關鍵欄位 |
| --- | --- |
| 使用者／assistant | `id`、`role`、`content`；保留其他原始欄位和 `metadata` |
| assistant 工具呼叫 | `toolCalls[]` 中的 `id`、`type`、`function.name` 與 `function.arguments` |
| 工具結果 | `id`、`role: "tool"`、`toolCallId`、`content` |

`function.arguments` 是 JSON **字串**；Generative UI 的元件樹就放在 `prompt_user` 的 arguments 中。`toolCallId` 必須等於對應的 `toolCalls[].id`。不可移除 tool 訊息，否則前端無法還原工具結果。完整 JSON 範例見[前端文件](./FRONTEND_API_CONTRACT.md#載入對話)。

### 目前 POC 的寫入時機

- `/agent` 開始時保存前端傳入的完整訊息陣列；成功完成後保存 assistant 訊息和後端工具結果。
- `get_case_detail` 和後端安排的 `refresh_case` 也記錄為工具呼叫。前端提交表單或完成刷新後，結果在**下一次 `/agent` 請求到達時**保存。
- 文字和工具參數的 delta 會累加為最終內容；POC 不保存每筆 SSE 事件。中斷或錯誤時，不保證保存部分 assistant 內容。
- `metadata.agui.pendingToolCallIds` 表示當時尚待前端處理的呼叫；歷史中的 metadata 可能未更新，是否已有結果應同時檢查對應 `tool` 訊息。
- 案件與對話都放在記憶體 `Map`，程序重啟後清空。POC 沒有資料庫交易或同 thread 並行寫入控制。

正式持久化至少需要 thread ID、訊息順序、message ID、role 及完整 AG-UI 訊息 JSON，並明確約定重試、去重、中斷和並行寫入行為。

## MongoDB 資料設計建議

以下是提供公司後端實作的**建議 schema**，目前 POC 尚未連接 MongoDB。建議將對話和訊息分成不同 collection；一個 thread 有多筆訊息，一筆訊息存成一個 document，避免對話不斷增長而碰到 MongoDB 單一 document 的 16 MiB 限制。

### 要保存哪些資料？

| 資料 | 建議保存內容 | 用途 |
| --- | --- | --- |
| 案件 | 案件 ID、標題、狀態、優先級、負責人、客戶、描述 | MCP 查詢／更新與前端案件頁。若公司已有案件資料庫，沿用既有資料來源即可 |
| Thread | thread ID、所屬案件與使用者／租戶、時間、訊息順序計數器 | 找到某個案件的對話與控管排序 |
| Message | message ID、thread ID、順序、**完整 AG-UI 訊息** | 還原使用者、assistant、工具呼叫、表單及工具結果 |
| Run | run ID、thread ID、執行狀態、開始／結束時間及錯誤 | 建議用於追蹤執行、中斷及重試；不需要在歷史 API 當成聊天訊息回傳 |

文字與工具參數的 delta 應累加後**只保存最終結果**，不保存每筆 delta 或逐筆串流事件。CUSTOM 則保存完整的最終事件內容與關聯資訊。

以下範例的 `_id` 示意為 MongoDB `ObjectId`，`createdAt`／`updatedAt`／`startedAt` 使用 **BSON Date**；`ISODate(...)` 為 `mongosh` 表示法。`tenantId`、`userId` 的來源與型別請依公司身分系統決定，所有例子假設它們是字串。`threadId`、`messageId`、`runId` 和 `caseId` 則保留 API 使用的字串，不必轉成 ObjectId。

### 1. `cases`：案件資料

若公司已有案件系統，可不建立此 collection。POC 的 `sample-0` 欄位如下：

```javascript
{
  _id: ObjectId("65a000000000000000000001"),
  tenantId: "tenant-1",
  caseId: "sample-0",
  title: "客戶反映無法登入會員帳號",
  status: "open",             // open | in_progress | resolved | closed
  priority: "medium",         // low | medium | high | urgent
  assignee: "王小明",
  customer: "陳小姐",
  description: "客戶表示重設密碼後仍無法登入，需協助確認帳號狀態。",
  createdAt: ISODate("2026-11-15T09:00:00Z"),
  updatedAt: ISODate("2026-11-15T09:00:00Z")
}
```

這裡的 `tenantId` 和時間欄位是建議新增的持久化資訊，不是目前 POC 的案件 API 欄位。`GET /cases/:caseId` 需映射成前端需要的 `{ id: caseId, title, status, priority, assignee, customer, description }`，而非直接回傳 MongoDB 的 `_id`。

### 2. `chat_threads`：對話

一筆 thread 對應一段對話，透過 `caseId` 關聯案件；同一案件可以有多段對話。

```javascript
{
  _id: ObjectId("65a000000000000000000002"),
  tenantId: "tenant-1",
  userId: "user-123",
  threadId: "thread-123",
  caseId: "sample-0",
  nextSeq: 4,
  createdAt: ISODate("2026-11-15T09:00:00Z"),
  updatedAt: ISODate("2026-11-15T09:02:00Z")
}
```

`nextSeq` 是**下一筆新訊息**可使用的遞增序號，從 1 開始；其實際分配要透過原子操作及並行控制。重新儲存既有訊息時保留原來的 `seq`，不應重新排序。thread ID 的產生方式可以沿用前端，後端仍需核對其歸屬的案件和使用者。

### 3. `chat_messages`：完整 AG-UI 訊息

一筆 document 放一筆 AG-UI 訊息。`message` 直接保存前端應收到的完整物件；外層 `messageId`、`threadId` 和 `seq` 用於查詢、排序與去重。

**使用者訊息**：

```javascript
{
  _id: ObjectId("65a000000000000000000011"),
  tenantId: "tenant-1",
  threadId: "thread-123",
  messageId: "user-1",
  seq: 1,
  message: { id: "user-1", role: "user", content: "請顯示報名表" },
  createdAt: ISODate("2026-11-15T09:00:01Z"),
  updatedAt: ISODate("2026-11-15T09:00:01Z")
}
```

**assistant 訊息與工具呼叫**：

```javascript
{
  _id: ObjectId("65a000000000000000000012"),
  tenantId: "tenant-1",
  threadId: "thread-123",
  messageId: "assistant-1",
  seq: 2,
  message: {
    id: "assistant-1",
    role: "assistant",
    content: "",
    toolCalls: [{
      id: "call-form-1",
      type: "function",
      function: {
        name: "prompt_user",
        arguments: "{\"_type\":\"Form\",\"_action\":{\"type\":\"submit_form\"},\"children\":[{\"_type\":\"Input\",\"name\":\"name\",\"label\":\"姓名\"},{\"_type\":\"Button\",\"label\":\"送出\",\"submit\":true}]}"
      }
    }],
    metadata: { agui: { pendingToolCallIds: ["call-form-1"] } }
  },
  createdAt: ISODate("2026-11-15T09:00:02Z"),
  updatedAt: ISODate("2026-11-15T09:00:02Z")
}
```

**使用者提交表單的工具結果**：

```javascript
{
  _id: ObjectId("65a000000000000000000013"),
  tenantId: "tenant-1",
  threadId: "thread-123",
  messageId: "tool-1",
  seq: 3,
  message: {
    id: "tool-1",
    role: "tool",
    toolCallId: "call-form-1",
    content: "{\"name\":\"Amy\"}"
  },
  createdAt: ISODate("2026-11-15T09:00:10Z"),
  updatedAt: ISODate("2026-11-15T09:00:10Z")
}
```

後端執行的 `get_case_detail`／`update_case` 結果，以及前端 `refresh_case` 結果，也都保存成相同的 `role: "tool"` 訊息。`message.toolCallId` 對應 assistant 的 `message.toolCalls[].id`；工具參數和結果保留原始字串，其他 AG-UI 欄位、metadata 和 content parts 也應原樣保存。**不要只存最終 assistant 文字**，否則無法重建工具過程或表單。

外層 `messageId` 必須與 `message.id` 一致；更新時以同一 message ID 做 upsert，並保留原始 `seq`。本 POC 型別容許沒有 `id`，但上述 MongoDB 設計要求持久化前必須有穩定 ID；缺少時須明確拒絕或在首次寫入產生並保存穩定對應，不能每次重試重新產生。

### 4. `chat_runs`：執行狀態（建議）

一次 `POST /agent` 是一個 run；使用者提交表單後通常會開始另一個 run。此 collection 為正式持久化建議，POC 尚未實作。

```javascript
{
  _id: ObjectId("65a000000000000000000021"),
  tenantId: "tenant-1",
  threadId: "thread-123",
  runId: "run-123",
  status: "completed", // running | completed | failed | interrupted
  startedAt: ISODate("2026-11-15T09:00:01Z"),
  finishedAt: ISODate("2026-11-15T09:00:03Z"),
  error: null
}
```

`completed` 只代表該次 run 結束；**不代表所有工具都已有結果**。例如模型顯示表單後，run 已結束，但仍需等待使用者提交。工具是否完成要依 tool call ID 與工具結果配對，不能只依 run status 或可能過時的 `pendingToolCallIds` 判斷。

### 5. 建議索引

以下假設 ID 在各 tenant 範圍內唯一；若公司的 ID 全域唯一或採用其他分片鍵，索引須依實際部署調整。

```javascript
db.cases.createIndex({ tenantId: 1, caseId: 1 }, { unique: true });
db.chat_threads.createIndex({ tenantId: 1, threadId: 1 }, { unique: true });
db.chat_threads.createIndex({ tenantId: 1, userId: 1, caseId: 1, updatedAt: -1 });
db.chat_messages.createIndex({ tenantId: 1, threadId: 1, messageId: 1 }, { unique: true });
db.chat_messages.createIndex({ tenantId: 1, threadId: 1, seq: 1 }, { unique: true });
db.chat_runs.createIndex({ tenantId: 1, threadId: 1, runId: 1 }, { unique: true });
```

如需要獨立查詢某工具結果，可另建非唯一索引 `{ tenantId: 1, threadId: 1, "message.toolCallId": 1 }`，並先確認使用情境再新增；歷史載入本身只需要按 `seq` 查詢。

### 6. 寫入與讀取流程

1. **開始 run**：驗證 thread 和案件的歸屬，記錄 `runId`；處理前端傳入的訊息時以 `messageId` 去重，既有訊息保留原順序。不要直接用可能過時的前端完整快照無條件覆蓋其他並行寫入。
2. **串流中**：累加文字與工具參數。是否保存部分內容、何時更新 `running` 狀態，需依公司對中斷恢復的要求設計；POC 不保證部分內容。
3. **完成工具**：保存 assistant 的完整 tool call，並各自保存 MCP 或前端工具結果；`TOOL_CALL_END` 只是參數結束，不能當作工具成功。
4. **前端工具等待中**：保留原始 metadata 與待處理呼叫；後續請求收到 `role: "tool"` 結果後，以同一 ID 關聯並寫入。重試不得重複執行 MCP 更新；需要由後端設計工具執行冪等鍵與結果紀錄。
5. **結束 run**：記錄 `completed`、`failed` 或 `interrupted`。多個工具呼叫的結果需一一配對；不得因部分失敗而將全部標記成功。

建議對同一 thread 的序號分配和訊息寫入使用 transaction 與版本控制，或將同一 thread 的寫入序列化；MongoDB transaction 需使用支援交易的部署。更新案件與聊天記錄跨服務／MCP 時，不一定能處於同一交易，應另外處理重試、冪等與部分成功。若需要在使用者刷新後恢復「已送出但續答請求尚未到達」的輸入，需增加明確的前端結果提交／確認機制；目前 POC 不提供此保證。

`GET /threads/:threadId` 的讀取概念如下：

```javascript
const docs = await db.collection("chat_messages")
  .find({ tenantId, threadId })
  .sort({ seq: 1 })
  .toArray();

return { messages: docs.map((doc) => doc.message) };
```

前端目前期待完整 `messages` 陣列。若未來加入分頁或游標，需同步修改前端 history adapter 與 API contract；不能只在後端默默截斷。另外，即使一筆訊息一個 document，也要處理**單筆訊息／工具結果本身**可能超過 16 MiB 的情況；附件或大型內容可另存物件儲存並在 contract 定義引用格式，不能任意截斷現有 AG-UI 內容。

## AG-UI 與模型格式的轉換

目前 POC 將前端的 `messages`、`tools` 轉為 OpenAI 相容格式；工具的 `arguments` 仍為 JSON 字串：

| AG-UI | 模型 Chat Completions |
| --- | --- |
| `assistant.toolCalls` | `assistant.tool_calls` |
| `tool.toolCallId` | `tool.tool_call_id` |
| `{ name, description, parameters }` | `{ type: "function", function: { name, description, parameters } }` |

模型收到後端 system prompt、當次 MCP 查到的案件內容與對話。POC 只合併 `content` 陣列中的文字，不保留圖片等非文字內容。應用程式安排的 `get_case_detail` 歷史不會作為模型生成的 tool call 重播；每次 run 會重新查詢案件。

POC 發送 `thinking: { type: "disabled" }` 作為 DeepSeek 擴充參數；不同 OpenAI 相容服務可能有不同的 thinking 行為。若啟用 DeepSeek thinking 並使用工具，需依[官方文件](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)處理並保存 `reasoning_content`，目前尚未實作。

## 待實作：完整 payload 提供給模型

這是先前約定的**目標 contract，不是目前 POC 行為**：前端傳入 `/agent` 的完整原始 payload 都要讓 AI Model 可取得，而非只提供部分欄位。包括 `messages` 的 ID／metadata、完整 `tools` schema、`context`、`forwardedProps`、`threadId`、`runId`、`protocolVersion`、其他欄位及其空值、順序與巢狀結構。

一種方式是將 messages／tools 轉成模型原生格式，另將**完整原始 payload** 作為模型可讀取的請求上下文；僅寫 log 或儲存在後端並不算提供模型。無法無損傳遞或超出模型限制時應明確回錯，不可靜默省略。完整 schema 會增加 token 用量。

目前實際只使用 `forwardedProps.caseId`，其餘 `forwardedProps`、`context`、protocol／run ID 及訊息 metadata 等尚未完整傳遞。正式導入需另行實作與驗證。

## 驗收

1. 查詢已有及不存在的案件；缺少或錯誤 `caseId` 時回報錯誤。
2. 一般文字串流與多輪歷史可還原；MCP 更新成功後觸發 `refresh_case`。
3. `prompt_user` 提交及前端刷新成功／失敗都能以正確 `toolCallId` 回傳並還原。
4. 無效更新、MCP 失敗、客戶端中斷、重試與並行寫入均有明確結果。
5. 實作完整 payload 目標時，攔截**實際模型請求**，比對所有欄位；不能只驗證 `/agent` 收到資料。
