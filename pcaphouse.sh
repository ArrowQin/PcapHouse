#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# PcapHouse — dev-stack control script.
#
# Manages the FastAPI backend (uvicorn on :8000) and the Vite dev server
# (on :5173) as a pair. Commands: start | stop | restart | status |
# db-clear | db-init | db-reset.
#
# Usage:
#   ./pcaphouse.sh start              # start both (backend + frontend)
#   ./pcaphouse.sh start backend      # start backend only
#   ./pcaphouse.sh start frontend     # start frontend only
#   sudo ./pcaphouse.sh start backend # start backend as root (needed by the
#                                     # pcap generator: creates lo0 aliases
#                                     # and runs tcpdump without a password)
#   ./pcaphouse.sh stop [backend|frontend]
#   ./pcaphouse.sh restart [backend|frontend]
#   ./pcaphouse.sh status
#   ./pcaphouse.sh db-clear           # wipe sqlite db + uploaded pcaps
#   ./pcaphouse.sh db-init            # create schema (starts backend once)
#   ./pcaphouse.sh db-reset           # db-clear + db-init
#
# State lives under ./.run:
#   .run/backend.pid     .run/backend.log
#   .run/frontend.pid    .run/frontend.log
# -----------------------------------------------------------------------------

set -u

# Resolve script directory, so the script works no matter where it's called from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RUN_DIR="$SCRIPT_DIR/.run"
mkdir -p "$RUN_DIR"

BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

BACKEND_PORT=8000
FRONTEND_PORT=5173

BACKEND_PID_FILE="$RUN_DIR/backend.pid"
BACKEND_LOG_FILE="$RUN_DIR/backend.log"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
FRONTEND_LOG_FILE="$RUN_DIR/frontend.log"

# --- Pretty output --------------------------------------------------------
if [[ -t 1 ]]; then
    C_RESET="\033[0m"
    C_RED="\033[31m"
    C_GREEN="\033[32m"
    C_YELLOW="\033[33m"
    C_BLUE="\033[34m"
    C_BOLD="\033[1m"
else
    C_RESET=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_BOLD=""
fi

info()  { printf "${C_BLUE}[*]${C_RESET} %s\n" "$*"; }
ok()    { printf "${C_GREEN}[+]${C_RESET} %s\n" "$*"; }
warn()  { printf "${C_YELLOW}[!]${C_RESET} %s\n" "$*"; }
err()   { printf "${C_RED}[x]${C_RESET} %s\n" "$*" >&2; }

# --- Helpers --------------------------------------------------------------

# Read a PID from a pidfile; echo it only if the process is alive.
# Returns non-zero when nothing is running.
read_alive_pid() {
    local pidfile="$1"
    [[ -f "$pidfile" ]] || return 1
    local pid
    pid="$(cat "$pidfile" 2>/dev/null | tr -d '[:space:]')"
    [[ -n "$pid" ]] || return 1
    if kill -0 "$pid" 2>/dev/null; then
        echo "$pid"
        return 0
    fi
    return 1
}

# Detect the PID actually bound to a TCP port (fallback when pidfile is
# missing/stale — e.g. someone started the server directly). macOS & Linux.
port_pid() {
    local port="$1"
    if command -v lsof >/dev/null 2>&1; then
        lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n1
    fi
}

# Send SIGTERM → wait up to 10s → SIGKILL. Works for a whole process group
# when a negative pid is given, which is what we want for `npm run dev`
# (node spawns vite as a child that also needs to die).
#
# If the target pid is owned by root (e.g. backend started via sudo) and the
# current user is not root, silently escalate via sudo so stop/restart still
# works for the same user who started it.
kill_tree() {
    local pid="$1"
    [[ -n "$pid" ]] || return 0

    local kill_cmd=""
    if [[ $EUID -ne 0 ]]; then
        local owner
        owner="$(ps -o user= -p "$pid" 2>/dev/null | tr -d '[:space:]')"
        if [[ "$owner" == "root" ]]; then
            kill_cmd="sudo "
        fi
    fi

    # Try graceful shutdown on the whole process group first.
    ${kill_cmd}kill -TERM "-$pid" 2>/dev/null || ${kill_cmd}kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
        kill -0 "$pid" 2>/dev/null || return 0
        sleep 0.5
    done
    warn "PID $pid did not exit within 10s, sending SIGKILL"
    ${kill_cmd}kill -KILL "-$pid" 2>/dev/null || ${kill_cmd}kill -KILL "$pid" 2>/dev/null || true
}

