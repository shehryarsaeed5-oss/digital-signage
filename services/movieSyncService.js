const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const {
  countMoviesByLocalPosterPath,
  deleteMovieById,
  deleteMovieShowtimes,
  getMovieByTitleAndStatus,
  insertMovieShowtimes,
  listMoviesBySourceName,
  upsertMovie,
} = require('../repositories/movieSyncRepository');

const CUE_BASE_URL = 'https://cuecinemas.com';
const NOW_SHOWING_URL = `${CUE_BASE_URL}/Browsing/Movies/NowShowing`;
const COMING_SOON_URL = `${CUE_BASE_URL}/Browsing/Movies/ComingSoon`;
const REQUEST_TIMEOUT_MS = 10000;
const SOURCE_NAME = 'CUE Cinemas';
const MOVIE_POSTERS_DIR = path.join(__dirname, '..', 'public', 'uploads_test', 'movies');
const MOVIE_POSTERS_PUBLIC_PATH = '/uploads_test/movies';
const HD_POSTER_WIDTH = '1000';
const HD_POSTER_HEIGHT = '1500';
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3';

let tmdbConfigurationCache = null;

const SELECTORS = {
  movieCardSplit: '<div class="list-item movie ',
  detailLink: /<a[^>]+href="([^"]*\/Browsing\/Movies\/Details\/[^"]+)"[^>]*>/i,
  title: /<h3[^>]*class="item-title"[^>]*>([\s\S]*?)<\/h3>/i,
  posterUrl:
    /<img[^>]+src="([^"]*FilmPosterGraphic[^"]*)"[^>]*>/i,
  synopsis: /<p[^>]*class="blurb subtext"[^>]*>([\s\S]*?)<\/p>/i,
  releaseDate: /<p[^>]*class="movie-opening-date"[^>]*>([\s\S]*?)<\/p>/i,
  openingDate: /<label>\s*Opening Date:\s*<\/label>\s*<span>([\s\S]*?)<\/span>/i,
  runtime: /<label>\s*Run Time:\s*<\/label>\s*<span>([\s\S]*?)<\/span>/i,
  genre: /<label>\s*Genre:\s*<\/label>\s*<span>([\s\S]*?)<\/span>/i,
  showTimesSection: /(<article id="show-times"[\s\S]*?<\/article>)/i,
  sessionSplit: /<div class="\s*(?:future\s+)?session">/i,
  sessionDate: /<h4[^>]*class="session-date"[^>]*>([\s\S]*?)<\/h4>/i,
  sessionTime: /<time[^>]*>([\s\S]*?)<\/time>/gi,
};

const IMAGE_CANDIDATE_PATTERNS = {
  imgSrc: /<img[^>]+\ssrc="([^"]+)"/gi,
  imgSrcSet: /<img[^>]+\ssrcset="([^"]+)"/gi,
  dataSrc: /\sdata-src="([^"]+)"/gi,
  dataImageUrl: /\sdata-image-url="([^"]+)"/gi,
  backgroundImage: /style="[^"]*background-image\s*:\s*url\((?:'|")?([^'")]+)(?:'|")?\)[^"]*"/gi,
  metaImage: /<meta[^>]+(?:property|name)="(?:og:image|twitter:image|twitter:image:src)"[^>]+content="([^"]+)"/gi,
  anchorImageHref: /<a[^>]+href="([^"]+)"[^>]*(?:lightbox|modal|poster|gallery)/gi,
};

