# Changelog

## 0.4.0

- A top line with the project folder and the context window fill of the session: tokens used, the window size, a bar and the percentage, green below 70%, yellow from 70% and red from 85%.

## 0.3.1

- The task line also follows `TodoWrite`, so it shows with every model.
- The type column fits "general-purpose" without cutting it.
- The README example now matches the real layout.

## 0.3.0

- Split the code into a harness-agnostic core (`hooks/core.ts`) and a Claude Code adapter (`hooks/register.tsx`).
- Labels in English by default, Portuguese with the `language` option.
- Unit tests for the core.

## 0.2.0

- Fixed header with an agent summary bar and an orchestration task summary bar.
- Rows are cut to the pane width instead of wrapping.

## 0.1.1

- Agents that started before the plugin loaded are picked up.

## 0.1.0

- First version: live list of subagents with status, type, description, tool calls and elapsed time.
