"use generative";

import { defineToolkit } from "@assistant-ui/react";
import { JSONGenerativeUI } from "@assistant-ui/generative-ui/react";
import { optionPickerComponents } from "./option-picker";
import { actionPromptComponents } from "./action-prompt";

const generative = new JSONGenerativeUI({
  library: { ...optionPickerComponents, ...actionPromptComponents },
  actions: {
    has: () => true,
    dispatch: (action) => action.$input ?? action,
  },
});

export default defineToolkit({
  present: generative.present({ display: "standalone" }),
  prompt_user: generative.promptUser(),
});
