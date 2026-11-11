# Changelog

## 0.13.0

- **Matrix view**: agents whose descriptions name a ticket are drawn as a matrix of tickets (rows) by stages (columns), the stages read from the start of the description (`Refinar`, `Fatiar`, no setup). A cell is `✓ 5m41 · 28t`, `✓ 6m51 ↻1 · 28t` when it recovered on a retry, `● 2m08` running, `◐ aguardando · 4m` waiting, `✗ falha · r` open failure or `· na fila` when the ticket has not reached that stage. The attempts of one stage are one cell, so the old `✗ 0t 0s` rows are gone. Tickets that need you come first; each row has a total. Agents with no ticket are listed under the matrix. The matrix needs 16 columns per stage; narrower, or with no ticket anywhere, the list stays.
- **One-line header**: name, branch, mini meters for context, 5h and week, and the session. The meters give up their bars, then the session time, when the pane is narrow.
- **State strip**: a line above the header, green when nothing needs you, yellow while an agent waits, red when a limit is over 85%, with `limite 5h em 91% · reseta em 22m`.
- **Bar of tickets**: one block per ticket, in the color of its state (ready, waiting, failed, running), and `3 de 5 tickets prontos`.
- **Attention banner**, only while an agent waits: the ticket, the agent, what it did last (`parado depois de Bash`) and how long it has waited. The engine does not say why an agent waits; the last tool it called is the closest thing it gives.
- **Keys** with the keyboard in the pane: the arrows move between cells, `⏎` opens the agent in the main view (with no cell under the ring, the agent waiting longest, else the first open failure), `r` copies a retry request for the failed cell, `v` switches between the matrix and the list. The list's separator offers `v` when the matrix can be drawn.
- Retry copies a request to paste to the orchestrator instead of relaunching: an agent a plugin starts answers to the plugin, not to the orchestrator that asked for the work.
- The context and limit colors change at 60% (was 70%): green below 60%, yellow from 60%, red from 85%.
- An agent the engine does not list is no longer taken as waiting for you: it stays a still `◐` in its cell and never makes the banner or the yellow strip.

## 0.12.0

- The agents counts moved from beside the bar to under it, one row per state with the counts lined up: running, waiting, idle, failed, success, and done (failed and success together). Every state shows, zero or not, so the rows stay in place. In pt-BR: rodando, aguardando, ociosos, falhos, com sucesso, finalizados.
- The rows stay together under the bar, with no blank line between them, even from 40 rows.
- The full header is 6 rows taller, so the pane turns compact under 18 rows (was 12), and on the terminal when the list would get under 5 rows, as before. Compact mode keeps its one line.

## 0.11.0

- The agents row counts waiting agents apart: `● 0 running  ◐ 1 waiting`, on the full header and in compact mode (`aguardando` in pt-BR). A waiting agent is held, on background work it owns (a test suite, a visual check), a plan's approval or an Agent call, and shows the still `◐` in its row. It stays in the accent part of the bar, with the running ones.
- An agent the engine does not list (yet to be lost) counts as waiting too, as its still `◐` already said.

## 0.10.3

- An agent the pane closed (`✓` or `✗`) that the engine lists as live again shows and counts as running: one waiting on background work it owns after its turn ended (a test suite, a visual check), or resumed by a message under the same id. The stored row reopens too, its clock running from its start.
- A ticket in brackets, `Review Task 6 (MYK-1169)`, or with siblings, `MYK-1161/1162`, no longer leaves a stray `(`, `)` or `/1162` in the row or the group header.

## 0.10.2

- An agent the engine does not list is lost after 5 minutes without a tool call, not only when it never called one. Agents stopped after a call or two (before 0.10.1 watched `TaskStop`) no longer stay `◐` and running. Their clock stops at their last call.

## 0.10.1

- An agent stopped with `TaskStop` no longer stays `◐` and counts as running forever: it shows `✗` and counts as failed. A stopped agent gets no `SubagentStop`, so the pane now watches `TaskStop` itself.
- When the engine lists an agent as completed, failed or killed, the pane keeps that end, even after the engine stops listing the agent.
- An agent the engine does not list, with no tool calls, more than 5 minutes after it started, has ended unseen: it shows `✗` with `0s` and no longer counts as running. An unlisted agent that calls tools (a workflow's) stays live as before.

## 0.10.0

- Idle agents, done with their turn but kept alive with their context, are no longer counted as running. They show a dim `○` (`-` in ASCII), their own dim segment in the agents bar and `○ 1 idle` after the running count, on the full header and in compact mode.
- An agent the engine no longer lists keeps the still `◐` and counts as running, as before, but is no longer called idle: only the engine says an agent is idle.

## 0.9.0

- While an agent is running, the Claude mascot runs across the free space right of the name on the terminal, hopping on the way and blinking now and then. It takes no row of its own and stays out in compact mode, in a narrow pane or beside a long name.
- A running agent's status on the terminal is a spiral going through the colors of the rainbow, each row from its own color. With `AGENTS_PANE_ASCII=1` it turns as `| / - \` in one color.
- The pane redraws five times a second only while the engine lists an agent as running. Waiting and idle agents keep the still `◐`, so does one the engine no longer lists, and the desktop app and VS Code stay still.

## 0.8.2

- On the terminal the header no longer moves while the list scrolls: the pane draws only the rows that fit under it, and the engine's window stays put.
- A pane short on rows no longer gets stuck showing only the header: when the full header would leave the list under 5 rows, the terminal turns compact.
- PgUp and PgDn move one page of the list, and Home and End go to its ends.

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
