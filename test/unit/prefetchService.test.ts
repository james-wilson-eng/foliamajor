import { beforeEach, describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import { clearPrefetchRuntime, getPrefetchWindowKey, getPrefetchedData, shouldRefreshPrefetchAfterQueueEdit, updatePrefetchedAudioUrl } from '@/services/prefetchService';

// test/unit/prefetchService.test.ts

const song: SongResult = {
    id: 'prefetch-song',
    name: 'Song',
    artists: [],
    album: { id: 'album', name: 'Album' },
    durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: 'prefetch-song' },
};

describe('prefetched online ReplayGain metadata', () => {
    beforeEach(() => clearPrefetchRuntime());

    it('keeps ReplayGain alongside a prefetched URL', () => {
        updatePrefetchedAudioUrl(song, 'https://audio.test/song.flac', 'high', {
            trackGain: -7.1,
            trackPeak: 0.9,
        });

        expect(getPrefetchedData(song, 'high')).toMatchObject({
            audioUrl: 'https://audio.test/song.flac',
            replayGain: { trackGain: -7.1, trackPeak: 0.9 },
        });
    });

    it('keeps the media-cache sentinel, which has no quality to mismatch', () => {
        // 'CACHED_IN_DB' says the bytes are already on disk. It is not a URL, so there is nothing
        // to re-fetch at a different quality - but the mismatch branch answered by nulling it,
        // and a cached track therefore reported itself as uncached the first time anything asked.
        updatePrefetchedAudioUrl(song, 'CACHED_IN_DB', 'standard');

        expect(getPrefetchedData(song, 'hires')).toMatchObject({ audioUrl: 'CACHED_IN_DB' });
    });

    it('invalidates URL metadata together on a quality mismatch', () => {
        updatePrefetchedAudioUrl(song, 'https://audio.test/song.flac', 'high', { trackGain: -7.1 });

        expect(getPrefetchedData(song, 'lossless')).toMatchObject({
            audioUrl: null,
            replayGain: undefined,
        });
    });
});

describe('prefetch window key', () => {
    const track = (id: string): SongResult => ({
        ...song,
        id,
        sourceRef: { kind: 'online', providerId: 'netease', mediaId: id },
    });
    const queue = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(track);

    it('changes only when the songs around the playing one change', () => {
        const current = queue[2];
        const window = getPrefetchWindowKey(current, queue);
        // 窗口（b c d e）外的编辑（把 g 挪到 f 前面）不需要重新预取。
        expect(getPrefetchWindowKey(current, [queue[0], queue[1], queue[2], queue[3], queue[4], queue[6], queue[5]])).toBe(window);
        // 下一首换了（把 f 挪到正在播放的下一首）就要。
        expect(getPrefetchWindowKey(current, [queue[0], queue[1], queue[2], queue[5], queue[3], queue[4], queue[6]])).not.toBe(window);
        // 上一首换了也要（「上一首」是预取的）。
        expect(getPrefetchWindowKey(current, [queue[1], queue[0], queue[2], queue[3], queue[4], queue[5], queue[6]])).not.toBe(window);
    });

    it('is empty when the playing song is not in the queue', () => {
        expect(getPrefetchWindowKey(track('z'), queue)).toBe('');
    });
});

describe('prefetch refresh after an in-place queue edit', () => {
    const track = (id: string): SongResult => ({
        ...song,
        id,
        sourceRef: { kind: 'online', providerId: 'netease', mediaId: id },
    });
    const queue = ['a', 'b', 'c', 'd', 'e', 'f'].map(track);
    const current = queue[1];

    it('refreshes only when the window around the playing song changed', () => {
        expect(shouldRefreshPrefetchAfterQueueEdit(current, queue, [queue[0], queue[1], queue[4], queue[2], queue[3], queue[5]])).toBe(true);
        expect(shouldRefreshPrefetchAfterQueueEdit(current, queue, [queue[0], queue[1], queue[2], queue[3], queue[5], queue[4]])).toBe(false);
        expect(shouldRefreshPrefetchAfterQueueEdit(current, queue, queue)).toBe(false);
        expect(shouldRefreshPrefetchAfterQueueEdit(null, queue, [...queue].reverse())).toBe(false);
    });

    it('leaves the prefetch alone when the playing song was removed from the queue', () => {
        // 新窗口键为空：invalidateAndRefetch 会删掉当前歌的预取、中止邻近预取又不重启，所以不刷新。
        expect(shouldRefreshPrefetchAfterQueueEdit(current, queue, queue.filter(item => item !== current))).toBe(false);
    });

    it('does not refresh a queue left with only the playing song', () => {
        expect(shouldRefreshPrefetchAfterQueueEdit(current, queue, [current])).toBe(false);
    });
});
