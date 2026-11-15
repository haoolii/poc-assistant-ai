export type CaseDetail = {
  id: string;
  title: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  priority: "low" | "medium" | "high" | "urgent";
  assignee: string;
  customer: string;
  description: string;
};

export type CaseChanges = Partial<Omit<CaseDetail, "id">>;

const cases = new Map<string, CaseDetail>([["sample-0", {
  id: "sample-0",
  title: "客戶反映無法登入會員帳號",
  status: "open",
  priority: "medium",
  assignee: "王小明",
  customer: "陳小姐",
  description: "客戶表示重設密碼後仍無法登入，需協助確認帳號狀態。",
}]]);

export function getCase(id: string): CaseDetail | undefined {
  const item = cases.get(id);
  return item && structuredClone(item);
}

export function updateCase(id: string, changes: CaseChanges): CaseDetail {
  const current = cases.get(id);
  if (!current) throw new Error(`Case not found: ${id}`);
  const updated = { ...current, ...changes };
  cases.set(id, updated);
  return structuredClone(updated);
}
