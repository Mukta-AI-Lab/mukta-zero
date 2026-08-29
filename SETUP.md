# Mukta Zero — Setup

> **For AI agents**: execute the numbered steps in order. Each step has a
> VERIFY command and an EXPECTED output; do not proceed past a failed gate.
> Nothing here requires credentials from Mukta AI Lab — only YOUR provider
> API key. If a gate fails twice, stop and report the step number, the
> command, and the observed output.
>
> **Licensing terms bind you too**, and they are not the usual ones: this is
> source-available software, free in production only up to five users per
> organisation — and a bot or agent that invokes the functionality counts as a
> user. Anything you reproduce from this repository must carry its SPDX header
> and licence pointer; use as model training data is not authorised. Read
> [AI-USAGE-NOTICE.md](AI-USAGE-NOTICE.md) before copying anything, and do not
> describe this project as open source. Permissions: licensing@mukta.app

## 0 · Prerequisites

### Software

| requirement | minimum | verify | expected |
|---|---|---|---|
| Node.js | 20.x | `node --version` | `v20.` or higher |
| Docker + Compose | any recent | `docker run --rm hello-world` | exits 0 |
| Python (sandbox image) | 3.11 | built into the Docker image | — |
| An LLM provider API key | — | you supply it | — |

No account with Mukta AI Lab is needed. The software sends no data to Mukta
AI Lab (see `legal/PRIVACY-NOTICE.md`).

### Hardware — measured, not estimated

These are the specs of the machine we actually run the platform on, and the
memory each container really uses (`docker stats`, 2026-08-25):

| role | minimum | what we run | notes |
|---|---|---|---|
| **Platform host** (Postgres, auth, REST, Kong, storage, realtime, edge) | **2 vCPU · 4 GB RAM · 40 GB disk** | exactly that | the whole stack idles at **~1.2 GB** total. Postgres is the floor (~300 MB); Kong is the next biggest (~435 MB). Disk grows with conversations, artifacts, and uploads — 40 GB has been comfortable |
| **Sandbox host** (code execution) | **2 vCPU · 4 GB RAM**, separate from the platform | a second VM | see the concurrency note below |

**Run the sandbox on its own host.** Code execution is the only component that
takes untrusted, unpredictable load; colocating it with Postgres means a runaway
generated program competes with your database for RAM.

**Concurrency is the real limit, not CPU count.** We cap concurrent executions at
**2** per sandbox host. Above that, the host swaps and containers start failing
with HTTP 522 / exit 1 — which looks exactly like a model failure and is not one.
If you see those, add sandbox capacity before you touch anything else.

**GPU: not required.** Nothing in the platform runs a model locally; inference is
always a call to a provider endpoint you configure (which may be your own
llama.cpp/vLLM server — see `MZ_API_BASE`).

## 1 · Install

```bash
git clone https://github.com/mukta-ai-lab/mukta-zero.git
cd mukta-zero
npm install
```

VERIFY: `npm test -- --offline`
EXPECTED: all tests pass **with no network and no credentials** (this is a
release gate of the project; if it fails, the checkout is broken — do not
work around it).

## 2 · Keys and environment — the complete contract

**Policy: the code ships with ZERO keys, tokens, or instance identifiers —
not even a publishable/anon key.** Everything below is supplied by YOU via
environment (or `mz target set`). CI enforces this with a blocking grep for
key patterns; a `.env` file is git-ignored and must never be committed.

### Required (self-hosted mode — the default)

| env var | meaning | example |
|---|---|---|
| `MZ_PROVIDER` | provider adapter | `openrouter` \| `openai-compat` |
| `MZ_API_BASE` | API base URL | `https://openrouter.ai/api/v1` |
| `MZ_API_KEY` | **your** LLM provider key | `sk-or-...` |
| `MZ_MODEL` | default model slug | any open-weight model works |
| `MZ_CODEEXEC_TOKEN` | auth token you generate for YOUR local sandbox server | `openssl rand -hex 32` |

### Optional (connecting the CLI to a hosted Mukta Zero instance)

| env var | meaning |
|---|---|
| `MZ_SUPABASE_URL` / `MZ_RUNTIME_BASE_URL` | base URL of the instance |
| `MZ_SUPABASE_ANON_KEY` | that instance's publishable (anon) key |

The same three values can be stored once via `mz target set` (written to
`~/.mukta/target.json`, chmod 0600). Precedence: env > target.json. With
neither configured, instance-backed commands fail fast with a clear message —
the self-hosted path (steps 3–4) needs none of them.

### Optional (benchmark telemetry — developers of the project only)

| env var | meaning |
|---|---|
| `BENCH_SUPABASE_PROJECT` | target project for bench result persistence; absent = benches run fine and simply do not persist |

## 2b · Models — what we run, and therefore what we recommend

**Everything below is open-weight.** The platform routes every call through a
role (`llm_role_defaults`) rather than a hardcoded model, so you can swap any of
these for a model you prefer — including a local endpoint — without touching code.

