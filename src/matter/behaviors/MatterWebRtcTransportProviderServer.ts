import { CameraRequirements } from '@matter/main/devices/camera';
import { ClientNode, ServerNode } from '@matter/main';
import { Logger } from '@matter/general';
import { hasRemoteActor, Invoke, PeerAddress } from '@matter/protocol';
import { WebRtcTransportProvider } from '@matter/types/clusters/web-rtc-transport-provider';
import { WebRtcTransportRequestor } from '@matter/types/clusters/web-rtc-transport-requestor';
import { WebRtcTransportDefinitions } from '@matter/types/clusters/web-rtc-transport-definitions';
import { StreamUsage, NodeId, EndpointNumber, FabricIndex } from '@matter/types';
import { StatusCode as Status, StatusResponseError } from '@matter/types/common';
import { streamContext } from './streamContext.js';
import { disableWebRtcCommandValidation } from '../webrtcCommandValidation.js';
import {
    describeAnswerSetup,
    describeHubOffer,
    embedLocalCandidatesInAnswerSdp,
    filterLocalBridgeCandidates,
    filterSdpToLocalBridgeCandidate,
    formatHubOfferDiagnostics,
    isCompactHubOffer,
    matterIceToSdpFrag,
    parseSdpIceCandidates,
    prepareHubOfferForGo2rtc,
} from '../webrtcIce.js';
import { appConfig } from '../../config/app.js';
import { buildSolicitOfferResponse } from './solicitOfferHandler.js';
import { logHubEndpointAdoption } from '../hubAdoptionLog.js';

const logger = Logger.get('MatterWebRtc');

/** Hub may return NotFound if WebRtcTransportRequestor is not ready yet (e.g. after TCP session resume). */
const ANSWER_DELIVERY_RETRY_MS = [0, 200, 500, 1000, 2000];

