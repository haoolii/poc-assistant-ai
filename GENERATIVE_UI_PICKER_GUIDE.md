# Generative UI option picker

Use `prompt_user` to request a choice. Build this tree using nested `children`:

```text
OptionPicker
├── PickerHeader
│   ├── Header
│   └── Text
├── PickerCarousel
│   └── PickerCard (display only; repeat as needed)
└── PickerOptions
    └── PickerOption (selectable; repeat as needed)
```

`Header`, `Text`, and `Caption` use the `text` property. Carousel cards are informational and cannot be selected; don't put interactive controls inside them. Put each choice in a `PickerOption` directly under `PickerOptions`. Every option requires a visible `label` and unique, non-empty `value`; optional `disabled` makes an option unavailable. Clicking an option returns its value through `prompt_user` and completes the interaction.

For display-only content with no interaction, use `present` instead. The current library is custom; only registered components are available. Composition descriptions guide the model; they do not validate the entire tree or enforce unique values at runtime.

## Example

```json
{
  "_type": "OptionPicker",
  "children": [
    { "_type": "PickerHeader", "children": [
      { "_type": "Header", "text": "晚餐吃什麼？" },
      { "_type": "Text", "text": "先看看推薦，再選擇一個選項。" }
    ] },
    { "_type": "PickerCarousel", "children": [
      { "_type": "PickerCard", "children": { "_type": "Text", "text": "便當：快速又方便" } },
      { "_type": "PickerCard", "children": { "_type": "Text", "text": "麵食：溫暖又飽足" } },
      { "_type": "PickerCard", "children": { "_type": "Text", "text": "沙拉：清爽的選擇" } }
    ] },
    { "_type": "PickerOptions", "children": [
      { "_type": "PickerOption", "label": "便當", "value": "bento" },
      { "_type": "PickerOption", "label": "麵食", "value": "noodles" },
      { "_type": "PickerOption", "label": "沙拉", "value": "salad" },
      { "_type": "PickerOption", "label": "幫我決定", "value": "surprise" }
    ] }
  ]
}
```