# --- Backend --------------------------------------------------------------

start_backend() {
    if read_alive_pid "$BACKEND_PID_FILE" >/dev/null; then
        warn "backend already running (pid $(cat "$BACKEND_PID_FILE"))"
        return 0
    fi

    local port_owner
    port_owner="$(port_pid "$BACKEND_PORT")"
    if [[ -n "$port_owner" ]]; then
        err "port $BACKEND_PORT is already in use by pid $port_owner (not started by this script)"
        return 1
    fi

    # Prefer a local virtualenv if one exists.
    local python_bin="python3"
    if [[ -x "$BACKEND_DIR/.venv/bin/python" ]]; then
        python_bin="$BACKEND_DIR/.venv/bin/python"
    elif [[ -x "$BACKEND_DIR/venv/bin/python" ]]; then
        python_bin="$BACKEND_DIR/venv/bin/python"
    fi

    info "starting backend on :$BACKEND_PORT (python=$python_bin)"
    if [[ $EUID -eq 0 ]]; then
        info "running as root — pcap generator can bind lo0 aliases & run tcpdump directly"
    else
        warn "running as non-root — pcap generator needs sudoers NOPASSWD for ifconfig/tcpdump,"
        warn "  or start via: sudo ./pcaphouse.sh start backend"
    fi
    # setsid gives the child its own session/pgid so kill -TERM -pid reaps
    # every descendant (uvicorn reload spawns subprocesses). Fall back if
    # setsid isn't available (macOS without util-linux).
    (
        cd "$BACKEND_DIR" || exit 1
        if command -v setsid >/dev/null 2>&1; then
            exec setsid "$python_bin" -m uvicorn main:app \
                --host 0.0.0.0 --port "$BACKEND_PORT" --reload \
                >>"$BACKEND_LOG_FILE" 2>&1 &
        else
            # Best-effort: the shell subprocess becomes the group leader.
            exec "$python_bin" -m uvicorn main:app \
                --host 0.0.0.0 --port "$BACKEND_PORT" --reload \
                >>"$BACKEND_LOG_FILE" 2>&1 &
        fi
        echo $! > "$BACKEND_PID_FILE"
    )

    # Wait briefly for the port to come up so `start` can report failure early.
    for _ in $(seq 1 20); do
        sleep 0.3
        if port_pid "$BACKEND_PORT" >/dev/null 2>&1 && \
           [[ -n "$(port_pid "$BACKEND_PORT")" ]]; then
            ok "backend listening on :$BACKEND_PORT (pid $(cat "$BACKEND_PID_FILE")), log: $BACKEND_LOG_FILE"
            return 0
        fi
        if ! read_alive_pid "$BACKEND_PID_FILE" >/dev/null; then
            err "backend exited during startup — check $BACKEND_LOG_FILE"
            rm -f "$BACKEND_PID_FILE"
            return 1
        fi
    done
    warn "backend started but port $BACKEND_PORT not responding yet — tail $BACKEND_LOG_FILE"
    return 0
}

stop_backend() {
    local pid
    if pid="$(read_alive_pid "$BACKEND_PID_FILE")"; then
        info "stopping backend (pid $pid)"
        kill_tree "$pid"
    else
        # Fallback: port may be held by a backend started outside this script.
        pid="$(port_pid "$BACKEND_PORT")"
        if [[ -n "$pid" ]]; then
            warn "backend pidfile missing/stale; stopping pid $pid holding :$BACKEND_PORT"
            kill_tree "$pid"
        else
            info "backend not running"
        fi
    fi
    rm -f "$BACKEND_PID_FILE"
    ok "backend stopped"
}

# --- Frontend -------------------------------------------------------------

