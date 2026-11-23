FROM ubuntu:24.04 AS build
RUN apt-get -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 -o Acquire::Retries=3 update && \
    apt-get -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 -o Acquire::Retries=3 install -y --no-install-recommends \
      git ca-certificates cmake make gcc g++ zlib1g-dev libbz2-dev libssl-dev && \
    rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/mozilla/libdmg-hfsplus /src && cd /src && cmake -B build -DCMAKE_BUILD_TYPE=Release . && make -C build -j8

FROM ubuntu:24.04
RUN apt-get -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 -o Acquire::Retries=3 update && \
    apt-get -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 -o Acquire::Retries=3 install -y --no-install-recommends \
      ca-certificates hfsprogs libbz2-1.0 libssl3t64 python3 python3-pip zlib1g && \
    rm -rf /var/lib/apt/lists/*
COPY --from=build /src/build/dmg/dmg /src/build/hfs/hfsplus /usr/local/bin/
# dsstore.py writes the Finder layout for each volume name.
RUN pip install --no-cache-dir --break-system-packages --timeout 30 --retries 3 ds_store==1.3.3 mac_alias==2.2.3