function logSelectorFailure(selectorName, contextSnippet) {
  const snippet = contextSnippet.replace(/\s+/g, ' ').trim().slice(0, 240);
  console.warn(`[movieSyncService] Selector failed: ${selectorName}${snippet ? ` | snippet: ${snippet}` : ''}`);
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&hellip;/g, '...')
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&mdash;/g, '-')
    .replace(/&ndash;/g, '-')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripHtml(value) {
  return decodeHtml(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'movie';
}

function normalizeTitleForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseReleaseYear(value) {
  const match = String(value || '').match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function toAbsoluteUrl(url) {
  if (!url) {
    return '';
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  if (url.startsWith('//')) {
    return `https:${url}`;
  }

  return new URL(url, CUE_BASE_URL).toString();
}

function normalizePosterUrl(url) {
  const absoluteUrl = toAbsoluteUrl(url);
  if (!absoluteUrl) {
    return {
      originalUrl: '',
      preferredDownloadUrl: '',
      fallbackDownloadUrls: [],
    };
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(absoluteUrl);
  } catch (error) {
    return {
      originalUrl: absoluteUrl,
      preferredDownloadUrl: absoluteUrl,
      fallbackDownloadUrls: [],
    };
  }

  const isCuePosterGraphic = /\/CDN\/media\/entity\/get\/FilmPosterGraphic\//i.test(parsedUrl.pathname);
  if (!isCuePosterGraphic) {
    return {
      originalUrl: absoluteUrl,
      preferredDownloadUrl: absoluteUrl,
      fallbackDownloadUrls: [],
    };
  }

  const originalUrl = parsedUrl.toString();

  parsedUrl.searchParams.delete('width');
  parsedUrl.searchParams.delete('height');
  const originalSizeUrl = parsedUrl.toString();

  const hdUrl = new URL(originalSizeUrl);
  hdUrl.searchParams.set('width', HD_POSTER_WIDTH);
  hdUrl.searchParams.set('height', HD_POSTER_HEIGHT);

  const fallbackDownloadUrls = [hdUrl.toString()].filter((candidate) => candidate !== originalSizeUrl);

  return {
    originalUrl,
    preferredDownloadUrl: originalSizeUrl,
    fallbackDownloadUrls,
  };
}

function collectMatches(pattern, html) {
  return [...String(html || '').matchAll(pattern)].map((match) => match[1]).filter(Boolean);
}

function parseSrcSetUrls(srcSetValue) {
  return String(srcSetValue || '')
    .split(',')
    .map((entry) => entry.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function getCueImageKind(url) {
  const absoluteUrl = toAbsoluteUrl(url);

  if (/\/FilmPosterGraphic\//i.test(absoluteUrl)) {
    return 'poster';
  }

  if (/\/FilmBackdrop\//i.test(absoluteUrl)) {
    return 'backdrop';
  }

  if (/\/GalleryImage/i.test(absoluteUrl)) {
    return 'gallery';
  }

  return 'other';
}

function getCueImageDimensions(url) {
  try {
    const parsedUrl = new URL(toAbsoluteUrl(url));
    const width = Number(parsedUrl.searchParams.get('width'));
    const height = Number(parsedUrl.searchParams.get('height'));

    return {
      width: Number.isFinite(width) && width > 0 ? width : null,
      height: Number.isFinite(height) && height > 0 ? height : null,
    };
  } catch (error) {
    return {
      width: null,
      height: null,
    };
  }
}

function buildCueImageCandidate(url, selector) {
  const absoluteUrl = toAbsoluteUrl(decodeHtml(String(url || '').trim()));
  if (!absoluteUrl || !/cuecinemas\.com/i.test(absoluteUrl)) {
    return null;
  }

  const isLikelyMovieImage =
    /\/FilmPosterGraphic\//i.test(absoluteUrl) ||
    /\/FilmBackdrop\//i.test(absoluteUrl) ||
    /\/GalleryImage/i.test(absoluteUrl) ||
    /\/ImageAPI\/GetGalleryImageData/i.test(absoluteUrl) ||
    /fallbackMediaType=FilmTitleGraphic/i.test(absoluteUrl) ||
    /meta\[og\/twitter image\]/i.test(selector) ||
    /a\[href image candidate\]/i.test(selector);

  if (!isLikelyMovieImage) {
    return null;
  }

  const { width, height } = getCueImageDimensions(absoluteUrl);

  return {
    url: absoluteUrl,
    selector,
    kind: getCueImageKind(absoluteUrl),
    width,
    height,
  };
}

function extractCueImageCandidates(html, pageLabel) {
  const rawCandidates = [
    ...collectMatches(IMAGE_CANDIDATE_PATTERNS.imgSrc, html).map((url) => ({ url, selector: `${pageLabel}:img[src]` })),
    ...collectMatches(IMAGE_CANDIDATE_PATTERNS.dataSrc, html).map((url) => ({ url, selector: `${pageLabel}:[data-src]` })),
    ...collectMatches(IMAGE_CANDIDATE_PATTERNS.dataImageUrl, html).map((url) => ({ url, selector: `${pageLabel}:[data-image-url]` })),
    ...collectMatches(IMAGE_CANDIDATE_PATTERNS.backgroundImage, html).map((url) => ({ url, selector: `${pageLabel}:[style.background-image]` })),
    ...collectMatches(IMAGE_CANDIDATE_PATTERNS.metaImage, html).map((url) => ({ url, selector: `${pageLabel}:meta[og/twitter image]` })),
    ...collectMatches(IMAGE_CANDIDATE_PATTERNS.anchorImageHref, html).map((url) => ({ url, selector: `${pageLabel}:a[href image candidate]` })),
    ...collectMatches(IMAGE_CANDIDATE_PATTERNS.imgSrcSet, html).flatMap((srcSet) =>
      parseSrcSetUrls(srcSet).map((url) => ({ url, selector: `${pageLabel}:img[srcset]` }))
    ),
  ];

  const deduped = new Map();

  for (const rawCandidate of rawCandidates) {
    const candidate = buildCueImageCandidate(rawCandidate.url, rawCandidate.selector);
    if (!candidate) {
      continue;
    }

    const existing = deduped.get(candidate.url);
    if (existing) {
      existing.selectors = [...new Set([...(existing.selectors || [existing.selector]), candidate.selector])];
      continue;
    }

    deduped.set(candidate.url, {
      ...candidate,
      selectors: [candidate.selector],
    });
  }

  return [...deduped.values()];
}

function scoreCuePosterCandidate(candidate) {
  const kindScore = candidate.kind === 'poster' ? 1_000_000_000 : 0;
  const widthScore = candidate.width || 0;
  const heightScore = candidate.height || 0;
  const noResizeBonus = candidate.kind === 'poster' && !candidate.width && !candidate.height ? 10_000_000 : 0;
  return kindScore + noResizeBonus + (widthScore * heightScore) + widthScore + heightScore;
}

function selectBestCuePosterCandidate(currentPosterUrl, candidates = []) {
  const allCandidates = [];
  const currentCandidate = buildCueImageCandidate(currentPosterUrl, 'list:current poster');

  if (currentCandidate) {
    allCandidates.push({
      ...currentCandidate,
      selectors: [currentCandidate.selector],
    });
  }

  allCandidates.push(...candidates);

  const posterCandidates = allCandidates.filter((candidate) => candidate.kind === 'poster');
  if (posterCandidates.length === 0) {
    return {
      selected: currentCandidate,
      hadBetterDiscoveredPoster: false,
    };
  }

  posterCandidates.sort((left, right) => scoreCuePosterCandidate(right) - scoreCuePosterCandidate(left));
  const selected = posterCandidates[0];
  const currentScore = currentCandidate ? scoreCuePosterCandidate(currentCandidate) : -1;

  return {
    selected,
    hadBetterDiscoveredPoster: scoreCuePosterCandidate(selected) > currentScore,
  };
}

function formatPosterCandidateLogEntry(candidate) {
  const dimensionLabel = candidate.width || candidate.height
    ? `${candidate.width || '?'}x${candidate.height || '?'}`
    : 'original-size';

  return `${candidate.kind}:${dimensionLabel}:${candidate.url} [${(candidate.selectors || [candidate.selector]).join(', ')}]`;
}

function extractMatch(block, selectorName) {
  const pattern = SELECTORS[selectorName];
  const match = block.match(pattern);

  if (!match || !match[1]) {
    logSelectorFailure(selectorName, block);
    return '';
  }

  return match[1];
}

function extractOptionalMatch(block, selectorName) {
  const pattern = SELECTORS[selectorName];
  const match = block.match(pattern);
  return match && match[1] ? match[1] : '';
}

function parseShowtimes(showTimesSection) {
  if (!showTimesSection) {
    return [];
  }

  const sessions = [];
  const sessionBlocks = showTimesSection.split(SELECTORS.sessionSplit).slice(1);
  let currentDate = '';

  for (const sessionBlock of sessionBlocks) {
    const dateText = stripHtml(extractOptionalMatch(sessionBlock, 'sessionDate'));
    if (dateText) {
      currentDate = dateText;
    }

    const times = [...sessionBlock.matchAll(SELECTORS.sessionTime)]
      .map((timeMatch) => stripHtml(timeMatch[1]))
      .filter(Boolean);

    if (!currentDate || times.length === 0) {
      continue;
    }

    const existing = sessions.find((entry) => entry.date === currentDate);
    if (existing) {
      existing.times.push(...times);
      continue;
    }

    sessions.push({
      date: currentDate,
      times: [...times],
    });
  }

  return sessions.map((entry) => ({
    date: entry.date,
    times: [...new Set(entry.times)],
  }));
}

function createPosterBasename(title, posterUrl) {
  const titleSlug = slugify(title);
  const hash = crypto.createHash('sha1').update(posterUrl).digest('hex').slice(0, 10);
  return `${titleSlug}-${hash}`;
}

function getExtensionFromContentType(contentType = '') {
  const normalized = contentType.split(';')[0].trim().toLowerCase();
  const extensions = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
  };

  return extensions[normalized] || '.jpg';
}

function getExtensionFromUrl(url) {
  try {
    const extension = path.extname(new URL(url).pathname).toLowerCase();
    return extension || '';
  } catch (error) {
    return '';
  }
}

async function downloadFirstAvailableFile(urls = []) {
  let lastError = null;

  for (const url of urls) {
    try {
      const downloaded = await downloadFile(url);
      return {
        ...downloaded,
        downloadedUrl: url,
      };
    } catch (error) {
      lastError = error;
      console.warn(`[movie-sync] poster download candidate failed | url=${url} | error=${error.message}`);
    }
  }

  throw lastError || new Error('No poster download URL candidates were available');
}

function fetchJson(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          accept: 'application/json',
          'user-agent': 'DigitalSignMovieSync/1.0',
        },
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();

          if (redirectCount >= 5) {
            reject(new Error(`Too many redirects fetching JSON ${url}`));
            return;
          }

          resolve(fetchJson(toAbsoluteUrl(response.headers.location), redirectCount + 1));
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Failed to fetch JSON ${url}: HTTP ${response.statusCode}`));
          return;
        }

        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error(`Invalid JSON received from ${url}: ${error.message}`));
          }
        });
      }
    );

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms: ${url}`));
    });
    request.on('error', reject);
  });
}

