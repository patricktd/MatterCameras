import { CameraAvStreamManagementServer as BaseCameraAvStreamManagementServer } from '@matter/main/behaviors/camera-av-stream-management';
import { CameraAvStreamManagement } from '@matter/types/clusters/camera-av-stream-management';
import { StreamUsage } from '@matter/types';
import { Logger } from '@matter/general';
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
const DEFAULT_SNAPSHOT_WIDTH = 640;
const DEFAULT_SNAPSHOT_HEIGHT = 360;

function clampSnapshotResolution(width?: number, height?: number) {
    let w = width ?? DEFAULT_SNAPSHOT_WIDTH;
    let h = height ?? DEFAULT_SNAPSHOT_HEIGHT;
    if (w > DEFAULT_SNAPSHOT_WIDTH || h > DEFAULT_SNAPSHOT_HEIGHT) {
        const scale = Math.min(DEFAULT_SNAPSHOT_WIDTH / w, DEFAULT_SNAPSHOT_HEIGHT / h);
        w = Math.max(320, Math.round(w * scale));
        h = Math.max(240, Math.round(h * scale));
    }
    return { width: w, height: h };
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
        const streams = this.state.allocatedAudioStreams ?? [];
        if (streams.length > 0) {
            return new AvMgmt.AudioStreamAllocateResponse({ audioStreamId: streams[0].audioStreamId });
        }

        const stream = createDefaultAudioStream(request.streamUsage ?? StreamUsage.LiveView);
        stream.audioCodec = request.audioCodec ?? stream.audioCodec;
        stream.channelCount = request.channelCount ?? stream.channelCount;
        stream.sampleRate = request.sampleRate ?? stream.sampleRate;
        stream.bitRate = request.bitRate ?? stream.bitRate;
        this.state.allocatedAudioStreams = [stream];

        return new AvMgmt.AudioStreamAllocateResponse({ audioStreamId: stream.audioStreamId });
    }

    override async audioStreamDeallocate(request: CameraAvStreamManagement.AudioStreamDeallocateRequest) {
        this.state.allocatedAudioStreams = (this.state.allocatedAudioStreams ?? []).filter(
            s => s.audioStreamId !== request.audioStreamId,
        );
    }

    override async videoStreamAllocate(request: CameraAvStreamManagement.VideoStreamAllocateRequest) {
        const streams = this.state.allocatedVideoStreams ?? [];
        if (streams.length > 0) {
            return new AvMgmt.VideoStreamAllocateResponse({ videoStreamId: streams[0].videoStreamId });
        }

        const stream = createDefaultVideoStream(request.streamUsage ?? StreamUsage.LiveView);
        this.state.allocatedVideoStreams = [stream];
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
        let { width, height } = clampSnapshotResolution(
            request.requestedResolution?.width,
            request.requestedResolution?.height,
        );

        logger.info(`CaptureSnapshot camera=${cameraId} ${width}x${height}`);

        let jpeg = await go2rtc.captureFrame(cameraId, width, height);
        while (jpeg.byteLength > MAX_SNAPSHOT_BYTES && width > 320 && height > 240) {
            width = Math.round(width * 0.75);
            height = Math.round(height * 0.75);
            logger.info(`CaptureSnapshot retry smaller ${width}x${height} (was ${jpeg.byteLength} bytes)`);
            jpeg = await go2rtc.captureFrame(cameraId, width, height);
        }

        logger.info(`CaptureSnapshot done ${jpeg.byteLength} bytes`);

        return new AvMgmt.CaptureSnapshotResponse({
            data: jpeg,
            imageCodec: AvMgmt.ImageCodec.Jpeg,
            resolution: { width, height },
        });
    }
}
