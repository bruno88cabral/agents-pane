# agents-pane

A live pane for Claude Code that shows every subagent working in your session.

When you run long orchestrations with many subagents in the background, it is hard to know what is going on. `/tasks` gives you a raw list. **agents-pane** gives you a dashboard: who is running, who is done, how long each one took, and how far the orchestration plan has come.

<!-- Record a short GIF of the pane during a real orchestration and save it as docs/demo.gif -->
![agents-pane demo](docs/demo.gif)

## Features

- **Live list of subagents**: status, type, task description, tool calls and elapsed time for each one. Background agents are marked with `bg`.
- **Agent summary with a bar**: running, done and failed, in proportion, always on top.
- **Orchestration summary**: when Claude uses a task list (`TaskCreate` / `TaskUpdate`), the pane also shows how many tasks are still to start, in progress and done.
- **Fixed header**: the summary stays visible while you scroll the list.
- **Catches up**: agents that started before the plugin loaded (or before a `/reload-plugins`) are picked up too.
- **English and Portuguese** labels.
- **Works on every Claude Code surface**: terminal, desktop app and VS Code.

```
Agents  ● 2 running  ✓ 9 done  · 11 total
 ██████████████████████████████████████████████
Tasks  ○ 3 to start  ◐ 2 in progress  ✓ 9 done  · 14 total
 ░░░░░░░░░░████████████████████████████████████
──────────────────────────────────────────────────
✓ general-purpose Implement E1: core model             42t  12m05   bg
✓ general-purpose Review E1: core model                 9t   1m18   bg
● general-purpose Implement E2: task list summary      17t   3m40   bg
● Explore         Find all places that read state       6t     52s
```

## Install

In a Claude Code session:

```
/plugin install agents-pane --marketplace bruno88cabral/agents-pane
```

Answer `y` to add the marketplace and choose the **user** scope, so the pane works in all your projects.

From a shell, the same thing:

```bash
claude plugin install agents-pane --marketplace bruno88cabral/agents-pane
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `bruno88cabral/agents-pane`, then **Add plugin**.

**Requirements:** a Claude Code version with hooks modules (tested on 2.1.301).

## Usage

Run `/agents-pane` to open the pane.

On a wide terminal (144 columns or more) the pane also opens by itself when a session starts. On a narrower terminal Claude Code only shows panes you ask for, so use the command.

To try it, ask Claude for something that runs agents in parallel, for example: *"explore this repo with 3 subagents in parallel and summarize the architecture"*.

## Configuration

| Option     | Values          | Default |
| ---------- | --------------- | ------- |
| `language` | `en`, `pt-BR`   | `en`    |

Change it in the Claude Code config menu (`/config`), under **agents-pane**.

## How it works

The plugin is a Claude Code hooks module. It listens to a few engine events and keeps a small state per session:

| Event                         | What the pane does with it                              |
| ----------------------------- | ------------------------------------------------------- |
| `agent.spawn`                 | Adds a row with type, description, model and start time |
| `tool.call` inside an agent   | Counts one tool call for that agent                     |
| `SubagentStop`                | Marks the agent as done and stops its clock             |
| `tool.call` on `Agent`        | Marks the agent as failed when the call errors          |
| `TaskCreate` / `TaskUpdate` / `TaskList` | Keeps the orchestration task list in sync    |
| `$.agent.list()` every second | Shows finer live states (waiting, idle) and adopts agents it has not seen yet |

The plugin never changes what Claude does. Every hook passes the event on untouched, and if a hook fails it is skipped.

### Project layout

```
.claude-plugin/
  plugin.json         manifest and the language option
  marketplace.json    makes this repo installable with one line
hooks/
  core.ts             harness-agnostic model, reducers and layout math
  register.tsx        Claude Code adapter: events in, pane out
  *.test.ts(x)        tests for both
types/
  index.d.ts          data model and state contract
```

`core.ts` does not know about Claude Code. All counting, bar widths, column widths, time formatting and labels live there. `register.tsx` only turns Claude Code events into calls to the core and draws the result. This split is on purpose: support for other agent harnesses would be a new adapter on top of the same core.

## Known limits

- **Agents adopted late** (started before the plugin loaded) show elapsed time from the moment the pane saw them, and their tool calls count from zero. The engine does not expose the real start time.
- **Organizations with managed settings**: there, `SubagentStop` hooks only run for plugins the organization lists. Agents still show, but may stay as running until the live list reports them as done.
- Hooks modules are an **early access** API in Claude Code, so a future release may break something. Issues are welcome.

## Development

```bash
git clone https://github.com/bruno88cabral/agents-pane
cd agents-pane

claude plugin validate .      # checks manifest, hooks and state contract
claude plugin test .          # runs hooks/*.test.ts(x) against the engine
claude --plugin-dir .         # runs a session with the plugin, reloads on save
```

For type checking, run `claude --plugin-dir .` once so Claude Code writes its types into `.claude-plugin/types/`, then `tsc -p .`.

## Roadmap

- [ ] Open an agent's transcript from its row
- [ ] Token usage per agent
- [ ] Donut chart on the desktop surface
- [ ] Adapters for other agent harnesses (Codex CLI, OpenCode, ...)

## License

[MIT](LICENSE) © Bruno Cabral
