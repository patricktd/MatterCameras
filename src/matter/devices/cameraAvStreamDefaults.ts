import { CameraAvStreamManagement } from '@matter/types/clusters/camera-av-stream-management';
import { StreamUsage } from '@matter/types';
import {
    createDefaultAudioStream,
    createDefaultSnapshotStream,
    createDefaultVideoStream,
} from './cameraStreamFactories.js';

const AvMgmt = CameraAvStreamManagement;

/**
 * Initial CameraAvStreamManagement state for Matter Camera device type (0x0142).
 * Requires Video + Audio + Snapshot features per spec.
 */
export function cameraAvStreamDefaults(): Partial<CameraAvStreamManagement.Attributes> {
    return {
        maxContentBufferSize: 1_000_000,
        maxNetworkBandwidth: 4_000_000,
        supportedStreamUsages: [StreamUsage.LiveView],
        streamUsagePriorities: [StreamUsage.LiveView],
        maxConcurrentEncoders: 1,
        maxEncodedPixelRate: 2_073_600,
        videoSensorParams: {
            sensorWidth: 1920,
            sensorHeight: 1080,
            maxFps: 30,
        },
        minViewportResolution: { width: 640, height: 360 },
        viewport: { x1: 0, y1: 0, x2: 1920, y2: 1080 },
        rateDistortionTradeOffPoints: [{
            codec: AvMgmt.VideoCodec.H264,
            resolution: { width: 1920, height: 1080 },
            minBitRate: 500_000,
        }],
        currentFrameRate: 30,
        microphoneCapabilities: {
            maxNumberOfChannels: 1,
            supportedCodecs: [AvMgmt.AudioCodec.Opus],
            supportedSampleRates: [48_000],
            supportedBitDepths: [16],
        },
        allocatedAudioStreams: [createDefaultAudioStream()],
        allocatedVideoStreams: [createDefaultVideoStream()],
        allocatedSnapshotStreams: [createDefaultSnapshotStream()],
        speakerCapabilities: {
            maxNumberOfChannels: 1,
            supportedCodecs: [AvMgmt.AudioCodec.Opus],
            supportedSampleRates: [48_000],
            supportedBitDepths: [16],
        },
        twoWayTalkSupport: AvMgmt.TwoWayTalkSupportType.NotSupported,
        speakerMuted: true,
        speakerVolumeLevel: 128,
        speakerMaxLevel: 254,
        speakerMinLevel: 0,
        microphoneMuted: true,
        microphoneVolumeLevel: 128,
        microphoneMaxLevel: 254,
        microphoneMinLevel: 0,
        snapshotCapabilities: [{
            resolution: { width: 640, height: 360 },
            maxFrameRate: 1,
            imageCodec: AvMgmt.ImageCodec.Jpeg,
            requiresEncodedPixels: false,
        }],
        imageFlipHorizontal: false,
        imageFlipVertical: false,
    };
}
