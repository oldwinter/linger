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

For BYOK you enter only the URL and key, then pick a model from the ones the
endpoint lists, with their names and context windows; you type the model ID
when the endpoint lists none. The computer finds which API format the endpoint
answers, trying the runtime's own format first so the gateway passes its
requests through unchanged. A gateway that serves OpenAI under `/v1` and
Anthropic under `/anthropic` on one host works from either address. The key stays on the computer in
an owner-only file; the server never stores or shows it. A switch moves every agent on the computer to the new runtime and
model, and leaving Local model unloads the local models to free memory. When an
agent is still working, the switch asks first and ends that work only if you
confirm.

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

| Machine                    | Model               | Quant        | Context | Decode, tok/s                                                                                                       | SimplexAI  | Compares with       |
| -------------------------- | ------------------- | ------------ | ------- | ------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------- |
| Mac 16 GB                  | Spark-X2.6-4B       | Q4_K_M       | 64K     | 32.99–37.24 for the slower of two concurrent sessions with short prompts; 24.61–26.23 after one 56,978-token prompt | Not ranked | —                   |
| Mac 24 GB                  | Qwen3.8-27B         | UD-IQ3_S     | 64K     | 46.06 single session (median of 3); 48.43 for 2 sessions together                                                   | 51.9       | ≈ Claude Opus 4.5   |
| Mac 32 GB                  | Qwen3.8-27B         | UD-Q4_K_M    | 128K    | 45.44 single session (median of 3)                                                                                  | 54.0       | ≈ Claude Sonnet 4.6 |
| Linux NVIDIA 8 GB + 32 GB  | Qwen3.6-35B-A3B     | UD-Q3_K_M    | 64K     | 121–146 short; 88–103 after a 62K prompt                                                                            | 35.4       | ≈ Gemini 2.5 Pro    |
| Linux NVIDIA 12 GB + 32 GB | Qwen3.8-Flash-Next† | GSQ-RCO Q2_0 | 64K     | 21.3 short (19.8–25.4); 34.1 after a 62K prompt (12.0–37.3), first token after about 3 minutes                      | 57.3       | ≈ Claude Opus 4.6   |
| Linux NVIDIA 24 GB + 64 GB | Qwen3.8-27B         | UD-Q4_K_M    | 128K    | 32.5–33.2 single session at 130K; 28–41 per session with two sessions at about 8K                                   | 54.0       | ≈ Claude Sonnet 4.6 |

Decode speeds were measured in our lab, mostly on a simulated tier (a larger card held to the tier's memory budget, or a larger Mac planned as the tier), so a real machine of the tier can be slower. SimplexAI scores sit on the third-party AIHOT scale, where 50 is the reference average, and scores within 3 points count as the same level.

Test conditions:

- Mac 16 GB: An Apple M6 Mac mini with 24 GB of unified memory, not a 16 GB machine. llama.cpp b12167 Metal with q8_0 KV, a 64K window shared by two slots, and the RAM prompt cache disabled.
- Mac 24 GB: Simulated 24 GB tier on an M5 Ultra with 256 GB: only the planner's memory figures were lowered, the physical memory and page cache were not; installed with a 128K window shared by two sessions, KV q4_0, short prompts; the installer now plans 64K; the chips in common 24 GB Macs are much slower.
- Mac 32 GB: Short prompts on an M5 Ultra with 256 GB, using the 48 GB tier's setup (200K window, two sessions, KV q8_0); the 32 GB setup (128K, KV q4_0) is not measured yet; common 32 GB Macs are slower.
- Linux NVIDIA 8 GB + 32 GB: Simulated: a 96 GB card limited to an 8 GB budget, memory capped at 28 GB for a 32 GB machine; strata-poly poly.7, one request per start; not a real 8 GB card.
- Linux NVIDIA 12 GB + 32 GB: Simulated: a 96 GB card limited to a 12 GB budget, memory capped at 28 GB; Strata pages the experts from the model file; 3 requests from one start; not a real 12 GB card.
- Linux NVIDIA 24 GB + 64 GB: A real RTX 4090 D 24 GB card; the two sessions share one 128K window (about 8K each when both ran); llama.cpp r3 build of 2026-10-25, KV q8_0/q4_0 and q8_0/q8_0 (the ranges cover both); the two sessions overlapped only in part, so per-session numbers are approximate; not a rerun of the current installer recipe.

Not ranked (Mac 16 GB): AIHOT has no third-party results for Spark-X2.6-4B. Our own self-test: SciCode subproblems 28.2% (82/291), read on AIHOT's SciCode scale as 22.1 (12.5–30.8). Self-test, not a SimplexAI score: Q4_K_M on an M5 Ultra with 256 GiB (llama.cpp b11370, 4 sessions of 192K, not the 16 GB setup), thinking on, 16,384 output tokens per turn (25 of 65 problems hit the cap and count as failed), one pass@1; the interval covers resampling the problems only; the vendor reports 36.8% unquantized.

† Linux NVIDIA 12 GB + 32 GB: the table shows Qwen3.8-Flash-Next GSQ-RCO Q2_0; the default recommendation for this machine is Qwen3.6-35B-A3B UD-Q4_K_M.

<!-- END GENERATED: public-tiers tiers -->

The table lists measured configurations. For the plan setup makes on every Mac and
NVIDIA tier, on Windows as well as Linux, and the smaller model it picks when
memory is busy, see [Hardware compatibility](https://docs.heylinger.com/hardware/compatibility).

Once the plan is approved, each model counts as installed only after it answers a real question.

## Inference engines

Inference is built on PolyStrata: each token of a mixture-of-experts model uses only
a few of its experts, so the most-used ones stay next to the GPU and the rest wait
one level further away, in system RAM on a PC and on the SSD when a Mac runs out of
memory.

![On an NVIDIA PC, CUDA memory holds the most-used experts and the CPU computes the rest from system RAM at the same time; on Apple Silicon, Metal unified memory holds the model when it fits and the SSD serves the rest, with the next layer read ahead; the model can also draft a few tokens that one full pass checks](../assets/feature-local-engine.jpg)

<sub>PolyStrata is open source (MIT) and runs Qwen3.8-Flash-Next on the Strata
engine.</sub>
