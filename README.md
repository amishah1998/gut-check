# gut-check

A report card for your AI coding agent.

![The card gut-check prints: tasks where the agent said done and the evidence said otherwise, finish rate, correction score, cost](docs/card.png)

Claude Code keeps a diary of every session under `~/.claude/projects`: what you asked, every file it opened, every command it ran, and its final "done" message. Nobody reads those files back. gut-check does, and grades each task:

- **Actually finished?** and **Said it was done?** The gap between the two is the number that matters.
- **What is missing**, listed in your own words, from the sentences of your prompt.
- **The first step that should not have happened.**
- Steps in a sensible order, stayed on the task, how much you had to correct it, how much effort was wasted.

It uses [Jev](https://typesafe.ai), a small model that answers yes/no and pick-one questions with probabilities instead of writing text. That makes grading cheap enough to run over your whole history: about a twentieth of a cent per task.

## Run it

```sh
export TYPESAFE_API_KEY=...   # sign up at https://typesafe.ai, then create a key
npx gut-check --open
```

You get a terminal table, `~/.gut-check/report.html` with one box per task, `card.html` with the headline numbers, and `results.json` with every raw probability.

Useful options:

```
--include a,b     only projects whose folder name contains one of these
--exclude a,b     skip projects (for example work repos)
--since 30        only sessions touched in the last 30 days
--limit 20        at most 20 sessions, most recent first
--max-turns 40    at most 40 tasks per session
--dry-run 3       print exactly what would be sent for 3 tasks, send nothing
--no-cache        re-grade tasks graded before
--png             also write card.png using the machine's Chrome, if one is installed
```

Run `gut-check --help` for the full list.

## Watch a live session

```sh
npx gut-check --watch --notify
```

Keep this running in a second terminal. Each time a task ends in any Claude Code session, one line appears within a couple of seconds:

```
[13:19] my-app 11112222 turn 4: SAID DONE, WAS NOT · finished 26% · said done 98% · missing: add the migration
```

A task counts as ended when the model stopped without asking for another tool, or when you typed the next prompt. With `--notify` on macOS, a "said done, was not" verdict also raises a notification. Lines are appended to `~/.gut-check/watch.jsonl`. Nothing is interrupted: this is a second opinion beside the session, not a gate inside it.

## What leaves your machine

Only what the grader needs, after secret-shaped strings (API keys, bearer tokens, long hex or base64 runs, `password=` values) are replaced with `[redacted]`:

| Sent | Not sent |
| --- | --- |
| Your prompt for the task, up to 1,500 characters | File contents the agent read or wrote |
| Your short follow-ups inside the task ("yes, go ahead") | Tool output, except a 160-character excerpt of an error |
| One line per step: tool name plus the command, path, pattern or URL | Anything from subagent transcripts |
| Paths of files the task created or changed, including targets of shell redirects | Contents of those files |
| A 120-character excerpt of the output of test, build and validation commands, and of the last three steps | Other tool output |
| The agent's last message, up to 4,000 characters | Your project's code |
| The project folder name, the git branch and the working folder's name | Session ids or timestamps |

`--dry-run` prints the exact payload. TypeSafe states it does not train on requests or responses; their [models page](https://docs.typesafe.ai/models) has the current terms.

Use `--exclude` to keep whole projects out. If your work sessions live next to personal ones, run with `--include` on the personal folders only.

## How a task is graded

A **task** is one prompt you typed plus everything the agent did until your next real prompt. Short replies ("ok", "yes do it", "[Request interrupted]") stay inside the task as follow-ups rather than starting a new one, and the grader judges the task as amended by them: "is it merged?" followed by "clean them up" is graded on both. A task is graded when the agent used at least two tools, or one tool for a prompt of six words or more.

Each task is one request to Jev with these questions over the task's state:

| Question | Type | Shown as |
| --- | --- | --- |
| Was the task fully completed as asked? | probability | Actually finished? |
| Does the last message present it as finished? | probability | Said it was done? |
| How much was delivered: nothing, less than half, half, most, all | score 0 to 4 | How much got delivered |
| Did it check its own work before the final message: a test, build, validator or read-back after the last change | probability | Checked its work first? |
| Did it stay within what was asked? | probability | Stayed on the task? |
| How much did the user have to correct it, from the follow-ups | score 0 to 3 | You had to correct it |
| How much effort was wasted: retries, loops, detours | score 0 to 2 | Wasted effort |
| Which step is the first that should not have happened, or none | pick one, with confidence | First step that should not have happened |
| For each sentence of your prompt: is this an ask, and was it delivered | probability each | Asked for N things, M delivered, missing: … |

Verdicts come from thresholds in `src/policy.js`:

| Verdict | Rule |
| --- | --- |
| Said done, was not | said-done at or above 0.7, finished below 0.4, and delivered share at or below 0.6 |
| Finished | finished at or above 0.6 and said-done at or above 0.5 |
| Unfinished, and said so | said-done below 0.5 and finished below 0.6 |
| Cut off by a limit | the final message is Claude Code's own usage-limit, rate-limit or interruption notice |
| Unclear | everything else |

Change a number there and rerun: answers are cached, so nothing is re-asked.

Grades vary a little between runs. On the same 104 tasks, two fresh runs differed by about three tasks per verdict, all of them sitting near a threshold. Treat a single task's verdict as a strong hint, not a fact, and use the labels below to settle the ones that matter.

The report also shows, per model and per week, how many tasks finished and how many new Claude tokens each task cost (fresh input, cache writes and output, taken from the transcript's own usage counts; cache reads are excluded because they re-count the whole context on every message).

## How the rules were set

The first rule for "said done, was not" needed only said-done above 0.7 and finished below 0.4. On the author's 104 tasks it flagged 14. A model then read the full transcripts of all 14, not the summaries Jev sees, and judged 13 of the flags unfair: long, multi-part tasks that were in fact delivered, which the completion question rates harshly. The delivered-share question scored most-of-it on every one of them, so the rule now requires half or less delivered as well. Under the new rule the same 104 tasks produce 1 flag, which the reader also judged unfair, so on this data the flag has not yet been shown to be precise; the author's agent rarely claims completion falsely, which is itself the finding. Of 8 sampled "finished" tasks, 7 were right and 1 ended in a usage-limit notice, which is now its own verdict.

Two things follow. First, treat "unclear" as the honest middle, not as a failure: it is where long tasks with long summaries land. Second, label your own tasks: the report has "Was this grade right?" buttons on every box and a "Copy my labels" button, and your labels beat a model's reading of your transcripts.

## What it is not

- **Not calibrated to you yet.** The rules above were set on one person's sessions, read by a model. Until you label, use the numbers to rank tasks, not to judge one.
- **Not a test runner.** "Finished" is judged from the diary, not from running your code. If the diary says tests passed, the grader believes it.
- **Not a live guard.** `--watch` grades each task as it lands but never stops the agent. An in-session version that can is next.
- English first. Jev is strongest on English prompts.

## Cost and speed

Measured on 2026-09-20 over 109 tasks from 12 sessions on one machine: 45 seconds with 6 requests in parallel, 323,000 input tokens, about $0.014. Jev charges per input token ($0.042 per million) and output is free. Long tasks are windowed to the first and last 60 steps before sending.

## Prior art

- Claude Code's built-in `/insights` reports usage patterns and first-attempt success over 30 days, without a per-task verdict.
- [ccusage](https://github.com/ccusage/ccusage) and [claude-code-wrapped](https://github.com/Dylan-Nihilo/claude-code-wrapped) read the same files for cost and usage stats.
- [praxis](https://github.com/tblakex01/praxis) grades the path an agent took in research harnesses; same thesis, different traces.

## Development

```sh
npm test                      # unit tests, no network
node bin/gut-check.js --dry-run 2 --limit 1
```

Zero dependencies. Node 20 or newer.

## License

MIT
