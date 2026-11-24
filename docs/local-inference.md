# Local Inference

**From the agent to its memory, every layer lives on your machine.**

![Agents, runtimes, gateway, models and assets: the whole stack on one machine](../assets/feature-local-stack.jpg)

Claude Code, Codex and Pi run as they always do, while a local gateway points
them at models on your own machine, with Gemini CLI, OpenCode and Hermes coming
next. Your wiki, memory, sessions and files stay on your disk, and a remote
model or the subscription you already pay for joins only when you ask. One
install sets up a language model, and it stays quick even on a fanless laptop.

How agents, approvals and background work share a model is in
[Model scheduling](model-scheduling.md).

## Model source

Each computer serves all of its agents from one source at a time. Setup asks
for it, and **Settings › Models** switches it later to Local model or BYOK; it
does not offer a switch to Subscription.

| Source       | Runtime                  | Where the model runs                                                                       |
| ------------ | ------------------------ | ------------------------------------------------------------------------------------------ |
| Local model  | Pi                       | A model loaded on this computer, through the local gateway                                 |
| Subscription | Claude Code or Codex     | The plan the runtime is signed in to, with its own settings                                |
| BYOK         | Claude Code, Codex or Pi | Your own OpenAI-compatible or Anthropic endpoint, key and model, through the local gateway |

For BYOK you enter the base URL and key, and optionally a path and an
endpoint. Requests go to base URL + path + endpoint: the path defaults to
`/v1` and the endpoint to the runtime's own (`/messages` for Claude Code,
`/responses` for Codex, `/chat/completions` for Pi), and `-` leaves either one
out, so a provider under `/api/paas/v4` or a full request address pasted into
the base URL works too. The full address's ending sets the request format
(OpenAI Chat Completions, OpenAI Responses or Anthropic Messages); an address
that ends otherwise uses the runtime's own format. Nothing is probed: the refresh
button lists models at base URL + path + `/models`, with their names and
context windows, and **Test** sends one request to the full address. You type
the model ID when the endpoint lists none. BYOK needs a Computer at 0.56.0 or
later. The key stays on the computer in an owner-only file; the server never
stores or shows it. A switch moves every agent on the computer to the new runtime and
model, and leaving Local model unloads the local models to free memory. When an
agent is still working, the switch asks first and ends that work only if you
confirm.

## Web search

On Subscription, Claude Code and Codex keep their own web search, and agents
are told to use it first and `teamhub web search` and `teamhub web open` when it
fails. On Local model and BYOK the gateway cannot run that provider-hosted
search, so the computer turns it off and agents search and read pages only with
`teamhub web search` and `teamhub web open`, as Pi always does. A Claude Code
or Codex that reaches its model through an API endpoint set up in its own
configuration keeps its web tools, but agents are told to use the `teamhub web`
commands instead, since those tools may not work through that API. The
commands use the web search providers set up on the server (Tavily, Brave
Search, Firecrawl, Exa or You.com).
Without any key they search DuckDuckGo, which is free but blocks searches that
come too often; You.com also works without a key, with lower quality. Pages are
read from this computer by default. When a provider needs a key, a card in the
chat asks for it.

## Background Memory and Wiki

Memory facts and reports, Agent Memory, and personal Wiki generation use the
Runtime on the Computer where the relevant Agent is placed. On Pi, these calls
require a Computer Daemon at 0.55.0 or later and run on the same model as
Pi's own work: its default model, whether that is a local model or your own
endpoint and key. Under Local model, downloaded is not loaded; load the model
from setup or **Settings › Models**. Background Pi calls run without tools or
a saved Pi session. If Pi or its model is unavailable, they wait or fail with
a Runtime error; they never switch to Codex or Claude Code.

A Codex or Claude Code placement can still use the other ready Runtime on
that Computer. These calls use the chosen Runtime's default endpoint; if
that endpoint is remote, it receives the input needed for the task.

## Planning

The planner chooses hardware and model settings together: layer by layer, the
machine's platform, free memory and bandwidth narrow the catalog until one model,
quantization, context window and KV precision remain, and the smaller models are
packed around it.