function buildTmdbApiUrl(pathname, params = {}) {
  const url = new URL(`${TMDB_API_BASE_URL}${pathname}`);
  url.searchParams.set('api_key', TMDB_API_KEY);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

async function getTmdbConfiguration() {
  if (!TMDB_API_KEY) {
    return null;
  }

  if (tmdbConfigurationCache) {
    return tmdbConfigurationCache;
  }

  const response = await fetchJson(buildTmdbApiUrl('/configuration'));
  const images = response?.images || {};
  const posterSizes = Array.isArray(images.poster_sizes) ? images.poster_sizes : [];
  const secureBaseUrl = images.secure_base_url || images.base_url || '';

  if (!secureBaseUrl || posterSizes.length === 0) {
    throw new Error('TMDB configuration is missing image base URL or poster sizes');
  }

  const preferredPosterSize = posterSizes.includes('original')
    ? 'original'
    : posterSizes[posterSizes.length - 1];

  tmdbConfigurationCache = {
    secureBaseUrl,
    posterSizes,
    preferredPosterSize,
  };

  return tmdbConfigurationCache;
}

function scoreTmdbMovieMatch(result, cueTitle, cueReleaseYear) {
  const normalizedCueTitle = normalizeTitleForMatch(cueTitle);
  const normalizedTmdbTitle = normalizeTitleForMatch(result?.title || result?.name || '');
  const tmdbReleaseYear = parseReleaseYear(result?.release_date || result?.first_air_date || '');

  let score = 0;

  if (normalizedTmdbTitle === normalizedCueTitle) {
    score += 1000;
  } else if (
    normalizedTmdbTitle.includes(normalizedCueTitle) ||
    normalizedCueTitle.includes(normalizedTmdbTitle)
  ) {
    score += 700;
  }

  if (cueReleaseYear && tmdbReleaseYear) {
    if (tmdbReleaseYear === cueReleaseYear) {
      score += 500;
    } else {
      score -= Math.min(200, Math.abs(tmdbReleaseYear - cueReleaseYear) * 25);
    }
  }

  if (result?.poster_path) {
    score += 250;
  }

  score += Math.max(0, Number(result?.popularity || 0));

  return score;
}

async function searchTmdbMovie(movie) {
  if (!TMDB_API_KEY) {
    return {
      matched: false,
      reason: 'TMDB_API_KEY is not configured',
    };
  }

  const cueReleaseYear = parseReleaseYear(movie.openingDate || movie.releaseDate);
  const response = await fetchJson(
    buildTmdbApiUrl('/search/movie', {
      query: movie.title,
      year: cueReleaseYear || undefined,
      include_adult: 'false',
    })
  );

  const results = Array.isArray(response?.results) ? response.results : [];
  if (results.length === 0) {
    return {
      matched: false,
      reason: 'No TMDB search results',
    };
  }

  const rankedResults = [...results]
    .map((result) => ({
      result,
      score: scoreTmdbMovieMatch(result, movie.title, cueReleaseYear),
    }))
    .sort((left, right) => right.score - left.score);

  const best = rankedResults[0];
  if (!best || !best.result) {
    return {
      matched: false,
      reason: 'No ranked TMDB result',
    };
  }

  if (!best.result.poster_path) {
    return {
      matched: false,
      reason: 'Best TMDB result has no poster_path',
      candidateTitle: best.result.title || best.result.name || '',
      candidateReleaseDate: best.result.release_date || best.result.first_air_date || '',
    };
  }

  const configuration = await getTmdbConfiguration();
  const posterUrl = `${configuration.secureBaseUrl}${configuration.preferredPosterSize}${best.result.poster_path}`;

  return {
    matched: true,
    tmdbId: best.result.id,
    matchedTitle: best.result.title || best.result.name || '',
    matchedReleaseDate: best.result.release_date || best.result.first_air_date || '',
    posterPath: best.result.poster_path,
    posterUrl,
    matchScore: best.score,
  };
}

async function resolvePosterForMovie(movie) {
  let tmdbResult = null;

  try {
    tmdbResult = await searchTmdbMovie(movie);
  } catch (error) {
    tmdbResult = {
      matched: false,
      reason: `TMDB lookup failed: ${error.message}`,
    };
  }

  console.log(
    `[movie-sync] tmdb match result | title="${movie.title}" | result=${
      tmdbResult?.matched
        ? `matched id=${tmdbResult.tmdbId} title="${tmdbResult.matchedTitle}" release="${tmdbResult.matchedReleaseDate}" score=${tmdbResult.matchScore}`
        : `no-match reason="${tmdbResult?.reason || 'Unknown'}"`
    }`
  );

  if (tmdbResult?.matched && tmdbResult.posterUrl) {
    console.log(`[movie-sync] selected poster source | title="${movie.title}" | source=tmdb`);
    console.log(`[movie-sync] final poster URL | title="${movie.title}" | url=${tmdbResult.posterUrl}`);
    return {
      posterSource: 'tmdb',
      remotePosterUrl: tmdbResult.posterUrl,
      remotePosterFallbackUrls: [],
    };
  }

  console.log(`[movie-sync] selected poster source | title="${movie.title}" | source=cue`);
  console.log(`[movie-sync] final poster URL | title="${movie.title}" | url=${movie.posterUrl}`);
  return {
    posterSource: 'cue',
    remotePosterUrl: movie.posterUrl,
    remotePosterFallbackUrls: movie.posterDownloadFallbackUrls || [],
  };
}

function fetchHtml(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          'user-agent': 'DigitalSignMovieSync/1.0',
        },
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();

          if (redirectCount >= 5) {
            reject(new Error(`Too many redirects fetching ${url}`));
            return;
          }

          resolve(fetchHtml(toAbsoluteUrl(response.headers.location), redirectCount + 1));
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Failed to fetch ${url}: HTTP ${response.statusCode}`));
          return;
        }

        let html = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          html += chunk;
        });
        response.on('end', () => resolve(html));
      }
    );

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms: ${url}`));
    });
    request.on('error', reject);
  });
}

