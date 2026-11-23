FROM ubuntu:24.04
RUN apt-get -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 -o Acquire::Retries=3 update && \
    apt-get -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 -o Acquire::Retries=3 install -y --no-install-recommends \
      ca-certificates nsis nodejs npm && \
    rm -rf /var/lib/apt/lists/*
# resources.mjs writes the icon and version into Linger.exe.
RUN npm install -g --fetch-timeout=30000 --fetch-retries=3 resedit@3.1.0 && npm cache clean --force
ENV NODE_PATH=/usr/local/lib/node_modules