![The same five layers on an RTX 4090 PC and a 32 GB Mac: the catalog keeps the models each platform supports, free memory sets the language model's share, only models whose weights and shared 128K KV pool fit go on, quality beats speed, and the decision and helper models are packed into what is left, so the Mac ends up with a smaller quantization and no MTP](../assets/feature-local-pick.jpg)

<!-- BEGIN GENERATED: public-tiers tiers, from llm-inference-lab docs/public-tiers.json; run scripts/public_tiers_sync.py there, do not edit here -->

| Machine                    | Model           | Quant                          | Context | Decode, tok/s                                                                          | SimplexAI  | Compares with       |
| -------------------------- | --------------- | ------------------------------ | ------- | -------------------------------------------------------------------------------------- | ---------- | ------------------- |
| Mac 16 GB                  | Spark-X2.6-4B   | Q4_K_M                         | 64K     | —                                                                                      | Not ranked | —                   |
| Mac 24 GB                  | Inkling 2 Mini  | Unsloth Dynamic 3.0 UD-IQ3_XXS | 64K     | 29.12 short; 26.15 after 8K; 22.28 after 32K; 29.89 for 2 concurrent sessions together | 53.4       | ≈ Claude Sonnet 4.6 |
| Mac 32 GB                  | Inkling 2 Mini  | Unsloth Dynamic 3.0 UD-Q4_K_M  | 128K    | —                                                                                      | 54.2       | ≈ Claude Sonnet 4.6 |
| Linux NVIDIA 8 GB + 32 GB  | Qwen3.6-35B-A3B | UD-Q3_K_M                      | 64K     | —                                                                                      | 35.8       | ≈ Claude Haiku 4.5  |
| Linux NVIDIA 12 GB + 32 GB | Qwen3.6-35B-A3B | UD-Q4_K_M                      | 64K     | —                                                                                      | 36.4       | ≈ Claude Haiku 4.5  |
| Linux NVIDIA 24 GB + 64 GB | Qwen3.8-27B†    | UD-Q4_K_M                      | 128K    | 32.5–33.2 single session at 130K; 28–41 per session with two sessions at about 8K      | 54.1       | ≈ Claude Sonnet 4.6 |

Decode speeds were measured in our lab on physical hardware for the listed tiers; tiers marked — are pending physical-device benchmarks. SimplexAI scores sit on the third-party AIHOT scale, where 50 is the reference average, and scores within 3 points count as the same level.

Test conditions:

- Mac 24 GB: Physical Apple M6 Mac mini with 24 GB unified memory (12 GPU cores); llama.cpp b12588 Metal, 64K shared window across 2 slots, q8_0 KV, exclusive run.
- Linux NVIDIA 24 GB + 64 GB: A real RTX 4090 D 24 GB card; the two sessions share one 128K window (about 8K each when both ran); llama.cpp r3 build of 2026-10-25, KV q8_0/q4_0 and q8_0/q8_0 (the ranges cover both); the two sessions overlapped only in part, so per-session numbers are approximate; not a rerun of the current installer recipe.

Not ranked (Mac 16 GB): AIHOT has no third-party results for Spark-X2.6-4B. Our own self-test: SciCode subproblems 28.2% (82/291), read on AIHOT's SciCode scale as 22.1 (12.5–30.8). Self-test, not a SimplexAI score: Q4_K_M on an M5 Ultra with 256 GiB (llama.cpp b11370, 4 sessions of 192K, not the 16 GB setup), thinking on, 16,384 output tokens per turn (25 of 65 problems hit the cap and count as failed), one pass@1; the interval covers resampling the problems only; the vendor reports 36.8% unquantized.

† Linux NVIDIA 24 GB + 64 GB: the table shows Qwen3.8-27B UD-Q4_K_M; the default recommendation for this machine is Inkling 2 Mini UD-Q4_K_M.

<!-- END GENERATED: public-tiers tiers -->

The table lists one configuration per tier, with physical-device decode speeds where
measured. For the plan setup makes on every Mac and NVIDIA tier, on Windows as well
as Linux, and the smaller model it picks when memory is busy, see
[Hardware compatibility](https://docs.heylinger.com/hardware/compatibility).

Once the plan is approved, each model counts as installed only after it answers a real question.

## Inference engines

Inference is built on PolyStrata: each token of a mixture-of-experts model uses only
a few of its experts, so the most-used ones stay next to the GPU and the rest wait
one level further away, in system RAM on a PC and on the SSD when a Mac runs out of
memory.

![On an NVIDIA PC, CUDA memory holds the most-used experts and the CPU computes the rest from system RAM at the same time; on Apple Silicon, Metal unified memory holds the model when it fits and the SSD serves the rest, with the next layer read ahead; the model can also draft a few tokens that one full pass checks](../assets/feature-local-engine.jpg)

<sub>PolyStrata is open source (MIT) and runs Qwen3.8-Flash-Next on the Strata
engine.</sub>
