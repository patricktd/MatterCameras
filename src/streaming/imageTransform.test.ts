import assert from 'node:assert/strict';
import {
    buildFfmpegSrc,
    buildFfmpegVideoFilter,
    imageTransformFromMatterState,
    isIdentityTransform,
    transformsEqual,
} from './imageTransform.js';

// Minimal regression checks — run: node --import tsx src/streaming/imageTransform.test.ts

assert.equal(isIdentityTransform(imageTransformFromMatterState({})), true);
assert.equal(
    buildFfmpegSrc('rtsp://cam/stream', imageTransformFromMatterState({}), { audio: true }),
    'ffmpeg:rtsp://cam/stream#video=h264#audio=opus',
);
assert.equal(
    buildFfmpegSrc('rtsp://cam/stream', imageTransformFromMatterState({}), {}),
    'rtsp://cam/stream',
);

const flipH = imageTransformFromMatterState({ imageFlipHorizontal: true });
assert.equal(buildFfmpegVideoFilter(flipH), 'hflip');
assert.ok(buildFfmpegSrc('rtsp://cam/stream', flipH, {}).includes('#raw=-vf hflip'));

const rot90 = imageTransformFromMatterState({ imageRotation: 90 });
assert.equal(buildFfmpegVideoFilter(rot90), 'transpose=1');

const combo = imageTransformFromMatterState({
    imageRotation: 180,
    imageFlipHorizontal: true,
    imageFlipVertical: true,
});
assert.equal(buildFfmpegVideoFilter(combo), 'transpose=1,transpose=1,hflip,vflip');

assert.equal(transformsEqual(flipH, { ...flipH }), true);
assert.equal(transformsEqual(flipH, imageTransformFromMatterState({ imageFlipVertical: true })), false);

console.log('imageTransform.test.ts: ok');