function downloadFile(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          'user-agent': 'DigitalSignMovieSync/1.0',
        },
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();

          if (redirectCount >= 5) {
            reject(new Error(`Too many redirects downloading ${url}`));
            return;
          }

          resolve(downloadFile(toAbsoluteUrl(response.headers.location), redirectCount + 1));
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => {
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({
            buffer: Buffer.concat(chunks),
            contentType: response.headers['content-type'] || '',
          });
        });
      }
    );

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms: ${url}`));
    });
    request.on('error', reject);
  });
}

function parseMovieCards(html, { status, includeReleaseDate = false }) {
  const chunks = html.split(SELECTORS.movieCardSplit).slice(1);

  if (chunks.length === 0) {
    console.warn('[movieSyncService] Selector failed: movieCardSplit | no movie cards found');
    return [];
  }

  const deduped = new Map();

  for (const chunk of chunks) {
    const block = `${SELECTORS.movieCardSplit}${chunk}`;
    const title = stripHtml(extractMatch(block, 'title'));
    const detailsPageUrl = toAbsoluteUrl(decodeHtml(extractMatch(block, 'detailLink')));
    const scrapedPosterUrl = toAbsoluteUrl(decodeHtml(extractMatch(block, 'posterUrl')));
    const discoveredImageCandidates = extractCueImageCandidates(block, 'list');
    const synopsis = stripHtml(extractMatch(block, 'synopsis'));
    const releaseDate = includeReleaseDate ? stripHtml(extractMatch(block, 'releaseDate')) : undefined;

    if (!title || !detailsPageUrl || !scrapedPosterUrl) {
      console.warn(`[movieSyncService] Skipping incomplete movie card${title ? `: ${title}` : ''}`);
      continue;
    }

    const dedupeKey = title.toLowerCase();
    if (deduped.has(dedupeKey)) {
      continue;
    }

    deduped.set(dedupeKey, {
      title,
      detailsPageUrl,
      posterUrl: scrapedPosterUrl,
      scrapedPosterUrl,
      discoveredImageCandidates,
      synopsis,
      ...(includeReleaseDate ? { releaseDate } : {}),
      status,
    });
  }

  return [...deduped.values()];
}

async function scrapeNowShowing() {
  const html = await fetchHtml(NOW_SHOWING_URL);
  return parseMovieCards(html, {
    status: 'Now Showing',
  });
}

async function scrapeComingSoon() {
  const html = await fetchHtml(COMING_SOON_URL);
  return parseMovieCards(html, {
    status: 'Coming Soon',
    includeReleaseDate: true,
  });
}

async function scrapeMovieDetails(detailsPageUrl) {
  const html = await fetchHtml(toAbsoluteUrl(detailsPageUrl));
  const showTimesSection = extractOptionalMatch(html, 'showTimesSection');

  if (!showTimesSection) {
    console.warn('[movieSyncService] Selector failed: showTimesSection | no show-times article found');
  }

  return {
    openingDate: stripHtml(extractOptionalMatch(html, 'openingDate')),
    runtime: stripHtml(extractOptionalMatch(html, 'runtime')),
    genre: stripHtml(extractOptionalMatch(html, 'genre')),
    showtimesByDate: parseShowtimes(showTimesSection),
    discoveredImageCandidates: extractCueImageCandidates(html, 'detail'),
  };
}

async function enrichMovieWithDetails(movie, { includeShowtimes = false, includeOpeningDate = false } = {}) {
  try {
    const details = await scrapeMovieDetails(movie.detailsPageUrl);
    const discoveredImageCandidates = [
      ...(movie.discoveredImageCandidates || []),
      ...(details.discoveredImageCandidates || []),
    ];
    const bestCuePoster = selectBestCuePosterCandidate(movie.scrapedPosterUrl, discoveredImageCandidates);
    const selectedPosterUrl = bestCuePoster.selected?.url || movie.scrapedPosterUrl;
    const normalizedSelectedPoster = normalizePosterUrl(selectedPosterUrl);
    const posterUrl = normalizedSelectedPoster.preferredDownloadUrl || selectedPosterUrl;
    const posterDownloadFallbackUrls = normalizedSelectedPoster.fallbackDownloadUrls;

    console.log(`[movie-sync] poster current URL | title="${movie.title}" | url=${movie.scrapedPosterUrl}`);
    console.log(
      `[movie-sync] poster discovered candidates | title="${movie.title}" | urls=${
        discoveredImageCandidates.length > 0
          ? discoveredImageCandidates.map(formatPosterCandidateLogEntry).join(' | ')
          : 'none'
      }`
    );
    console.log(`[movie-sync] poster selected best Cue URL | title="${movie.title}" | url=${selectedPosterUrl}`);

    if (!bestCuePoster.hadBetterDiscoveredPoster) {
      console.log(
        `[movie-sync] poster candidate note | title="${movie.title}" | Cue only exposes the low-resolution poster in inspected page HTML; downloader fallback will try normalized poster URL variants`
      );
    }

    return {
      ...movie,
      posterUrl,
      posterDownloadFallbackUrls,
      ...(includeOpeningDate && details.openingDate ? { openingDate: details.openingDate } : {}),
      ...(details.runtime ? { runtime: details.runtime } : {}),
      ...(details.genre ? { genre: details.genre } : {}),
      ...(includeShowtimes ? { showtimesByDate: details.showtimesByDate } : {}),
      detailsSyncFailed: false,
    };
  } catch (error) {
    console.warn(`[movieSyncService] Failed to enrich movie details for "${movie.title}": ${error.message}`);

    return {
      ...movie,
      detailsSyncFailed: true,
    };
  }
}

async function getCueCinemaMovies() {
  const [nowShowing, comingSoon] = await Promise.all([
    scrapeNowShowing(),
    scrapeComingSoon(),
  ]);

  const [enrichedNowShowing, enrichedComingSoon] = await Promise.all([
    Promise.all(
      nowShowing.map((movie) =>
        enrichMovieWithDetails(movie, {
          includeShowtimes: true,
        })
      )
    ),
    Promise.all(
      comingSoon.map((movie) =>
        enrichMovieWithDetails(movie, {
          includeOpeningDate: true,
        })
      )
    ),
  ]);

  return {
    nowShowing: enrichedNowShowing,
    comingSoon: enrichedComingSoon,
  };
}

async function removeReplacedPoster(previousLocalPosterPath, nextLocalPosterPath) {
  if (!previousLocalPosterPath || previousLocalPosterPath === nextLocalPosterPath) {
    return;
  }

  const remainingReferences = await countMoviesByLocalPosterPath(previousLocalPosterPath);
  if (remainingReferences > 0) {
    return;
  }

  const previousAbsolutePath = toLocalPosterAbsolutePath(previousLocalPosterPath);
  if (previousAbsolutePath && fs.existsSync(previousAbsolutePath)) {
    fs.unlinkSync(previousAbsolutePath);
    console.log(`[movie-sync] removed replaced poster | path=${previousAbsolutePath}`);
  }
}

async function downloadMoviePoster(movie, existingMovie, options = {}) {
  const { forceRefresh = false } = options;
  fs.mkdirSync(MOVIE_POSTERS_DIR, { recursive: true });

  const resolvedPoster = await resolvePosterForMovie(movie);

  if (
    !forceRefresh &&
    existingMovie &&
    existingMovie.poster_source === resolvedPoster.posterSource &&
    existingMovie.poster_url === resolvedPoster.remotePosterUrl &&
    existingMovie.local_poster_path
  ) {
    const existingAbsolutePath = path.join(
      __dirname,
      '..',
      'public',
      existingMovie.local_poster_path.replace(/^\//, '').replace(/\//g, path.sep)
    );

    if (fs.existsSync(existingAbsolutePath)) {
      return {
        localPosterPath: existingMovie.local_poster_path,
        downloaded: false,
        posterSource: existingMovie.poster_source || resolvedPoster.posterSource,
        finalPosterUrl: existingMovie.poster_url,
      };
    }
  }

  const originalScrapedPosterUrl = movie.scrapedPosterUrl || movie.posterUrl;
  const normalizedPoster =
    resolvedPoster.posterSource === 'cue'
      ? normalizePosterUrl(resolvedPoster.remotePosterUrl || originalScrapedPosterUrl)
      : { preferredDownloadUrl: '', fallbackDownloadUrls: [] };
  const downloadCandidates = [
    resolvedPoster.remotePosterUrl,
    normalizedPoster.preferredDownloadUrl,
    ...(resolvedPoster.remotePosterFallbackUrls || []),
    ...(normalizedPoster.fallbackDownloadUrls || []),
  ].filter((candidate, index, allCandidates) => candidate && allCandidates.indexOf(candidate) === index);

  const { buffer, contentType, downloadedUrl } = await downloadFirstAvailableFile(downloadCandidates);
  const fileExtension = getExtensionFromUrl(downloadedUrl) || getExtensionFromContentType(contentType);
  const fileName = `${createPosterBasename(movie.title, downloadedUrl)}${fileExtension}`;
  const absolutePath = path.join(MOVIE_POSTERS_DIR, fileName);
  const localPosterPath = `${MOVIE_POSTERS_PUBLIC_PATH}/${fileName}`;
  const shouldWriteFile = forceRefresh || !fs.existsSync(absolutePath);

  console.log(`[movie-sync] poster original URL | title="${movie.title}" | url=${originalScrapedPosterUrl}`);
  console.log(`[movie-sync] poster normalized URL | title="${movie.title}" | url=${downloadedUrl}`);

  if (shouldWriteFile) {
    fs.writeFileSync(absolutePath, buffer);
    console.log(`[movie-sync] poster saved path | title="${movie.title}" | path=${absolutePath}`);
    return {
      localPosterPath,
      downloaded: true,
      posterSource: resolvedPoster.posterSource,
      finalPosterUrl: downloadedUrl,
    };
  }

  console.log(`[movie-sync] poster saved path | title="${movie.title}" | path=${absolutePath}`);
  return {
    localPosterPath,
    downloaded: false,
    posterSource: resolvedPoster.posterSource,
    finalPosterUrl: downloadedUrl,
  };
}

function flattenShowtimes(showtimesByDate = []) {
  return showtimesByDate.flatMap((entry) =>
    (entry.times || []).map((showTime) => ({
      show_date: entry.date,
      show_time: showTime,
    }))
  );
}

function buildMovieIdentityKey(movie) {
  return `${movie.title}::${movie.status}`;
}

function toLocalPosterAbsolutePath(localPosterPath) {
  if (!localPosterPath) {
    return '';
  }

  return path.join(
    __dirname,
    '..',
    'public',
    localPosterPath.replace(/^\//, '').replace(/\//g, path.sep)
  );
}

async function cleanupRemovedCueCinemaMovies(latestMovies) {
  const existingMovies = await listMoviesBySourceName(SOURCE_NAME);
  const latestKeys = new Set(latestMovies.map(buildMovieIdentityKey));

  let moviesRemoved = 0;
  let postersRemoved = 0;

  for (const existingMovie of existingMovies) {
    if (latestKeys.has(buildMovieIdentityKey(existingMovie))) {
      continue;
    }

    const localPosterPath = existingMovie.local_poster_path;

    await deleteMovieById(existingMovie.id);
    moviesRemoved += 1;

    if (!localPosterPath) {
      continue;
    }

    const remainingReferences = await countMoviesByLocalPosterPath(localPosterPath);
    if (remainingReferences > 0) {
      continue;
    }

    const absolutePosterPath = toLocalPosterAbsolutePath(localPosterPath);
    if (absolutePosterPath && fs.existsSync(absolutePosterPath)) {
      fs.unlinkSync(absolutePosterPath);
      postersRemoved += 1;
    }
  }

  return {
    moviesRemoved,
    postersRemoved,
  };
}

async function saveCueCinemaMovies(options = {}) {
  const { forcePosterRefresh = false } = options;
  const movies = await getCueCinemaMovies();
  const summary = {
    moviesSaved: 0,
    postersDownloaded: 0,
    moviesRemoved: 0,
    postersRemoved: 0,
    errorsCount: 0,
  };

  const allMovies = [...movies.nowShowing, ...movies.comingSoon];

  for (const movie of allMovies) {
    try {
      const existingMovie = await getMovieByTitleAndStatus(movie.title, movie.status);

      if (movie.detailsSyncFailed) {
        summary.errorsCount += 1;
        console.warn(`[movie-sync] keeping existing local data for "${movie.title}" because detail sync failed`);
        continue;
      }

      const previousLocalPosterPath = existingMovie?.local_poster_path || '';
      const { localPosterPath, downloaded, posterSource, finalPosterUrl } = await downloadMoviePoster(movie, existingMovie, {
        forceRefresh: forcePosterRefresh,
      });

      const savedMovie = await upsertMovie({
        title: movie.title,
        poster_source: posterSource,
        poster_url: finalPosterUrl || movie.posterUrl,
        local_poster_path: localPosterPath,
        status: movie.status,
        synopsis: movie.synopsis,
        release_date: movie.openingDate || movie.releaseDate || null,
        runtime: movie.runtime || null,
        genre: movie.genre || null,
        details_url: movie.detailsPageUrl,
        source_name: SOURCE_NAME,
      });

      if (movie.status === 'Now Showing') {
        await deleteMovieShowtimes(savedMovie.id);
        await insertMovieShowtimes(savedMovie.id, flattenShowtimes(movie.showtimesByDate));
      }

      await removeReplacedPoster(previousLocalPosterPath, localPosterPath);

      summary.moviesSaved += 1;
      if (downloaded) {
        summary.postersDownloaded += 1;
      }
    } catch (error) {
      summary.errorsCount += 1;
      console.warn(`[movieSyncService] Failed to save movie "${movie.title}": ${error.message}`);
    }
  }

  try {
    const cleanupSummary = await cleanupRemovedCueCinemaMovies(allMovies);
    summary.moviesRemoved = cleanupSummary.moviesRemoved;
    summary.postersRemoved = cleanupSummary.postersRemoved;
  } catch (error) {
    summary.errorsCount += 1;
    console.warn(`[movieSyncService] Failed to clean up removed movies: ${error.message}`);
  }

  return summary;
}

module.exports = {
  CUE_BASE_URL,
  NOW_SHOWING_URL,
  COMING_SOON_URL,
  MOVIE_POSTERS_DIR,
  MOVIE_POSTERS_PUBLIC_PATH,
  REQUEST_TIMEOUT_MS,
  SELECTORS,
  downloadMoviePoster,
  getCueCinemaMovies,
  normalizePosterUrl,
  resolvePosterForMovie,
  saveCueCinemaMovies,
  searchTmdbMovie,
  scrapeComingSoon,
  scrapeMovieDetails,
  scrapeNowShowing,
};
