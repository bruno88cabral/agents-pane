# Changelog

## 0.8.1

- A bar with a tiny value (2% of the 5-hour limit, say) no longer grows one cell past the others and pushes its percentage out of line.
- A screenshot in the README.

## 0.8.0

- A branch line under the name: the branch (or the short hash when HEAD is detached), changed files, commits ahead and behind the upstream, and whether the session is in a worktree. Read from git every 5 seconds.
- The usage limits in the stats table: the 5-hour and weekly windows (and a gateway spend limit), each with its reset time, a bar and the percentage, in the context colors.
- A session row: how long the session has run since it started or its last `/clear`, and its cost in dollars when the session is priced per API call.
- The header in three blocks (where, usage, activity). From 40 rows the terminal puts a blank line between every row; the desktop app and VS Code draw a small gap. Compact mode adds the branch and the 5-hour limit to its one line.

## 0.7.0

- The name is back to the big letters of 0.5.0, three rows tall.
- The bars have their colors back: context green below 70%, yellow from 70% and red from 85%; agents green for done, the accent for running and red for failed; tasks green for done and yellow for active.
- A blank line between the context and the agents rows.

## 0.6.0

- New layout. The name in letters two rows tall, then a stats table (context, agents, tasks) with fixed columns and bars of the same width, then a `── agents ──` separator.
- Agents grouped by the ticket their description names, each row keeping only what is its own.
- Rows in fixed columns: status, task, tool calls, time, `bg`; the type only when it is not `general-purpose`; a sparkline of tool calls per minute on running agents.
- Four colors at most: the accent (name and running), green, red and dim. The context bar no longer turns yellow.
- Compact mode under 12 rows, no mode or sparkline under 40 columns, and `AGENTS_PANE_ASCII=1` for fonts without block glyphs.
- The layout is a pure function (`hooks/layout.ts`) with snapshot tests.

## 0.5.0

- The pane is headed by the name of the GitHub repo, read from the `origin` remote, so it stays the same in every worktree. Without a remote it falls back to the folder.
- The name is drawn in big letters on the terminal (three rows of half blocks) and as a title on the other surfaces; it falls back to one bold line when the pane is too narrow.
- The context fill now has a line of its own, under the name.

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
