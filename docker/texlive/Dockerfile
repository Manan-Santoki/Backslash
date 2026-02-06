FROM texlive/texlive:latest

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    latexmk \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
