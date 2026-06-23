/**
 * Matter ImageControl → go2rtc ffmpeg source params.
 * Identity transform must produce the same URLs as before (no extra ffmpeg on snapshot path).
 */

export interface ImageTransform {
    flipHorizontal: boolean;
    flipVertical: boolean;
    /** Matter ImageRotation attribute (0–359). Applied before flips in the ffmpeg chain. */
    rotationDegrees: number;
}

export const IDENTITY_IMAGE_TRANSFORM: ImageTransform = {
    flipHorizontal: false,
    flipVertical: false,
    rotationDegrees: 0,
};

export function imageTransformFromMatterState(state: {
    imageFlipHorizontal?: boolean;
    imageFlipVertical?: boolean;
    imageRotation?: number;
}): ImageTransform {
    return {
        flipHorizontal: state.imageFlipHorizontal === true,
        flipVertical: state.imageFlipVertical === true,
        rotationDegrees: normalizeRotationDegrees(state.imageRotation ?? 0),
    };
}

export function normalizeRotationDegrees(degrees: number): number {
    const n = Math.round(degrees) % 360;
    return n < 0 ? n + 360 : n;
}

export function isIdentityTransform(transform: ImageTransform): boolean {
    return !transform.flipHorizontal
        && !transform.flipVertical
        && normalizeRotationDegrees(transform.rotationDegrees) === 0;
}

export function transformsEqual(a: ImageTransform, b: ImageTransform): boolean {
    return a.flipHorizontal === b.flipHorizontal
        && a.flipVertical === b.flipVertical
        && normalizeRotationDegrees(a.rotationDegrees) === normalizeRotationDegrees(b.rotationDegrees);
}

/** ffmpeg -vf chain: rotation (90° steps or arbitrary) then hflip/vflip. */
export function buildFfmpegVideoFilter(transform: ImageTransform): string | undefined {
    const parts: string[] = [];
    const rotation = normalizeRotationDegrees(transform.rotationDegrees);

    if (rotation === 90) {
        parts.push('transpose=1');
    } else if (rotation === 180) {
        parts.push('transpose=1,transpose=1');
    } else if (rotation === 270) {
        parts.push('transpose=2');
    } else if (rotation !== 0) {
        const rad = (rotation * Math.PI / 180).toFixed(6);
        parts.push(`rotate=${rad}:ow=rotw(iw):oh=roth(ih)`);
    }

    if (transform.flipHorizontal) parts.push('hflip');
    if (transform.flipVertical) parts.push('vflip');

    return parts.length > 0 ? parts.join(',') : undefined;
}

export interface FfmpegSrcOptions {
    /** Include Opus audio track (WebRTC live view). */
    audio?: boolean;
}

/**
 * Build a go2rtc ffmpeg: source URL.
 * Without transform: WebRTC uses h264+opus; snapshot path uses raw RTSP (caller passes audio:false).
 */
export function buildFfmpegSrc(rtspUrl: string, transform: ImageTransform, opts: FfmpegSrcOptions = {}): string {
    if (rtspUrl.startsWith('ffmpeg:')) {
        return rtspUrl;
    }

    const filter = buildFfmpegVideoFilter(transform);
    if (!filter) {
        if (opts.audio) {
            return `ffmpeg:${rtspUrl}#video=h264#audio=opus`;
        }
        return rtspUrl;
    }

    let src = `ffmpeg:${rtspUrl}#video=h264#raw=-vf ${filter}`;
    if (opts.audio) {
        src += '#audio=opus';
    }
    return src;
}