start_frontend() {
    if read_alive_pid "$FRONTEND_PID_FILE" >/dev/null; then
        warn "frontend already running (pid $(cat "$FRONTEND_PID_FILE"))"
        return 0
    fi

    local port_owner
    port_owner="$(port_pid "$FRONTEND_PORT")"
    if [[ -n "$port_owner" ]]; then
        err "port $FRONTEND_PORT is already in use by pid $port_owner (not started by this script)"
        return 1
    fi

    if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
        warn "node_modules missing in $FRONTEND_DIR; run 'npm install' first"
        return 1
    fi

    info "starting frontend on :$FRONTEND_PORT"
    (
        cd "$FRONTEND_DIR" || exit 1
        if command -v setsid >/dev/null 2>&1; then
            exec setsid npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT" \
                >>"$FRONTEND_LOG_FILE" 2>&1 &
        else
            exec npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT" \
                >>"$FRONTEND_LOG_FILE" 2>&1 &
        fi
        echo $! > "$FRONTEND_PID_FILE"
    )

    for _ in $(seq 1 40); do
        sleep 0.3
        if [[ -n "$(port_pid "$FRONTEND_PORT")" ]]; then
            ok "frontend listening on :$FRONTEND_PORT (pid $(cat "$FRONTEND_PID_FILE")), log: $FRONTEND_LOG_FILE"
            return 0
        fi
        if ! read_alive_pid "$FRONTEND_PID_FILE" >/dev/null; then
            err "frontend exited during startup — check $FRONTEND_LOG_FILE"
            rm -f "$FRONTEND_PID_FILE"
            return 1
        fi
    done
    warn "frontend started but port $FRONTEND_PORT not responding yet — tail $FRONTEND_LOG_FILE"
    return 0
}

stop_frontend() {
    local pid
    if pid="$(read_alive_pid "$FRONTEND_PID_FILE")"; then
        info "stopping frontend (pid $pid)"
        kill_tree "$pid"
    else
        pid="$(port_pid "$FRONTEND_PORT")"
        if [[ -n "$pid" ]]; then
            warn "frontend pidfile missing/stale; stopping pid $pid holding :$FRONTEND_PORT"
            kill_tree "$pid"
        else
            info "frontend not running"
        fi
    fi
    rm -f "$FRONTEND_PID_FILE"
    ok "frontend stopped"
}

# --- Database -------------------------------------------------------------
#
# The backend uses a plain SQLite file (see backend/config.py:
# DATABASE_URL = "sqlite+aiosqlite:///./pcaphouse.db") and stores uploaded
# pcaps under backend/uploads/. These helpers operate directly on that
# filesystem state, so they *require* the backend to be stopped (otherwise
# SQLAlchemy is holding open file handles and you'd delete a live DB).

BACKEND_DB_FILE="$BACKEND_DIR/pcaphouse.db"
BACKEND_UPLOAD_DIR="$BACKEND_DIR/uploads"

# Wipe the sqlite db (plus WAL/SHM sidecars) and every uploaded pcap.
# The backend is stopped first so we don't rip files out from under a
# live connection. Does NOT restart the backend — call `db-init` or
# `start backend` afterwards.
cmd_db_clear() {
    info "clearing database and uploads"

    # Must stop backend first: SQLite on macOS tolerates the unlink, but
    # an in-flight request could still be writing to uploads/.
    if read_alive_pid "$BACKEND_PID_FILE" >/dev/null || \
       [[ -n "$(port_pid "$BACKEND_PORT")" ]]; then
        stop_backend
    else
        info "backend not running"
    fi

    local removed=0
    for f in "$BACKEND_DB_FILE" "$BACKEND_DB_FILE-wal" "$BACKEND_DB_FILE-shm"; do
        if [[ -e "$f" ]]; then
            rm -f "$f" && { ok "removed $(basename "$f")"; removed=$((removed + 1)); }
        fi
    done
    if [[ $removed -eq 0 ]]; then
        info "no db file to remove ($BACKEND_DB_FILE)"
    fi

    if [[ -d "$BACKEND_UPLOAD_DIR" ]]; then
        # Don't rm -rf the directory itself; the backend expects it to
        # exist on startup (see main.py: os.makedirs(..., exist_ok=True))
        # and keeping it avoids a race if the user restarts quickly.
        local count
        count="$(find "$BACKEND_UPLOAD_DIR" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')"
        if [[ "$count" != "0" ]]; then
            find "$BACKEND_UPLOAD_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
            ok "cleared $count entries from $BACKEND_UPLOAD_DIR"
        else
            info "uploads dir already empty"
        fi
    else
        info "no uploads dir to clear"
    fi

    ok "db cleared"
}

