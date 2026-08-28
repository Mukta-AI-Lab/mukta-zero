<!-- DRAFT do README público (2026-08-25). Vira o README.md do repo mukta-ai-lab/mukta-zero
     no commit inaugural (fase F3). Escrito "AI-agent-ready": seções com contratos explícitos,
     comandos determinísticos e saídas esperadas — ver também SETUP.md. -->

# Mukta Zero

**An autonomous code-and-reasoning agent that does not trust itself.**

Every result must survive **two independent oracles**: the execution suite
(*does the code run?*) and the cross-family differential (*does it generalize,
or did it memorize the case?*). Passing one without the other is not a close.
We publish our negative results with the same rigor as the positive ones.

## Why this exists

Most agent frameworks measure themselves by "the code passed the tests".
Measured on real benchmarks, a large share of apparent failures are not model
capability at all — they are failures of the **measuring apparatus**. Mukta
Zero is built around that finding:

- **Two independent oracles** — execution ∧ generality; a solution that passes
  the suite but diverges on fresh inputs is flagged as memorization, not
  success.
- **Failure-class triage** — apparatus · understanding · knowledge ·
  non-determinism · transport, each with its own lever; levers are routed per
  class (dosing), never blanket-enabled.
- **Verification-by-execution sandbox** — hardened, network-less containers;
  red-teamed.
- **Honest accounting** — infrastructure failures leave the denominator;
  inconclusive is not residue; provenance travels with every result.

## What is in the box

Mukta Zero is a **self-hostable platform**, not a library: you bring a machine, a
Docker daemon and your own LLM provider key, and you get the agent, its web
interface, its CLI, and the control surfaces around them.

| dir | what |
|---|---|
| `deploy/` | the stack: Postgres, auth, REST, gateway, storage, realtime and the edge runtime — `docker compose up` plus the 17 variables in `env.example` |
| `server/` | the agent itself (chat with tools, memory and RAG), plus workflows, missions, documents, deep research, webhooks and CLI auth — 13 functions and the SQL schema in apply order |
| `web/` | the interface: chat, projects, workspaces (rules, members, keys, shared memory), missions and plan, control tower, observability and failures, model and provider settings (BYOK), quota |
| `cli/` | the `mz` CLI and its single-window TUI |
| `vscode/` | VS Code extension (source) |
| `sandbox/` | code-execution server + hardened Docker images + red-team suite |
| `engine/` | the verification core as standalone modules: failure-class triage and dosing, the **generality differential** (N independent solutions, fresh inputs, agreement as the oracle), rule induction (ARC-style), refusal gate |
| `bench/` | reproducible checkers (IFEval — official checkers ported and validated 69/69; LiveCodeBench; ARC) |

**Multi-tenant from the start.** Quota is per user, an admin allocates it, and the
same budget ceilings are what stop an autonomous loop from running away. What is
*not* here is the paid top-up: billing a credit card is ours to run, not yours.

**What is deliberately not included**: the trained no-LLM engine (the nano
specialists and the accumulated corpus of verified solutions) and the hosted
service. The agent works without them; they are what make our instance cheap.

## Quickstart

**Before you run it**, replace the placeholders with your own values: the complete list —
what each one means and where it is read — is in **[PLACEHOLDERS.md](PLACEHOLDERS.md)**.
This distribution contains no address, key, or identifier belonging to whoever published it.

See **[SETUP.md](SETUP.md)** — written to be executable by a human or by an
AI agent (deterministic steps, expected outputs, machine-checkable gates).

**Keys**: the code ships with zero keys or instance identifiers. To run you
supply exactly one secret of your own — your LLM provider API key
(`MZ_API_KEY`) — plus a self-generated sandbox token (`MZ_CODEEXEC_TOKEN`).
The full environment contract is in [SETUP.md §2](SETUP.md).

## How this was built

Mukta Zero was written with heavy use of AI coding tools — several of them, over many
months. We say so plainly because it is true, and because it is the point rather than a
caveat: this project exists to find out what an AI-built system can be trusted to do, and
the answer we arrived at is *whatever survives independent verification*.

So nothing here is trusted because a model wrote it. Every closed task had to pass the
execution suite **and** generalize on the cross-family differential; the negative results in
`docs/` are the ones that did not. The architecture, the verification protocol, the
selection of what to keep, and the decision of what counts as a result are human work, and
the responsibility for all of it is ours.

Direction, architecture, and review: Herbert Möller, for Mukta Soluções em Informática Ltda.

## License — read this before production use

Mukta Zero is **source-available**, not OSI open source:

- **Free** for any organization with **up to 5 users**, under the
  [Business Source License 1.1](LICENSE.md) Additional Use Grant,
  conditioned on the [Acceptable Use Policy](ACCEPTABLE-USE-POLICY.md).
- **More than 5 users, or embedding in commercial offerings** → 
  [commercial license](COMMERCIAL-LICENSE.md).
- **Share-alike**: forks and derivatives remain under this same license with
  the same parameters. Each version converts to **AGPL-3.0** four years after
  its release.
- Every source file carries an SPDX header; CI enforces it (REUSE).
- FAQ: *"We are 4 people at a company — can we use it?"* Yes, free.
  *"We are 20?"* Commercial license. *"Can I fork and relicense?"* No.
- The "Mukta Zero" name and logo are not covered by the code license.

Misuse — of the software, its components, or derivatives — is prohibited by
the [AUP](ACCEPTABLE-USE-POLICY.md) and terminates the license.
[Terms of Use](TERMS-OF-USE.md) · [Privacy Notice](PRIVACY-NOTICE.md)
(short version: the software sends nothing to us).

## Support the lab

Personal use, research, education: consider supporting the lab —
**[support.mukta.app](https://support.mukta.app)** 💛
(Donations fund open research; they are not a commercial license.)

## Contributing

PRs require a signed CLA (see `CONTRIBUTING.md`). Until the CLA bot is armed,
external PRs will be closed with a polite note.
