#!/usr/bin/env bash
# Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
# SPDX-License-Identifier: BUSL-1.1
#
# Use of this software is governed by the Business Source License 1.1
# included in the repository LICENSE file. Change License: AGPL-3.0-only
# Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
# Mukta Zero — code-exec B: runner de EXECUÇÃO ISOLADA (sandbox local na instância).
# Roda código não-confiável num container Docker EFÊMERO ENDURECIDO. Deploy em /opt/mukta-zero-zero/sandbox/run.sh.
#
# Uso: run.sh <python|node> <arquivo-de-codigo> [timeout_s]
# Saída: JSON {exit, timed_out, stdout, stderr} em stdout (stdout/stderr do código truncados).
#
# ENDURECIMENTO (lições do red-team G3 + smoke it.67):
#  - --network=none            → sem rede (exfiltração impossível)
#  - --user 65534:65534        → nobody, sem root
#  - --read-only + tmpfs       → FS imutável; escrita só em /tmp e /work (limitados)
#  - --memory/--pids/--cpus    → teto de recursos (OOM mata bomba de memória)
#  - --cap-drop=ALL + no-new-privileges → sem capabilities, sem escalar privilégio
#  - código montado :ro        → o programa não altera o próprio código
#  - TIMEOUT HOST-ENFORCED via `docker kill` (NÃO `timeout` no CLI, que orfana o container)
#  - reaper: docker rm -f no fim, sempre (trap)
set -uo pipefail

LANG="${1:-}"; CODEFILE="${2:-}"; TIMEOUT="${3:-10}"
[[ "$TIMEOUT" =~ ^[0-9]+$ ]] || TIMEOUT=10
if [ "$TIMEOUT" -gt 30 ]; then TIMEOUT=30; fi   # teto duro

case "$LANG" in
  python) IMG="python:3.11-alpine"; RUN="python3 /work/code" ;;
  node)   IMG="node:20-alpine";     RUN="node /work/code" ;;
  *) echo '{"error":"lang invalida (use python|node)"}'; exit 2 ;;
esac
if [ ! -f "$CODEFILE" ]; then echo '{"error":"arquivo de codigo nao encontrado"}'; exit 2; fi

OUT=$(mktemp); ERRF=$(mktemp)
NAME="mzexec-$$-${RANDOM}"

# reaper: remove o container (por NOME) em qualquer saída
trap 'docker rm -f "$NAME" >/dev/null 2>&1; rm -f "$OUT" "$ERRF"' EXIT

# killer host-enforced: mata o CONTAINER (por nome) após TIMEOUT — NÃO o cliente docker (que orfanaria)
( sleep "$TIMEOUT"; docker kill "$NAME" >/dev/null 2>&1 ) & KILLER=$!

# docker run atacha stdout/stderr por padrão; o código é injetado via stdin (cat > /work/code),
# evitando shell-escaping do código. Captura stdout/stderr; EXIT é o código do container.
docker run --name "$NAME" --rm -i \
  --network=none --user 65534:65534 --read-only \
  --tmpfs /tmp:size=64m,exec,mode=1777 --tmpfs /work:size=8m,exec,mode=1777 \
  --memory=256m --memory-swap=256m --pids-limit=128 --cpus=1 \
  --cap-drop=ALL --security-opt=no-new-privileges \
  "$IMG" sh -c "cat > /work/code && $RUN" < "$CODEFILE" > "$OUT" 2> "$ERRF"
EXIT=$?
kill "$KILLER" >/dev/null 2>&1

# exit 137 = SIGKILL (docker kill do timeout) → timed_out
TIMED_OUT=false
if [ "$EXIT" -eq 137 ]; then TIMED_OUT=true; fi

# emite JSON. Escaper independente de host (sed): trunca 8000 chars, escapa \ " tab, colapsa
# newlines em \n e envolve em aspas. (Sem dependência de python3/jq no host da VM.)
esc() {
  head -c 8000 "$1" \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/\\t/g' -e 's/\r//g' \
    | sed ':a;N;$!ba;s/\n/\\n/g' \
    | sed 's/^/"/; s/$/"/'
}
S=$(esc "$OUT"); E=$(esc "$ERRF")
[ -z "$S" ] && S='""'; [ -z "$E" ] && E='""'
printf '{"exit":%d,"timed_out":%s,"stdout":%s,"stderr":%s}\n' "$EXIT" "$TIMED_OUT" "$S" "$E"