# Initialize the database schema. The backend's FastAPI startup hook
# (main.py → init_db) runs SQLAlchemy's create_all, which is idempotent,
# so we just need to make sure the backend comes up at least once.
cmd_db_init() {
    info "initializing database schema"

    if read_alive_pid "$BACKEND_PID_FILE" >/dev/null; then
        # Already running → schema was created on that process's startup.
        # create_all is idempotent so there's nothing else to do here.
        ok "backend already running; schema is up to date"
        return 0
    fi

    # Not running → start it. start_backend waits until the port is live,
    # at which point the startup hook has completed init_db().
    if start_backend; then
        ok "db initialized (backend is now running on :$BACKEND_PORT)"
    else
        err "failed to initialize db — backend did not start"
        return 1
    fi
}

# --- Status ---------------------------------------------------------------

print_status_row() {
    local name="$1" port="$2" pidfile="$3" logfile="$4"
    local pid status port_owner
    if pid="$(read_alive_pid "$pidfile")"; then
        status="${C_GREEN}running${C_RESET}"
    else
        pid="-"
        status="${C_RED}stopped${C_RESET}"
    fi
    port_owner="$(port_pid "$port")"
    [[ -z "$port_owner" ]] && port_owner="-"
    printf "  ${C_BOLD}%-9s${C_RESET}  status=%-22b  pid=%-8s  :%-5s (port pid=%s)  log=%s\n" \
        "$name" "$status" "$pid" "$port" "$port_owner" "$logfile"
}

cmd_status() {
    printf "${C_BOLD}PcapHouse services${C_RESET}\n"
    print_status_row "backend"  "$BACKEND_PORT"  "$BACKEND_PID_FILE"  "$BACKEND_LOG_FILE"
    print_status_row "frontend" "$FRONTEND_PORT" "$FRONTEND_PID_FILE" "$FRONTEND_LOG_FILE"
}

# --- Docker Compose -------------------------------------------------------
#
# The docker-compose stack is the recommended deployment mode on Linux
# servers: a single all-in-one image bundles the FastAPI backend, the
# built Vite frontend (served by nginx inside the same container) and
# tcpdump/tcprewrite/sharkd. The container is granted NET_ADMIN/NET_RAW
# so the pcap generator works out-of-the-box. On macOS docker-compose
# also works, but loopback aliasing happens inside the container's netns
# — that's fine for pcap generation, but don't expect host-side traffic
# capture.
#
# Persistent state lives in a bind mount on the host, configured via
# ``PCAPHOUSE_DATA_DIR`` (see .env.example). Default: ``./data`` next to
# this script. Two subdirectories are used:
#   ${PCAPHOUSE_DATA_DIR}/db        — SQLite DB + WAL/SHM sidecars
#   ${PCAPHOUSE_DATA_DIR}/uploads   — uploaded & generated pcaps
# Both survive ``docker compose down`` / image rebuilds, so upgrades
# are non-destructive.

COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

