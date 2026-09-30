# Verification sandbox image (docs/SECURITY.md §3). Built and pinned by digest on Day 2.
# Contains only a Node toolchain and package managers; never contains RepoPilot code or secrets.
FROM node:22-bookworm-slim
ENV CI=true NODE_ENV=test COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable \
 && groupadd -g 1000 sandbox 2>/dev/null || true \
 && (id -u sandbox >/dev/null 2>&1 || useradd -u 1000 -g 1000 -m -s /bin/bash sandbox || usermod -l sandbox -d /home/sandbox -m node) \
 && mkdir -p /workspace /out /home/sandbox/.npm && chown -R 1000:1000 /workspace /out /home/sandbox
USER 1000:1000
WORKDIR /workspace
# No ENTRYPOINT: the worker supplies the exact install/test command per phase.
