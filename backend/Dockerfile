# PcapHouse all-in-one image.
#
# A single container runs BOTH the FastAPI backend and the nginx that
# serves the built Vite frontend + reverse-proxies /api. This keeps the
# deployment simple (one image, one container, one port to expose) and
# avoids the need for a separate docker network just to let nginx reach
# the backend — here nginx talks to uvicorn on 127.0.0.1:8000 inside the
# same netns.
#
# Processes inside the container (managed by supervisord):
#   * uvicorn   — FastAPI on 127.0.0.1:8000 (not exposed directly)
#   * nginx     — listens on :80, serves /app/frontend and proxies /api
#                 to the uvicorn socket above
#
# Bundled system tools the pcap-generation pipeline shells out to:
#   * tcpdump          — packet capture on lo
#   * iproute2         — ``ip addr add/del`` for loopback aliases
#   * tcpreplay        — provides tcprewrite for the post-processing pass
#   * tshark (4.2+)    — ships the ``sharkd`` JSON-RPC daemon used by the
#                        pcap viewer API. We need >= 4.2 so sharkd
#                        implements the ``phs`` (protocol hierarchy
#                        statistics) tap that ``SharkdClient.get_summary``
#                        prefers; Wireshark 4.0.x sharkd replies with
#                        ``error: sharkd_session_process_tap() phs not
#                        recognized`` (code -11012).
#
#                        To get a new-enough tshark without adding third-
#                        party repos, the runtime stage is based on
#                        ``fedora:41`` whose default repos ship
#                        wireshark-cli 4.4.x (which includes sharkd). This
#                        keeps us on a Red Hat-family base image while
#                        still getting Wireshark >= 4.2. RHEL/Rocky/Alma 9
#                        were considered but their wireshark-cli is still
#                        on 4.0.x in AppStream and would need EPEL or a
#                        rebuild.
#
#                        NOTE: on Fedora/RHEL ``sharkd`` lives in the
#                        ``wireshark-cli`` package alongside ``tshark``.
#
# The container runs as root so NetworkManager / CaptureManager don't need
# sudo; docker-compose grants it NET_ADMIN (for ``ip addr``) and NET_RAW
# (for tcpdump) capabilities.

# ---------- Stage 1: build the frontend ----------
# Kept as a separate stage so the final image doesn't carry node_modules
# (~300 MB) or the full node toolchain.
FROM node:20-alpine AS frontend-builder

WORKDIR /build

# Install deps first so the npm-cache layer is reused on source-only changes.
# Prefer ``npm ci`` when a lockfile exists (reproducible); fall back to
# ``npm install`` for checkouts that ship without package-lock.
COPY frontend/package.json frontend/package-lock.json* /build/
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY frontend/ /build/

# Vite writes to /build/dist. ``tsc -b && vite build`` matches the local
# ``npm run build`` script.
RUN npm run build


# ---------- Stage 2: runtime image ----------
# Fedora 41 is chosen over ``python:3.11-slim-bookworm`` so that
# ``dnf install wireshark-cli`` gives us Wireshark 4.4.x out of the box
# (Debian bookworm tops out at 4.0.17 which lacks the ``phs`` sharkd
# tap — see long comment at top of file). Fedora's system python3 is
# 3.13; we install it directly and use a venv at /opt/venv to keep the
# runtime's site-packages separate from anything ``dnf`` would manage.
FROM fedora:41

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PATH="/opt/venv/bin:${PATH}"

