import { CameraAvStreamManagementServer as BaseCameraAvStreamManagementServer } from '@matter/main/behaviors/camera-av-stream-management';
import { CameraAvStreamManagement } from '@matter/types/clusters/camera-av-stream-management';
import { StreamUsage } from '@matter/types';
import { Logger } from '@matter/general';
import { normalizeJpeg, readJpegDimensions } from '../../streaming/normalizeJpeg.js';
import { streamContext } from './streamContext.js';
import {
    createDefaultAudioStream,
    createDefaultSnapshotStream,
    createDefaultVideoStream,
} from '../devices/cameraStreamFactories.js';

const AvMgmt = CameraAvStreamManagement;
const logger = Logger.get('CameraAvStream');

/** Matter TCP max frame is 64KB; snapshot payload must stay well below that. */
const MAX_SNAPSHOT_BYTES = 48_000;
const MAX_SNAPSHOT_WIDTH = 640;
const MIN_SNAPSHOT_WIDTH = 320;

/** Hub may request WxH; only width is used — go2rtc scales with scale=W:-1. */
function clampSnapshotWidth(requestedWidth?: number): number {
    const w = requestedWidth ?? MAX_SNAPSHOT_WIDTH;
    return Math.min(MAX_SNAPSHOT_WIDTH, Math.max(MIN_SNAPSHOT_WIDTH, w));
}
const CameraAvServer = BaseCameraAvStreamManagementServer.with(
    'Video', 'Audio', 'Snapshot', 'Speaker', 'ImageControl',
);

/**
 * Camera AV Stream Management for bridged RTSP cameras (Matter Camera 0x0142).
 */
export class MatterCameraAvStreamManagementServer extends CameraAvServer {
    static override readonly id = 'cameraAvStreamManagement';

    override async setStreamPriorities(request: CameraAvStreamManagement.SetStreamPrioritiesRequest) {
        if (request.streamPriorities?.length) {
            this.state.streamUsagePriorities = request.streamPriorities;
        }
    }

    override async audioStreamAllocate(request: CameraAvStreamManagement.AudioStreamAllocateRequest) {
        const usage = request.streamUsage ?? StreamUsage.LiveView;
        const streams = [...(this.state.allocatedAudioStreams ?? [])];
        const existing = streams.find(s => s.streamUsage === usage);
        if (existing) {
            return new AvMgmt.AudioStreamAllocateResponse({ audioStreamId: existing.audioStreamId });
        }

        const stream = createDefaultAudioStream(usage);
        if (usage === StreamUsage.Recording) {
            stream.audioStreamId = 2;
        }
        stream.audioCodec = request.audioCodec ?? stream.audioCodec;
        stream.channelCount = request.channelCount ?? stream.channelCount;
        stream.sampleRate = request.sampleRate ?? stream.sampleRate;
        stream.bitRate = request.bitRate ?? stream.bitRate;
        streams.push(stream);
        this.state.allocatedAudioStreams = streams;

        return new AvMgmt.AudioStreamAllocateResponse({ audioStreamId: stream.audioStreamId });
    }

    override async audioStreamDeallocate(request: CameraAvStreamManagement.AudioStreamDeallocateRequest) {
        this.state.allocatedAudioStreams = (this.state.allocatedAudioStreams ?? []).filter(
            s => s.audioStreamId !== request.audioStreamId,
        );
    }

    override async videoStreamAllocate(request: CameraAvStreamManagement.VideoStreamAllocateRequest) {
        const usage = request.streamUsage ?? StreamUsage.LiveView;
        const cameraId = String(this.endpoint.id);
        const streams = [...(this.state.allocatedVideoStreams ?? [])];

        const existing = streams.find(s => s.streamUsage === usage);
        if (existing) {
            return new AvMgmt.VideoStreamAllocateResponse({ videoStreamId: existing.videoStreamId });
        }

        const stream = createDefaultVideoStream(usage);
        if (usage === StreamUsage.Recording) {
            stream.videoStreamId = 2;
            logger.info(
                `VideoStreamAllocate Recording camera=${cameraId} streamId=2 `
                + '(Push AV Stream Transport not implemented — cloud recording will not upload clips)',
            );
        } else {
            stream.videoStreamId = 1;
        }

        streams.push(stream);
        this.state.allocatedVideoStreams = streams;
        return new AvMgmt.VideoStreamAllocateResponse({ videoStreamId: stream.videoStreamId });
    }

