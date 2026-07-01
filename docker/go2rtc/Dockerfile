# Patched go2rtc for Matter/SmartThings: ICE MaxBindingRequests, ice-lite, host-UDP-only candidates.
# Based on upstream docker/Dockerfile (alexxit/go2rtc alpine image).

ARG GO_VERSION=1.24
ARG GO2RTC_TAG=v1.9.13
ARG PYTHON_VERSION=3.13

FROM golang:${GO_VERSION}-alpine AS build

RUN apk add --no-cache git patch

ARG GO2RTC_TAG
WORKDIR /build

RUN git clone --depth 1 --branch "${GO2RTC_TAG}" https://github.com/AlexxIT/go2rtc.git .

COPY patch-ice.diff patch-candidates.diff /tmp/
RUN patch -p1 < /tmp/patch-ice.diff && patch -p1 < /tmp/patch-candidates.diff

RUN CGO_ENABLED=0 go build -ldflags "-s -w" -trimpath -o go2rtc .

FROM python:${PYTHON_VERSION}-alpine AS base

RUN apk add --no-cache tini ffmpeg bash curl jq alsa-plugins-pulse font-droid

COPY --from=build /build/go2rtc /usr/local/bin/

EXPOSE 1984 8554 8555 8555/udp
ENTRYPOINT ["/sbin/tini", "--"]
WORKDIR /config

# Baked default config so the pre-built image runs standalone: go2rtc substitutes
# ${LAN_IP} from the container env at startup. The from-source stack bind-mounts
# data/go2rtc.yaml over this, so this default only applies to the GHCR path.
COPY go2rtc.yaml /config/go2rtc.yaml

CMD ["go2rtc", "-config", "/config/go2rtc.yaml"]
