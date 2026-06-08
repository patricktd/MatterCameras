import { CameraAvStreamManagement } from '@matter/types/clusters/camera-av-stream-management';
import { StreamUsage } from '@matter/types';

const AvMgmt = CameraAvStreamManagement;

export function createDefaultVideoStream(usage: StreamUsage = StreamUsage.LiveView): CameraAvStreamManagement.VideoStream {
    return {
        videoStreamId: 1,
        streamUsage: usage,
        videoCodec: AvMgmt.VideoCodec.H264,
        minFrameRate: 15,
        maxFrameRate: 30,
        minResolution: { width: 640, height: 360 },
        maxResolution: { width: 1920, height: 1080 },
        minBitRate: 500_000,
        maxBitRate: 4_000_000,
        keyFrameInterval: 4000,
        referenceCount: 0,
    };
}

export function createDefaultAudioStream(usage: StreamUsage = StreamUsage.LiveView): CameraAvStreamManagement.AudioStream {
    return {
        audioStreamId: 1,
        streamUsage: usage,
        audioCodec: AvMgmt.AudioCodec.Opus,
        channelCount: 1,
        sampleRate: 48_000,
        bitRate: 64_000,
        bitDepth: 16,
        referenceCount: 0,
    };
}

export function createDefaultSnapshotStream(): CameraAvStreamManagement.SnapshotStream {
    return {
        snapshotStreamId: 1,
        imageCodec: AvMgmt.ImageCodec.Jpeg,
        frameRate: 1,
        minResolution: { width: 640, height: 360 },
        maxResolution: { width: 1920, height: 1080 },
        quality: 80,
        referenceCount: 0,
        encodedPixels: false,
        hardwareEncoder: false,
    };
}