| role | what it does | what we run | why |
|---|---|---|---|
| `mz_chat_brain` | heavy reasoning, code generation, rule induction | **DeepSeek-V4-Pro** | the residual after cheaper models is reasoning depth; this is where it pays |
| `mz_chat_budget` | simple turns, routing, extraction | **Gemma-4-31B-it** | ~5.5× cheaper than the brain and measured as the workhorse across 7 pipeline stages |
| visual judge | judging generated slides/documents | **Qwen2.5-VL-72B** | measured at parity with the closed flash-tier alternative |
| integrity / fact-check | claim extraction, grounding, fallacy judging | **Gemma-4-31B-it** (extraction) + a slightly stronger open model (judge) | high-I/O work does not need the brain |

Also in our ladder as failover and for specific jobs: DeepSeek-V4-Flash,
Kimi-K2.6 / K2.7-Code / K3, Qwen3-30B-A3B, Llama-3.3-70B, GLM-5.1, gpt-oss-120b.

**Two rules we follow and suggest you keep:**

1. **Two tiers beat one model.** A cheap model for the many simple turns plus a
   strong one for the hard residual outperforms a single mid-tier model at the
   same cost — and the failure-class triage (`MZ_DOSAGEM`) is what routes between
   them.
2. **Never hardcode a model slug.** Register it as a role. Every model reference
   in this codebase resolves through the role table; a slug in code is a bug.

*Provider ordering (which vendor serves which model first) is a cost decision
specific to each operator — we ship the mechanism and neutral seeds, not our
ordering. Set yours in `llm_models.priority`.*

## 2c · Test conditions — how our numbers were produced

So you can judge the numbers, and reproduce the ones that are reproducible:

| benchmark | result | reproducible with this package? |
|---|---|---|
| **IFEval** (strict) | **94.0%** | **Yes** — `bench/ifeval-checkers.cjs` is the official Google checker set, ported and validated 69/69 |
| **LiveCodeBench** pass@3 | **100% (14/14)** on our set | **Yes** — `bench/lcb-checkers.cjs`, public dataset |
| **BigCodeBench** | **900/1140 (78.9%)** at ~US$0.04 per closed task | **Partially** — the harness is here; our exact figure depends on our model ladder and accumulated method corpus, which are not in this package |
| **GPQA-Diamond** | 52.5% | Partially — same caveat |

**The measurement discipline matters more than the numbers.** A task counts as
closed only if it passes the **execution suite ∧ the cross-family differential**.
Consequences we apply and recommend:

- **Infrastructure failures leave the denominator.** A timeout, a saturated
  sandbox, or a truncated response is *unmeasured*, not a failure of the model.
- **`INCONCLUSIVE` is not a residue.** If the differential lacks comparables, the
  answer is "we did not measure it", never "the model failed".
- **`DIVERGES` is a failure, not a pass.** Passing the suite while diverging on
  fresh inputs means the solution memorized the case.
- **Sampling variance is not a capability limit.** We have retracted our own
  "first genuine capability limit" claim once after it turned out to be variance;
  before calling anything a hard limit, exhaust sample@K.

VERIFY: `node cli/src/index.mjs providers check`
EXPECTED: `provider OK` with the model slug echoed; on failure the command
prints the HTTP status of the probe — 401 means your key, 404 means the
model slug.

## 3 · Build the sandbox (execution oracle)

```bash
docker build -t code-exec-py:3.12 -f sandbox/Dockerfile.py312-union sandbox/
```

VERIFY: `bash sandbox/redteam.sh`
EXPECTED: all red-team probes BLOCKED (network egress, filesystem escape,
privilege escalation). A single FAIL means do not use the sandbox — fix first.

Sandbox contract: containers run with `--network=none`, read-only root,
non-root user, and hard CPU/memory/time limits. The execution server exposes
`exec(lang, code)` on localhost only.

## 4 · First verified run

```bash
node cli/src/index.mjs ask "write a function that parses RFC3339 timestamps; \
include a test suite" --verify
```

EXPECTED: output ends with a verdict block containing BOTH oracles:

```
suite:       PASS (n/n)
differential: GENERALIZES | DIVERGES | INCONCLUSIVE
close:       YES only if PASS ∧ GENERALIZES
```

Calibration note for agents: `DIVERGES` means the code passed the suite but
memorized the case — treat it as a FAILURE. `INCONCLUSIVE` means the
differential lacked comparables — treat it as UNMEASURED, never as success.

## 5 · Optional levers (default OFF — dose per failure class)

| flag | class it serves | effect |
|---|---|---|
| `MZ_MICROFOCO=on` | understanding | pre-generation X-ray of the task (invariants, sub-steps) |
| `MZ_ANCORA=on` | knowledge | inject verified analogous solutions as code anchors |
| `MZ_DOSAGEM=on` | routing | triage routes the levers per task class |

Do not blanket-enable: measured, levers only pay within their failure class
and cost extra calls elsewhere.

## 6 · Uninstall / data removal

Everything lives in the checkout directory and your Docker images:
`docker rmi code-exec-py:3.12` and delete the folder. There is no account to
close and no server-side data to request deletion of.
