# AG-UI DeepSeek POC

React 與 assistant-ui 聊天介面透過 AG-UI HTTP/SSE 連接 Fastify 後端，使用 OpenAI 相容 API 串流回答，並透過 MCP 更新案件。

## 架構與功能

```text
React + Vite + assistant-ui
  | AG-UI HTTP/SSE
Fastify
  | OpenAI-compatible Chat Completions streaming
Ollama (qwen3:30b) / DeepSeek API

Fastify → MCP client → in-memory MCP server → case store
```

- 文字串流、多輪對話及 AG-UI 工具呼叫。
- 以 assistant-ui primitives 組合的聊天介面。
- `@assistant-ui/generative-ui` 自訂元件與互動選項。
- 前端 `refresh_case` 工具及可注入的案件刷新接點。
- `sample-0` 案件存在 server 記憶體；左側顯示案件、右側透過 AI 對話更新。
- 每次對話由後端呼叫 MCP `get_case_detail` 取得目前案件資料。
- 對話紀錄保存在後端記憶體，重啟後會清除。
- Yarn 4 Plug'n'Play monorepo；不使用 `node_modules`。

## 開始使用

需求：Node.js 22 以上、Corepack，以及支援工具呼叫的模型服務。

1. 安裝依賴：

   ```bash
   yarn install
   ```

2. 複製 `apps/server/.env.example` 為 `apps/server/.env`。預設使用 DeepSeek 雲端 API，請填入 API key：

   ```env
   PORT=3000
   DEEPSEEK_API_KEY=your_api_key
   DEEPSEEK_BASE_URL=https://api.deepseek.com
   DEEPSEEK_MODEL=deepseek-flash
   ```

3. 分別在兩個終端機啟動後端和前端：

   ```bash
   yarn dev:server
   ```

   ```bash
   yarn dev:web
   ```

4. 開啟 http://localhost:5173。後端健康檢查位於 http://localhost:3000/health。

主要 API：`GET /cases/:caseId` 取得案件、`GET /threads/:threadId` 載入對話、`POST /agent` 以 AG-UI SSE 串流回覆。

若改用本機 Ollama，先啟動 Ollama 並下載支援工具呼叫的模型，再設定：

```env
DEEPSEEK_BASE_URL=http://localhost:11434/v1
DEEPSEEK_MODEL=qwen3:30b
```

本機 Ollama 不需要 API key。模型的工具呼叫與 Generative UI 表現依模型而異。

Generative UI 使用自訂元件，組合方式見 [選項元件指南](./GENERATIVE_UI_PICKER_GUIDE.md)。

### 接入案件刷新

`refresh_case` 是前端工具，參數為 `{ "caseId": "..." }`。使用者明確要求刷新，或案件更新成功後，模型可呼叫此工具；前端會執行傳給 `AgUiProvider` 的 `refreshCase` 函式。例如，若應用已有案件查詢與畫面更新邏輯：

```tsx
// reloadCase 需由應用提供，並在案件資料已重新載入時 resolve。
<AgUiProvider caseId={currentCaseId} refreshCase={reloadCase}>
  <ChatThread />
</AgUiProvider>
```

`reloadCase` 的型別為 `(caseId: string) => Promise<void>`；應重新取得對應案件並更新畫面，失敗時拋出錯誤。POC 已在 `App.tsx` 接入 `GET /cases/:caseId`。後端透過 MCP `update_case` 更新成功後明確送出 `refresh_case`；未提供 handler 或刷新失敗時，工具回傳 `success: false`。

目前頁面的 `caseId` 由前端放入每次 `/agent` 的 `forwardedProps.caseId`。後端確認案件存在，並只允許更新這個案件；本 POC 的資料庫仍只有 `sample-0`。正式專案需另外驗證使用者對案件的存取權限。

試用：輸入「請把案件狀態改成處理中，優先級改成高，負責人改成李小華」。案件和對話均僅保存在後端記憶體，重啟後重設。

對接文件：

- [後端對接需求：保存對話與完整傳遞 AG-UI Payload](./BACKEND_INTEGRATION_REQUIREMENTS.md)：可直接交付後端的整合需求與驗收條件。
- [前端 API Contract](./FRONTEND_API_CONTRACT.md)：前端送出及接收的 payload、SSE 事件與訊息 mapping。
- [後端訊息儲存與前端對接規格](./BACKEND_MESSAGE_CONTRACT.md)：對話儲存格式與後端實作參考。
- [後端對話、工具與 AI Model 對接規格](./BACKEND_CONVERSATION_MONGODB.md)：通用對話／工具／CUSTOM 的 MongoDB 設計與模型傳遞要求。

## 試用 Generative UI

```text
請用展示卡和選項列表讓我選擇晚餐，選擇後告訴我選了什麼。
```

## 開發指令

```bash
yarn typecheck
yarn build
```

本專案使用 Yarn PnP。若使用 VS Code，先執行 `yarn dlx @yarnpkg/sdks@2.7.4 vscode` 產生本機 SDK，再透過 `TypeScript: Select TypeScript Version` 選擇 `Use Workspace Version`，並安裝 ZipFS 擴充功能以開啟套件原始碼。`.yarnrc.yml` 的 `packageExtensions` 供嚴格 PnP 依賴解析使用。