# Resolve the host data dir the same way docker-compose will:
#   1. ``.env`` next to docker-compose.yml (loaded automatically)
#   2. The caller's environment
#   3. Fallback: ``./data``
# Relative paths are anchored at the compose file's directory.
resolve_data_dir() {
    local raw="${PCAPHOUSE_DATA_DIR:-}"
    if [[ -z "$raw" && -f "$SCRIPT_DIR/.env" ]]; then
        # Cheap .env reader: last PCAPHOUSE_DATA_DIR=... line wins,
        # ignore comments / blank lines. Good enough for a config
        # that only ships two variables.
        raw="$(grep -E '^[[:space:]]*PCAPHOUSE_DATA_DIR[[:space:]]*=' "$SCRIPT_DIR/.env" \
                 | tail -n1 | sed -E 's/^[[:space:]]*PCAPHOUSE_DATA_DIR[[:space:]]*=[[:space:]]*//' \
                 | sed -E 's/^"(.*)"$/\1/' | sed -E "s/^'(.*)'$/\1/")"
    fi
    [[ -z "$raw" ]] && raw="./data"
    # Absolute paths pass through unchanged; relative paths are resolved
    # against the compose file's directory (same convention compose uses).
    if [[ "$raw" != /* ]]; then
        raw="$SCRIPT_DIR/$raw"
    fi
    printf '%s\n' "$raw"
}

# Detect the compose binary:
#   * modern Docker Desktop / docker-ce ships ``docker compose`` (plugin)
#   * older installs still have the standalone ``docker-compose`` binary
# Emit a single command string that callers can eval.
docker_compose_bin() {
    if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
        echo "docker compose"
        return 0
    fi
    if command -v docker-compose >/dev/null 2>&1; then
        echo "docker-compose"
        return 0
    fi
    return 1
}

# Guard: every docker-* subcommand needs docker + a compose implementation.
require_docker() {
    if ! command -v docker >/dev/null 2>&1; then
        err "docker is not installed or not on PATH"
        return 1
    fi
    if ! docker info >/dev/null 2>&1; then
        err "docker daemon is not reachable (is Docker running?)"
        return 1
    fi
    if ! docker_compose_bin >/dev/null; then
        err "neither 'docker compose' nor 'docker-compose' is available"
        return 1
    fi
    if [[ ! -f "$COMPOSE_FILE" ]]; then
        err "compose file not found: $COMPOSE_FILE"
        return 1
    fi
    return 0
}

# Start (or recreate) the stack in detached mode. Builds images on first
# run; subsequent runs reuse the cache unless ``docker-upgrade`` is used.
cmd_docker_up() {
    require_docker || return 1
    local bin data_dir http_port
    bin="$(docker_compose_bin)"
    data_dir="$(resolve_data_dir)"
    http_port="${PCAPHOUSE_HTTP_PORT:-8080}"

    # Pre-create the bind-mount targets so Docker doesn't auto-create
    # them as root-owned (which is annoying to clean up later for
    # non-root users).
    if ! mkdir -p "$data_dir/db" "$data_dir/uploads" 2>/dev/null; then
        err "cannot create data directory $data_dir (permission?)"
        return 1
    fi
    info "data dir: $data_dir  (override via PCAPHOUSE_DATA_DIR in .env)"

    info "bringing up pcaphouse stack ($bin up -d --build)"
    # --build: pick up code changes since the last image was built.
    # --remove-orphans: if a service was removed from compose file, clean it.
    if ${bin} -f "$COMPOSE_FILE" up -d --build --remove-orphans; then
        ok "stack is up"
        ${bin} -f "$COMPOSE_FILE" ps
        info "web UI:       http://localhost:${http_port}"
        info "API swagger:  http://localhost:${http_port}/docs"
    else
        err "docker compose up failed — check the output above"
        return 1
    fi
}

# Stop and remove containers but keep the host-side data directory
# (DB + uploads) untouched.
cmd_docker_down() {
    require_docker || return 1
    local bin
    bin="$(docker_compose_bin)"

    info "stopping pcaphouse stack (data dir preserved)"
    ${bin} -f "$COMPOSE_FILE" down
    ok "stack stopped"
}

# Print live container status.
cmd_docker_status() {
    require_docker || return 1
    local bin
    bin="$(docker_compose_bin)"
    ${bin} -f "$COMPOSE_FILE" ps
}

# Tail container logs. Second arg filters to a specific service.
cmd_docker_logs() {
    require_docker || return 1
    local bin svc
    bin="$(docker_compose_bin)"
    svc="${1:-}"
    if [[ -n "$svc" ]]; then
        ${bin} -f "$COMPOSE_FILE" logs -f --tail=200 "$svc"
    else
        ${bin} -f "$COMPOSE_FILE" logs -f --tail=200
    fi
}

# End-to-end upgrade: fetch the latest code, rebuild images, restart
# containers. Volumes (and therefore the DB + uploads) survive untouched.
#
# Flags honoured via env vars so we don't balloon the argv parsing:
#   SKIP_GIT=1  — don't ``git pull`` (e.g. user already pulled manually,
#                 or they're running from a tarball with no remote).
#   NO_CACHE=1  — ``docker compose build --no-cache`` for a clean rebuild.
cmd_docker_upgrade() {
    require_docker || return 1
    local bin
    bin="$(docker_compose_bin)"

    # 1. Pull latest source (unless opted out).
    if [[ "${SKIP_GIT:-0}" != "1" ]]; then
        if [[ -d "$SCRIPT_DIR/.git" ]]; then
            info "git pull"
            if ! (cd "$SCRIPT_DIR" && git pull --ff-only); then
                err "git pull failed — resolve manually then re-run with SKIP_GIT=1"
                return 1
            fi
        else
            warn "$SCRIPT_DIR is not a git checkout, skipping git pull"
        fi
    else
        info "SKIP_GIT=1 set, skipping git pull"
    fi

    # 2. Rebuild images. ``--pull`` refreshes the base images
    # (python:3.11-slim / node:20-alpine / nginx:1.27-alpine) too, which
    # is what you want for a proper upgrade.
    info "rebuilding images"
    local build_args=(-f "$COMPOSE_FILE" build --pull)
    if [[ "${NO_CACHE:-0}" == "1" ]]; then
        build_args+=(--no-cache)
    fi
    if ! ${bin} "${build_args[@]}"; then
        err "image build failed"
        return 1
    fi

    # 3. Recreate containers with the new images. The host data dir
    # persists, so SQLite data and uploaded pcaps are carried over
    # untouched.
    info "recreating containers"
    if ! ${bin} -f "$COMPOSE_FILE" up -d --remove-orphans; then
        err "docker compose up failed after build"
        return 1
    fi

    ok "upgrade complete"
    ${bin} -f "$COMPOSE_FILE" ps
}

# --- Dispatch -------------------------------------------------------------

usage() {
    cat <<EOF
Usage: $(basename "$0") <command> [target]

Local dev (host processes):
  start   [backend|frontend|all]   start services (default: all)
  stop    [backend|frontend|all]   stop services  (default: all)
  restart [backend|frontend|all]   restart services (default: all)
  status                           show running state of backend & frontend
  db-clear                         stop backend, delete sqlite db + uploads/
  db-init                          create schema (starts backend if needed)
  db-reset                         db-clear followed by db-init

Docker Compose deployment (single all-in-one container):
  docker-up                        build (if needed) and start the stack
  docker-down                      stop the stack (data dir preserved)
  docker-status                    show container status
  docker-logs [service]            tail container logs (all or a single service)
  docker-upgrade                   git pull + rebuild images + recreate
                                   containers (set SKIP_GIT=1 to skip pull,
                                   NO_CACHE=1 for a clean image rebuild)

Environment (read from .env next to docker-compose.yml; see .env.example):
  PCAPHOUSE_DATA_DIR               host path for DB + uploads (default ./data)
  PCAPHOUSE_HTTP_PORT              host port to publish web UI on (default 8080)

Files:
  pidfiles: $RUN_DIR/*.pid
  logs:     $BACKEND_LOG_FILE
            $FRONTEND_LOG_FILE
  db:       $BACKEND_DB_FILE
  uploads:  $BACKEND_UPLOAD_DIR
  compose:  $COMPOSE_FILE
EOF
}

cmd="${1:-}"
target="${2:-all}"

case "$cmd" in
    start)
        case "$target" in
            all)      start_backend; start_frontend ;;
            backend)  start_backend ;;
            frontend) start_frontend ;;
            *) err "unknown target: $target"; usage; exit 2 ;;
        esac
        ;;
    stop)
        case "$target" in
            all)      stop_frontend; stop_backend ;;
            backend)  stop_backend ;;
            frontend) stop_frontend ;;
            *) err "unknown target: $target"; usage; exit 2 ;;
        esac
        ;;
    restart)
        case "$target" in
            all)      stop_frontend; stop_backend; start_backend; start_frontend ;;
            backend)  stop_backend;  start_backend ;;
            frontend) stop_frontend; start_frontend ;;
            *) err "unknown target: $target"; usage; exit 2 ;;
        esac
        ;;
    status)
        cmd_status
        ;;
    db-clear)
        cmd_db_clear
        ;;
    db-init)
        cmd_db_init
        ;;
    db-reset)
        cmd_db_clear && cmd_db_init
        ;;
    docker-up)
        cmd_docker_up
        ;;
    docker-down)
        cmd_docker_down
        ;;
    docker-status)
        cmd_docker_status
        ;;
    docker-logs)
        # Use $2 directly here because the generic ``target`` default of
        # "all" would otherwise be passed to ``logs`` as a (nonexistent)
        # service name.
        cmd_docker_logs "${2:-}"
        ;;
    docker-upgrade)
        cmd_docker_upgrade
        ;;
    ""|-h|--help|help)
        usage
        ;;
    *)
        err "unknown command: $cmd"
        usage
        exit 2
        ;;
esac
