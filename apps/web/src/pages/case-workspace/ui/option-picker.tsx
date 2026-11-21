import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { useAuiState } from "@assistant-ui/react";

type OptionPickerState = {
  mode: "single" | "multiple";
  selected: string[];
  completed: boolean;
  select: (value: string, dispatch: () => void) => void;
};

const OptionPickerContext = createContext<OptionPickerState | null>(null);

type OptionPickerProps = {
  selectionMode?: "single" | "multiple";
  submitLabel?: string;
  children?: ReactNode;
  $action?: { type: string; [key: string]: unknown };
  $dispatch?: (action: { type: string; [key: string]: unknown }) => unknown;
};

function OptionPicker({ selectionMode = "single", submitLabel = "確認選擇", children, $action, $dispatch }: OptionPickerProps) {
  const result = useAuiState((state) => state.optional.part?.type === "tool-call" ? state.optional.part.result : undefined);
  const submitted = useRef(false);
  const [selected, setSelected] = useState<string[]>([]);
  let restoredResult = result;
  if (selectionMode === "multiple" && typeof result === "string") {
    try { restoredResult = JSON.parse(result) as unknown; } catch { /* Ignore non-JSON results. */ }
  }
  const restored = Array.isArray(restoredResult) && restoredResult.every((value) => typeof value === "string")
    ? restoredResult as string[]
    : selectionMode === "single" && typeof result === "string" ? [result] : undefined;
  const selectedValues = restored ?? selected;
  const completed = result !== undefined || (selectionMode === "single" && selected.length > 0);

  const select = (value: string, dispatch: () => void) => {
    if (submitted.current || result !== undefined) return;
    if (selectionMode === "multiple") {
      setSelected((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
      return;
    }
    submitted.current = true;
    setSelected([value]);
    dispatch();
  };

  const submit = () => {
    if (submitted.current || result !== undefined || selected.length === 0 || !$dispatch) return;
    submitted.current = true;
    $dispatch({ ...$action, type: $action?.type ?? "select_options", $input: selected });
  };

  return (
    <OptionPickerContext.Provider value={{ mode: selectionMode, selected: selectedValues, completed, select }}>
      <section className="option-picker" aria-label="Choose options">
        {children}
        {selectionMode === "multiple" && (
          <button type="button" className="picker-submit" disabled={!$dispatch || completed || selectedValues.length === 0} onClick={submit}>
            {submitLabel}
          </button>
        )}
      </section>
    </OptionPickerContext.Provider>
  );
}

type OptionPickerOptionProps = {
  label: string;
  value: string;
  disabled?: boolean;
  children?: ReactNode;
  $action?: { type: string; [key: string]: unknown };
  $dispatch?: (action: { type: string; [key: string]: unknown }) => unknown;
};

function OptionPickerOption({ label, value, disabled, children, $action, $dispatch }: OptionPickerOptionProps) {
  const picker = useContext(OptionPickerContext);
  const validValue = typeof value === "string" && value.length > 0;
  const selected = picker?.selected.includes(value) ?? false;

  return (
    <button
      type="button"
      className="picker-option"
      role={picker?.mode === "multiple" ? "checkbox" : undefined}
      aria-checked={picker?.mode === "multiple" ? selected : undefined}
      aria-pressed={picker?.mode === "multiple" ? undefined : selected}
      disabled={disabled || !picker || !$dispatch || !validValue || picker.completed}
      onClick={() => picker?.select(value, () => $dispatch?.({ ...$action, type: $action?.type ?? "select_option", $input: value }))}
    >
      <span className={`picker-option-indicator${picker?.mode === "multiple" ? " picker-option-indicator-multiple" : ""}`} aria-hidden="true" />
      <span className="picker-option-label">{label}{children}</span>
    </button>
  );
}

export const optionPickerComponents = {
  OptionPicker: {
    description: "Interactive choice container; use as the root of prompt_user. Set selectionMode to single (default) to submit immediately, or multiple to let the user toggle several options and submit them together. In multiple mode the result is an array of values and submitLabel optionally changes the submit button text. Children can include OptionPickerHeader, OptionPickerCarousel, then OptionPickerOptions. Do not nest OptionPicker.",
    properties: z.object({
      selectionMode: z.enum(["single", "multiple"]).optional().describe("single submits immediately; multiple allows selecting several options before submitting."),
      submitLabel: z.string().optional().describe("Text on the submit button in multiple mode."),
    }),
    render: OptionPicker,
  },
  OptionPickerHeader: {
    description: "Introductory section directly inside OptionPicker before OptionPickerCarousel. Use title for the heading and optional subtitle for supporting text. Do not use Header, Text, Caption, or interactive child components.",
    properties: z.object({
      title: z.string().describe("Heading text."),
      subtitle: z.string().optional().describe("Optional supporting text."),
    }),
    render: ({ title, subtitle, children }: { title?: string; subtitle?: string; children?: ReactNode }) => (
      <header className="picker-header">
        {title && <h3 className="picker-header-title">{title}</h3>}
        {subtitle && <span>{subtitle}</span>}
        {children}
      </header>
    ),
  },
  OptionPickerCarousel: {
    description: "Horizontal display-only carousel directly inside OptionPicker between OptionPickerHeader and OptionPickerOptions. Its direct children are OptionPickerCard nodes containing informational content. Carousel cards are not selectable; never place options or interactive components here. No properties.",
    properties: z.object({}),
    render: ({ children }: { children?: ReactNode }) => <div className="picker-carousel" role="region" aria-label="資訊卡片" tabIndex={0}>{children}</div>,
  },
  OptionPickerCard: {
    description: "A non-interactive informational card directly inside OptionPickerCarousel. Put its visible text in children as a plain string. It does not select or submit anything; do not use Header, Text, Caption, buttons, inputs, or other interactive elements inside. No properties.",
    properties: z.object({}),
    render: ({ children }: { children?: ReactNode }) => <div className="picker-card">{children}</div>,
  },
  OptionPickerOptions: {
    description: "Vertical list of selectable options directly inside OptionPicker, after OptionPickerCarousel. Its direct children must be OptionPickerOption nodes. Provide at least two options with unique values; do not place display cards or nested layouts here. No properties.",
    properties: z.object({}),
    render: ({ children }: { children?: ReactNode }) => <div className="picker-options" role="group" aria-label="選項">{children}</div>,
  },
  OptionPickerOption: {
    description: "One option as a direct child of OptionPickerOptions. Required label is visible text and value is a unique non-empty string. In single mode clicking returns its value immediately; in multiple mode clicking toggles it and submission returns all selected values. Optional disabled prevents selection. Do not put this in OptionPickerCarousel or nest interactive components inside it.",
    properties: z.object({
      label: z.string().min(1).describe("Visible option label."),
      value: z.string().min(1).describe("Unique non-empty value returned when this option is selected."),
      disabled: z.boolean().optional().describe("Whether this option cannot be selected."),
    }),
    render: OptionPickerOption,
  },
};
