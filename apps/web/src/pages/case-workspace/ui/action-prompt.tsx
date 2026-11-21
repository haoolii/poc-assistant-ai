import { useAuiState } from "@assistant-ui/react";
import { useRef, useState } from "react";
import { z } from "zod";

const actionPromptProperties = z.object({
  title: z.string().describe("Main heading displayed above the actions."),
  subtitle: z.string().optional().describe("Optional supporting text below the heading."),
  description: z.string().optional().describe("Optional details explaining the available actions."),
  actions: z.array(z.object({
    label: z.string().min(1).describe("Text shown on the action button."),
    value: z.string().min(1).describe("Unique value returned when this action is selected."),
  })).min(1).describe("One or more action buttons. Each action must have a distinct value."),
});

type ActionPromptProps = z.infer<typeof actionPromptProperties> & {
  $action?: { type: string; [key: string]: unknown };
  $dispatch?: (action: { type: string; [key: string]: unknown }) => unknown;
};

function ActionPrompt({ title, subtitle, description, actions, $action, $dispatch }: ActionPromptProps) {
  const result = useAuiState((state) => state.optional.part?.type === "tool-call" ? state.optional.part.result : undefined);
  const [selected, setSelected] = useState<string | null>(null);
  const submitted = useRef(false);
  const selectedValue = typeof result === "string" ? result : selected;

  function select(value: string) {
    if (submitted.current || selectedValue !== null || !$dispatch) return;
    submitted.current = true;
    setSelected(value);
    $dispatch({ ...$action, type: $action?.type ?? "select_action", $input: value });
  }

  return (
    <section className="action-prompt">
      <header className="action-prompt-header">
        <h3 className="action-prompt-title">{title}</h3>
        {subtitle && <span>{subtitle}</span>}
      </header>
      {description && <p className="action-prompt-description">{description}</p>}
      <div className="action-prompt-actions">
        {Array.isArray(actions) && actions.map((action, index) => {
          if (!action || typeof action.label !== "string" || typeof action.value !== "string" || !action.value) return null;
          return (
            <button
              key={`${action.value}-${index}`}
              type="button"
              className="action-prompt-button"
              aria-pressed={selectedValue === action.value}
              disabled={!$dispatch || selectedValue !== null}
              onClick={() => select(action.value)}
            >
              {action.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export const actionPromptComponents = {
  ActionPrompt: {
    description: "An interactive prompt for choosing one action, such as confirming or declining, acknowledging a message, or choosing a next step. Use as the root of prompt_user, not present. Provide title and one or more actions; subtitle and description are optional. Each action has a visible label and a unique value. Buttons appear in the given order; clicking one immediately returns its value and completes prompt_user. Do not put interactive children inside it or assume there must be exactly two actions.",
    properties: actionPromptProperties,
    render: ActionPrompt,
  },
};