function isHubSessionNotReady(error: unknown): boolean {
    const msg = String(error);
    return msg.includes('NotFound') || msg.includes('code 139');
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

interface WebRtcSessionState {
    answerSdp: string;
    cameraId: string;
    hubEndpoint: EndpointNumber;
    whepLocation?: string;
    whepEtag?: string;
}

/**
 * Bridges Matter WebRTC signaling to go2rtc (RTSP → WebRTC).
 */
export class MatterWebRtcTransportProviderServer extends CameraRequirements.WebRtcTransportProviderServer {
    static override readonly id = 'webRtcTransportProvider';

    #sessions = new Map<number, WebRtcSessionState>();
    #nextSessionId = 1;
    #offerChain: Promise<void> = Promise.resolve();

    /** WebRTCSessionID is uint16 per Matter spec (max 65535). */
    #allocateSessionId(requested: number | null | undefined): number {
        if (requested != null && requested > 0 && requested <= 65535) {
            return requested;
        }
        const id = this.#nextSessionId;
        this.#nextSessionId = this.#nextSessionId >= 65535 ? 1 : this.#nextSessionId + 1;
        return id;
    }

    override async solicitOffer(request: WebRtcTransportProvider.SolicitOfferRequest) {
        const sessionId = this.#allocateSessionId(undefined);
        return buildSolicitOfferResponse(sessionId, request);
    }

    override async provideOffer(request: WebRtcTransportProvider.ProvideOfferRequest) {
        const run = () => this.#provideOffer(request);
        const next = this.#offerChain.then(run, run);
        this.#offerChain = next.then(() => undefined, () => undefined);
        return next;
    }

    async #provideOffer(request: WebRtcTransportProvider.ProvideOfferRequest) {
        const go2rtc = streamContext.go2rtc;
        if (!go2rtc) throw new Error('go2rtc client not initialized');

        if (!request.sdp?.trim()) {
            throw new Error('ProvideOffer missing SDP');
        }

        const cameraId = String(this.endpoint.id);
    logHubEndpointAdoption(cameraId, 'provideOffer');
        const sessionId = this.#allocateSessionId(request.webRtcSessionId);
        const hubEndpoint = this.#hubEndpoint(request.originatingEndpointId);
        const hubIceServers = request.iceServers?.length ?? 0;

        const hubDiag = describeHubOffer(request.sdp);
        logger.info(
            `ProvideOffer camera=${cameraId} session=${sessionId} hubEp=${hubEndpoint} `
            + `hubIceServers=${hubIceServers} ${formatHubOfferDiagnostics(hubDiag)}`,
        );

        const compactHub = isCompactHubOffer(request.sdp);
        const lanPrefix = appConfig.matterHost.split('.').slice(0, 3).join('.') + '.';
        const hubOffer = prepareHubOfferForGo2rtc(request.sdp, { lanPrefix });
        const hubCandidatesBefore = parseSdpIceCandidates(request.sdp).length;
        const hubCandidatesAfter = parseSdpIceCandidates(hubOffer).length;
        if (compactHub) {
            logger.info(
                `Hub offer session=${sessionId} compact/Android `
                + `candidates=${hubCandidatesBefore}→${hubCandidatesAfter}`,
            );
        } else if (hubCandidatesBefore !== hubCandidatesAfter) {
            logger.info(
                `Filtered hub offer ICE session=${sessionId} `
                + `${hubCandidatesBefore}→${hubCandidatesAfter} (LAN host only, ice-lite hint for go2rtc)`,
            );
        }

        const replaceSession = this.#sessions.has(sessionId);
        const compactRetry = compactHub && go2rtc.shouldRecycleCompactHub(cameraId);
        const recycle = replaceSession || compactRetry;
        if (replaceSession) {
            logger.info(`Replacing prior WebRTC session=${sessionId} camera=${cameraId}`);
            await this.#clearSession(sessionId);
        } else if (compactRetry) {
            logger.info(`Recycling go2rtc for compact hub retry camera=${cameraId} session=${sessionId}`);
        }

        let exchange;
        try {
            // Never block the hub on ffmpeg pre-warm — cold transcode may still add latency on the first
            // exchange, but serializing an 8s frame fetch here caused 15–20s live-view opens (regression).
            void go2rtc.prewarmWebRtcIfStale(cameraId).catch(error => {
                logger.debug(`Background WebRTC pre-warm failed camera=${cameraId}: ${error}`);
            });
            // Hub TURN/STUN stays on the controller; go2rtc gets a LAN-only offer copy
            // so it can become ICE controlling and nominate the host pair.
            exchange = await go2rtc.exchangeWebRtcOffer(cameraId, hubOffer, undefined, false, {
                recycle,
            });
        } catch (error) {
            logger.error(`ProvideOffer failed camera=${cameraId} session=${sessionId}: ${error}`);
            throw error;
        }
        if (compactHub) {
            go2rtc.markCompactHubOffer(cameraId);
        }
        logger.info(
            `go2rtc answer session=${sessionId} sdp=${exchange.answerSdp.length}ch `
            + `${describeAnswerSetup(exchange.answerSdp)}`,
        );

        if (exchange.whepLocation && exchange.whepEtag) {
            const remoteCandidates = parseSdpIceCandidates(request.sdp);
            if (remoteCandidates.length > 0) {
                try {
                    const etag = await go2rtc.trickleIceCandidates(
                        exchange.whepLocation,
                        exchange.whepEtag,
                        matterIceToSdpFrag(remoteCandidates),
                    );
                    if (etag) {
                        exchange.whepEtag = etag;
                    }
                    logger.info(`Forwarded ${remoteCandidates.length} hub ICE candidate(s) to go2rtc WHEP`);
                } catch (error) {
                    logger.warn(`Hub ICE trickle to go2rtc failed: ${error}`);
                }
            }
        }

        const filteredAnswer = filterSdpToLocalBridgeCandidate(exchange.answerSdp, { host: appConfig.matterHost });
        const allLocal = parseSdpIceCandidates(filteredAnswer);
        const localCandidates = filterLocalBridgeCandidates(allLocal, { host: appConfig.matterHost });
        const answerSdp = embedLocalCandidatesInAnswerSdp(filteredAnswer, localCandidates);

        this.#sessions.set(sessionId, {
            answerSdp,
            cameraId,
            hubEndpoint,
            whepLocation: exchange.whepLocation,
            whepEtag: exchange.whepEtag,
        });

        const peerNodeId = this.#peerNodeId();
        const sessionFields: Partial<WebRtcTransportDefinitions.WebRtcSession> = {
            id: sessionId,
            peerNodeId,
            peerEndpointId: hubEndpoint,
            streamUsage: request.streamUsage ?? StreamUsage.LiveView,
            metadataEnabled: request.metadataEnabled ?? false,
            fabricIndex: this.#fabricIndex(),
            videoStreams: request.videoStreams ?? [request.videoStreamId ?? 1],
        };
        if (request.audioStreams?.length) {
            sessionFields.audioStreams = request.audioStreams;
        } else if (request.audioStreamId != null) {
            sessionFields.audioStreams = [request.audioStreamId];
        }

        try {
            const others = (this.state.currentSessions ?? []).filter(s => s.id !== sessionId);
            this.state.currentSessions = [...others, new WebRtcTransportDefinitions.WebRtcSession(sessionFields)];
        } catch (error) {
            logger.warn(`Failed to update currentSessions: ${error}`);
        }

        const response = new WebRtcTransportProvider.ProvideOfferResponse({
            webRtcSessionId: sessionId,
            videoStreamId: request.videoStreams?.[0] ?? request.videoStreamId ?? 1,
        });

        // Hub creates WebRtcTransportRequestor session on ProvideOfferResponse receipt (Matter 1.5 §11.5.7.4).
        // Deliver answer/ICE after the command response so the hub session exists (fixes NotFound 139 after reprofile).
        void this.#deliverHubSignalingAfterResponse(
            sessionId,
            answerSdp,
            hubEndpoint,
            localCandidates,
            allLocal.length,
        );

        return response;
    }

    async #deliverHubSignalingAfterResponse(
        sessionId: number,
        answerSdp: string,
        hubEndpoint: EndpointNumber,
        localCandidates: WebRtcTransportDefinitions.IceCandidate[],
        allLocalCount: number,
    ): Promise<void> {
        await sleep(80);
        try {
            await this.#sendAnswerToHub(sessionId, answerSdp, hubEndpoint);
            if (allLocalCount !== localCandidates.length) {
                logger.info(
                    `Filtered bridge ICE candidates session=${sessionId} `
                    + `${allLocalCount}→${localCandidates.length} host=${appConfig.matterHost}`,
                );
            }
            if (localCandidates.length > 0) {
                await this.#sendIceCandidatesToHub(sessionId, localCandidates, hubEndpoint);
                await this.#sendIceCandidatesToHub(sessionId, [
                    new WebRtcTransportDefinitions.IceCandidate({
                        candidate: 'end-of-candidates',
                        sdpMid: null,
                        sdpmLineIndex: null,
                    }),
                ], hubEndpoint);
            }
        } catch (error) {
            logger.error(`Deferred hub WebRTC signaling failed session=${sessionId}: ${error}`);
        }
    }

    override async provideAnswer(request: WebRtcTransportProvider.ProvideAnswerRequest) {
        logger.info(`ProvideAnswer session=${request.webRtcSessionId} (hub answer, ${request.sdp.length} chars)`);
    }

    override async provideIceCandidates(request: WebRtcTransportProvider.ProvideIceCandidatesRequest) {
        const go2rtc = streamContext.go2rtc;
        const session = this.#sessions.get(request.webRtcSessionId);
        const count = request.iceCandidates?.length ?? 0;

        if (session) {
            logHubEndpointAdoption(session.cameraId, 'provideIceCandidates', `count=${count}`);
        }

        logger.info(`ProvideIceCandidates session=${request.webRtcSessionId} candidates=${count}`);

        if (!go2rtc || !session?.whepLocation || !session.whepEtag || count === 0) {
            return;
        }

        try {
            const sdpFrag = matterIceToSdpFrag(request.iceCandidates);
            session.whepEtag = await go2rtc.trickleIceCandidates(session.whepLocation, session.whepEtag, sdpFrag)
                ?? session.whepEtag;
            logger.info(`Forwarded ${count} ICE candidate(s) to go2rtc session=${request.webRtcSessionId}`);
        } catch (error) {
            logger.warn(`ICE trickle to go2rtc failed: ${error}`);
        }
    }

    override async endSession(request: WebRtcTransportProvider.EndSessionRequest) {
        const session = this.#sessions.get(request.webRtcSessionId);
        if (session) {
            logHubEndpointAdoption(session.cameraId, 'endSession');
        }
        await this.#clearSession(request.webRtcSessionId);
        logger.info(`endSession camera=${session?.cameraId ?? '?'} session=${request.webRtcSessionId}`);
    }

    async #clearSession(sessionId: number) {
        const session = this.#sessions.get(sessionId);
        const go2rtc = streamContext.go2rtc;

        if (go2rtc && session?.whepLocation) {
            await go2rtc.closeWebRtcSession(session.whepLocation);
        }

        this.#sessions.delete(sessionId);
        this.state.currentSessions = (this.state.currentSessions ?? []).filter(s => s.id !== sessionId);
    }

    #hubEndpoint(originatingEndpointId: EndpointNumber | null | undefined): EndpointNumber {
        if (originatingEndpointId != null) {
            return originatingEndpointId;
        }
        return EndpointNumber(0);
    }

    #peerNodeId(): NodeId {
        if (hasRemoteActor(this.context) && this.context.session.peerNodeId !== undefined) {
            return NodeId(this.context.session.peerNodeId);
        }
        return NodeId(0);
    }

    #fabricIndex(): FabricIndex {
        if (hasRemoteActor(this.context) && this.context.fabric !== undefined) {
            return FabricIndex(this.context.fabric);
        }
        return FabricIndex(1);
    }

    async #resolveHubPeer() {
        const node = this.env.get(ServerNode);
        const nodeId = this.#peerNodeId();
        if (nodeId === NodeId.UNSPECIFIED_NODE_ID) {
            return undefined;
        }
        const peerAddress = PeerAddress({ fabricIndex: this.#fabricIndex(), nodeId });
        try {
            return await node.peers.forAddress(peerAddress);
        } catch (error) {
            logger.warn(`Failed to resolve hub peer ${peerAddress}: ${error}`);
            return undefined;
        }
    }

    #hubEndpoints(hubEndpointId: EndpointNumber): EndpointNumber[] {
        return [...new Set([hubEndpointId, EndpointNumber(0), EndpointNumber(1)])];
    }

    async #sendAnswerToHub(sessionId: number, answerSdp: string, hubEndpointId: EndpointNumber) {
        const peer = await this.#resolveHubPeer();
        if (!peer) {
            logger.warn('No Matter peer to deliver WebRTC answer');
            return;
        }

        let lastError: unknown;
        for (let attempt = 0; attempt < ANSWER_DELIVERY_RETRY_MS.length; attempt++) {
            const delay = ANSWER_DELIVERY_RETRY_MS[attempt];
            if (delay > 0) {
                await sleep(delay);
                logger.info(`Retry WebRTC answer delivery session=${sessionId} attempt=${attempt + 1}`);
            }

            for (const endpoint of this.#hubEndpoints(hubEndpointId)) {
                const invoke = Invoke(
                    Invoke.ConcreteCommandRequest({
                        endpoint,
                        cluster: WebRtcTransportRequestor,
                        command: 'answer',
                        fields: new WebRtcTransportRequestor.AnswerRequest({
                            webRtcSessionId: sessionId,
                            sdp: answerSdp,
                        }),
                    }),
                );
                invoke.largeMessage = true;

                try {
                    await this.#runInvoke(peer, invoke);
                    logger.info(
                        `WebRTC answer delivered session=${sessionId} hubEp=${endpoint} `
                        + `attempt=${attempt + 1}`,
                    );
                    return;
                } catch (error) {
                    lastError = error;
                    if (isHubSessionNotReady(error) && attempt < ANSWER_DELIVERY_RETRY_MS.length - 1) {
                        break;
                    }
                    logger.warn(`WebRTC answer delivery failed hubEp=${endpoint}: ${error}`);
                }
            }
        }

        throw lastError ?? new Error('WebRTC answer delivery failed on all hub endpoints');
    }

    async #sendIceCandidatesToHub(
        sessionId: number,
        iceCandidates: WebRtcTransportDefinitions.IceCandidate[],
        hubEndpointId: EndpointNumber,
    ) {
        const peer = await this.#resolveHubPeer();
        if (!peer) return;

        for (const endpoint of this.#hubEndpoints(hubEndpointId)) {
            const invoke = Invoke(
                Invoke.ConcreteCommandRequest({
                    endpoint,
                    cluster: WebRtcTransportRequestor,
                    command: 'iceCandidates',
                    fields: new WebRtcTransportRequestor.IceCandidatesRequest({
                        webRtcSessionId: sessionId,
                        iceCandidates,
                    }),
                }),
            );

            try {
                await this.#runInvoke(peer, invoke);
                logger.info(`ICE candidates delivered session=${sessionId} hubEp=${endpoint} count=${iceCandidates.length}`);
                return;
            } catch (error) {
                logger.warn(`ICE candidates delivery failed hubEp=${endpoint}: ${error}`);
            }
        }
    }

    async #runInvoke(peer: ClientNode, invoke: ReturnType<typeof Invoke>) {
        if (!peer) return;
        for await (const chunk of peer.interaction.invoke(invoke, this.context)) {
            for (const entry of chunk) {
                if (entry.kind === 'cmd-status' && entry.status !== Status.Success) {
                    throw StatusResponseError.create(entry.status, 'WebRTC invoke failed', entry.clusterStatus);
                }
            }
        }
    }
}

disableWebRtcCommandValidation(MatterWebRtcTransportProviderServer);