    override async videoStreamDeallocate(request: CameraAvStreamManagement.VideoStreamDeallocateRequest) {
        this.state.allocatedVideoStreams = (this.state.allocatedVideoStreams ?? []).filter(
            s => s.videoStreamId !== request.videoStreamId,
        );
    }

    override async snapshotStreamAllocate(request: CameraAvStreamManagement.SnapshotStreamAllocateRequest) {
        const streams = this.state.allocatedSnapshotStreams ?? [];
        if (streams.length > 0) {
            return new AvMgmt.SnapshotStreamAllocateResponse({ snapshotStreamId: streams[0].snapshotStreamId });
        }

        const stream = createDefaultSnapshotStream();
        stream.imageCodec = request.imageCodec ?? stream.imageCodec;
        stream.frameRate = request.maxFrameRate ?? stream.frameRate;
        stream.minResolution = request.minResolution ?? stream.minResolution;
        stream.maxResolution = request.maxResolution ?? stream.maxResolution;
        this.state.allocatedSnapshotStreams = [stream];

        return new AvMgmt.SnapshotStreamAllocateResponse({ snapshotStreamId: stream.snapshotStreamId });
    }

    override async snapshotStreamDeallocate(request: CameraAvStreamManagement.SnapshotStreamDeallocateRequest) {
        this.state.allocatedSnapshotStreams = (this.state.allocatedSnapshotStreams ?? []).filter(
            s => s.snapshotStreamId !== request.snapshotStreamId,
        );
    }

    override async captureSnapshot(request: CameraAvStreamManagement.CaptureSnapshotRequest) {
        const go2rtc = streamContext.go2rtc;
        if (!go2rtc) throw new Error('go2rtc client not initialized');

        const cameraId = String(this.endpoint.id);
        let maxWidth = clampSnapshotWidth(request.requestedResolution?.width);
        let maxHeight: number | undefined;

        if (!go2rtc.isRegistered(cameraId)) {
            logger.error(
                `CaptureSnapshot camera=${cameraId} — no go2rtc stream (orphan Matter endpoint? check cameras.json vs matter-storage)`,
            );
            throw new Error(`Camera ${cameraId} is not registered in go2rtc`);
        }

        logger.info(`CaptureSnapshot camera=${cameraId} maxWidth=${maxWidth} (aspect preserved)`);

        let jpeg: Uint8Array;
        try {
            jpeg = await go2rtc.captureFrame(cameraId, maxWidth, maxHeight);
            while (jpeg.byteLength > MAX_SNAPSHOT_BYTES && maxWidth > MIN_SNAPSHOT_WIDTH) {
                maxWidth = Math.max(MIN_SNAPSHOT_WIDTH, Math.round(maxWidth * 0.75));
                logger.info(`CaptureSnapshot retry maxWidth=${maxWidth} (was ${jpeg.byteLength} bytes)`);
                jpeg = await go2rtc.captureFrame(cameraId, maxWidth, maxHeight);
            }
            // High-detail scenes can still exceed Matter frame limits at min width — cap height too.
            if (jpeg.byteLength > MAX_SNAPSHOT_BYTES) {
                maxHeight = 360;
                logger.info(`CaptureSnapshot retry maxHeight=${maxHeight} (was ${jpeg.byteLength} bytes)`);
                jpeg = await go2rtc.captureFrame(cameraId, maxWidth, maxHeight);
            }
            if (jpeg.byteLength > MAX_SNAPSHOT_BYTES) {
                maxHeight = 240;
                jpeg = await go2rtc.captureFrame(cameraId, maxWidth, maxHeight);
            }
            if (jpeg.byteLength > MAX_SNAPSHOT_BYTES) {
                throw new Error(`JPEG still ${jpeg.byteLength} bytes after resize (Matter limit ${MAX_SNAPSHOT_BYTES})`);
            }
        } catch (error) {
            logger.error(`CaptureSnapshot failed camera=${cameraId}: ${error}`);
            throw error;
        }

        jpeg = normalizeJpeg(jpeg);
        const dimensions = readJpegDimensions(jpeg) ?? { width: maxWidth, height: Math.round(maxWidth * 9 / 16) };

        logger.info(
            `CaptureSnapshot done camera=${cameraId} ${dimensions.width}x${dimensions.height} `
            + `${jpeg.byteLength} bytes`,
        );

        return new AvMgmt.CaptureSnapshotResponse({
            data: jpeg,
            imageCodec: AvMgmt.ImageCodec.Jpeg,
            resolution: dimensions,
        });
    }
}
