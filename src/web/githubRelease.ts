import { compareVersions, isNewerVersion } from '../utils/compareVersions.js';

// Repo polled for release/update notifications. Defaults to the upstream repo so a
// fresh clone behaves as before; override with the GITHUB_REPO env var (e.g. a fork)
// without editing source — see docker-compose.yml / .env.
const GITHUB_REPO = process.env.GITHUB_REPO?.trim() || 'patricktd/MatterCameras';
const CACHE_TTL_MS = 60 * 60 * 1000;

interface GitHubRelease {
    tag_name: string;
    html_url: string;
    body: string;
    published_at: string;
    draft: boolean;
}

interface CachedRelease {
    fetchedAt: number;
    release: GitHubRelease | null;
    error: string | null;
}

let cache: CachedRelease | null = null;

function normalizeTag(tag: string): string {
    return tag.trim().replace(/^v/i, '');
}

function pickLatestRelease(releases: GitHubRelease[]): GitHubRelease | null {
    const published = releases.filter((release) => !release.draft && release.tag_name);
    if (published.length === 0) {
        return null;
    }

    return published.reduce((latest, candidate) => {
        try {
            return compareVersions(normalizeTag(candidate.tag_name), normalizeTag(latest.tag_name)) > 0
                ? candidate
                : latest;
        } catch {
            return latest;
        }
    });
}

interface GitHubTag {
    name: string;
}

function pickLatestTag(tags: GitHubTag[]): string | null {
    const named = tags.map((tag) => tag.name).filter(Boolean);
    if (named.length === 0) {
        return null;
    }

    return named.reduce((latest, candidate) => {
        try {
            return compareVersions(normalizeTag(candidate), normalizeTag(latest)) > 0
                ? candidate
                : latest;
        } catch {
            return latest;
        }
    });
}

async function fetchLatestRelease(): Promise<CachedRelease> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    try {
        const response = await fetch(
            `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`,
            {
                headers: {
                    Accept: 'application/vnd.github+json',
                    'User-Agent': 'Matter-Cameras-Bridge',
                },
                signal: controller.signal,
            },
        );

        if (!response.ok) {
            return {
                fetchedAt: Date.now(),
                release: null,
                error: response.status === 404
                    ? 'No GitHub releases published yet.'
                    : `GitHub API returned ${response.status}`,
            };
        }

        const releases = await response.json() as GitHubRelease[];
        let release = pickLatestRelease(releases);

        if (!release) {
            const tagsResponse = await fetch(
                `https://api.github.com/repos/${GITHUB_REPO}/tags?per_page=30`,
                {
                    headers: {
                        Accept: 'application/vnd.github+json',
                        'User-Agent': 'Matter-Cameras-Bridge',
                    },
                    signal: controller.signal,
                },
            );

            if (tagsResponse.ok) {
                const tags = await tagsResponse.json() as GitHubTag[];
                const latestTag = pickLatestTag(tags);
                if (latestTag) {
                    release = {
                        tag_name: latestTag,
                        html_url: `https://github.com/${GITHUB_REPO}/releases/tag/${latestTag}`,
                        body: '',
                        published_at: '',
                        draft: false,
                    };
                }
            }
        }

        if (!release) {
            return {
                fetchedAt: Date.now(),
                release: null,
                error: 'No GitHub releases published yet.',
            };
        }

        return { fetchedAt: Date.now(), release, error: null };
    } catch (error) {
        return {
            fetchedAt: Date.now(),
            release: null,
            error: error instanceof Error ? error.message : String(error),
        };
    } finally {
        clearTimeout(timeout);
    }
}

export async function getLatestReleaseInfo(currentVersion: string) {
    const now = Date.now();
    if (!cache || now - cache.fetchedAt > CACHE_TTL_MS) {
        cache = await fetchLatestRelease();
    }

    const latestVersion = cache.release ? normalizeTag(cache.release.tag_name) : null;
    const updateAvailable = Boolean(latestVersion && isNewerVersion(latestVersion, currentVersion));

    return {
        currentVersion,
        latestVersion,
        updateAvailable,
        releaseUrl: cache.release?.html_url ?? `https://github.com/${GITHUB_REPO}/releases`,
        releaseNotes: cache.release?.body?.trim() || null,
        publishedAt: cache.release?.published_at ?? null,
        checkError: cache.error,
        repositoryUrl: `https://github.com/${GITHUB_REPO}`,
    };
}
