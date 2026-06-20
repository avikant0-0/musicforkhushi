# musicforkhushi — Node backend + yt-dlp + ffmpeg for audio extraction,
# building the Vite/React client and serving it from the same server.
FROM node:20-bookworm-slim

# yt-dlp needs ffmpeg (for -x m4a) and a CA bundle for HTTPS. It also needs a
# JS runtime to solve YouTube's "n challenge" — Deno is yt-dlp's recommended
# default (unzip is only needed to extract the Deno release).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl unzip \
  && curl -L https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && curl -fsSL https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip -o /tmp/deno.zip \
  && unzip /tmp/deno.zip -d /usr/local/bin \
  && chmod a+rx /usr/local/bin/deno \
  && rm /tmp/deno.zip \
  && apt-get purge -y curl unzip \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install backend deps.
COPY package*.json ./
RUN npm install --omit=dev

# Build the React client.
COPY client/package*.json ./client/
RUN npm --prefix client install
COPY client ./client
RUN npm --prefix client run build

# App source.
COPY server ./server

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
