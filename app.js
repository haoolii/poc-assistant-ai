const fs = require("node:fs");

async function main() {
  const response = await fetch(
    "https://r.assistant-ui.com/base/generative-ui-style.json"
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const registry = await response.json();

  const rules = Object.entries(registry.css)
    .map(([selector, declarations]) => {
      const body = Object.entries(declarations)
        .map(([property, value]) => `  ${property}: ${value};`)
        .join("\n");

      return `${selector} {\n${body}\n}`;
    })
    .join("\n\n");

  const variables = (values, selector) =>
    `${selector} {\n${Object.entries(values)
      .map(([key, value]) => `  ${key}: ${value};`)
      .join("\n")}\n}`;

  fs.writeFileSync(
    "generative-ui.css",
    [
      variables(registry.cssVars.light, ":root"),
      variables(registry.cssVars.dark, ".dark"),
      rules,
    ].join("\n\n")
  );
}

main().catch(console.error);