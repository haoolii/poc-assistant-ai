"use generative";

import { defineToolkit } from "@assistant-ui/react";
import { defaultGenerativeUILibrary, JSONGenerativeUI } from "@assistant-ui/generative-ui/react";

const generative = new JSONGenerativeUI({
  library: defaultGenerativeUILibrary,
  // Return the user's input so prompt_user can complete and resume the conversation.
  actions: {
    has: () => true,
    dispatch: (action) => action.$input ?? action,
  },
});

export const PromptUserRender = generative.promptUser().render!;

export default defineToolkit({
  prompt_user: generative.promptUser(),
});