# System deps.
#   ca-certificates/tzdata : sensible defaults for outbound calls / logs.
#   procps-ng              : handy for debugging inside the container.
#   iproute                : ``ip addr`` for loopback aliases. (Fedora
#                            ships this as ``iproute`` rather than
#                            ``iproute2``.)
#   tcpdump/tcpreplay      : capture + rewrite.
#   wireshark-cli          : provides both ``tshark`` and ``sharkd`` on
#                            Fedora (unlike Debian where ``sharkd`` lives
#                            in the ``tshark`` package).
#   nginx                  : serves the frontend bundle + proxies /api.
#   supervisor             : runs nginx + uvicorn side by side in one
#                            container with proper signal forwarding.
#   python3 / python3-pip  : runtime for the FastAPI backend. Fedora's
#                            python3 already includes the venv module,
#                            so no separate ``python3-venv`` package
#                            like on Debian/Ubuntu.
# ``dnf -y`` is the Red Hat equivalent of ``apt-get -y``. ``--setopt=
# install_weak_deps=False`` mirrors apt's ``--no-install-recommends`` to
# keep GUI / X11 pulls off the image.
RUN dnf -y --setopt=install_weak_deps=False install \
        ca-certificates \
        tzdata \
        procps-ng \
        iproute \
        tcpdump \
        tcpreplay \
        wireshark-cli \
        nginx \
        supervisor \
        python3 \
        python3-pip \
 && dnf clean all \
 && rm -rf /var/cache/dnf \
 && python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --upgrade pip

WORKDIR /app

# Install Python deps first so the wheel cache layer can be reused on
# app-code-only rebuilds. We call the venv's pip by absolute path to
# make the intent obvious — even though ``/opt/venv/bin`` is already on
# PATH via the ENV above, so a bare ``pip`` would resolve to the same
# binary.
COPY backend/requirements.txt /app/requirements.txt
RUN /opt/venv/bin/pip install -r /app/requirements.txt

# Backend application code.
COPY backend/ /app/

# Frontend bundle from stage 1 → nginx docroot.
COPY --from=frontend-builder /build/dist /app/frontend

# nginx + supervisord configs.
#   * nginx: Fedora's /etc/nginx/nginx.conf has
#     ``include /etc/nginx/conf.d/*.conf`` inside the ``http {}`` block,
#     so dropping our server block into
#     ``/etc/nginx/conf.d/default.conf`` is all that's needed to register
#     it. HOWEVER, Fedora's stock nginx.conf *also* ships its own inline
#     ``server { listen 80 default_server; ... }`` right above that
#     include. Since our config also claims ``default_server``, we'd
#     fail to start with "duplicate default server". We sed that inline
#     server block out below.
#   * supervisor: Fedora's supervisord reads ``/etc/supervisord.conf``
#     (no ``/etc/supervisor/`` prefix) and its default ``include``
#     directive pulls ``/etc/supervisord.d/*.ini``. We drop our program
#     definitions there. The CMD below points supervisord at the main
#     conf file explicitly so this works regardless of distro defaults.
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY backend/supervisord.conf /etc/supervisord.d/pcaphouse.ini

# Strip the inline ``server { ... }`` block shipped in Fedora's default
# /etc/nginx/nginx.conf so it doesn't collide with our conf.d entry on
# ``listen 80 default_server``. The block is well-formed and contained
# (no nested ``server`` blocks), so a simple awk brace-counter is
# sufficient — no need to pull in a yq/xmlstarlet-class tool.
RUN awk '                                                           \
        /^[[:space:]]*server[[:space:]]*\{/ && depth==0 {           \
            depth=1; next                                           \
        }                                                           \
        depth>0 {                                                   \
            n=gsub(/\{/,"{"); depth+=n;                             \
            n=gsub(/\}/,"}"); depth-=n;                             \
            next                                                    \
        }                                                           \
        { print }                                                   \
    ' /etc/nginx/nginx.conf > /etc/nginx/nginx.conf.new \
 && mv /etc/nginx/nginx.conf.new /etc/nginx/nginx.conf \
 && nginx -t

# Runtime dirs the app expects to exist. They'll typically be shadowed by
# bind mounts from docker-compose, but creating them here means the image
# also works stand-alone (e.g. ``docker run``).
RUN mkdir -p /app/db /app/uploads /app/tmp_gen /var/log/supervisor

# Only nginx is exposed; uvicorn stays on 127.0.0.1 inside the container.
EXPOSE 80

# supervisord in the foreground is PID 1. It reaps zombies and forwards
# SIGTERM from ``docker stop`` to both nginx and uvicorn cleanly.
# ``-n`` (== ``--nodaemon``) is the critical bit: without it supervisord
# forks into the background, the foreground process exits, and Docker
# restarts the container in an infinite loop.
CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisord.conf"]
