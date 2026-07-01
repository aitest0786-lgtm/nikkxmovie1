require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const https = require('https');
const path = require('path');

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const app = express();
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TARGET_BASE_URL = process.env.TARGET_BASE_URL || 'https://okjatt.bond';

// Simple in-memory cache to make page loading super fast and avoid rate limiting
const cache = {
  list: {},
  details: {},
  CACHE_DURATION: 10 * 60 * 1000 // 10 minutes cache
};

// Helper function to fetch page content with standard user-agent headers
async function fetchHtml(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': TARGET_BASE_URL + '/'
      },
      timeout: 15000,
      httpsAgent: httpsAgent
    });
    return response.data;
  } catch (error) {
    console.error(`Error fetching URL: ${url}`, error.message);
    throw error;
  }
}

// Helper to clean movie titles before searching IMDb
function cleanMovieTitle(title) {
  if (!title) return '';
  
  let cleaned = title;
  
  // Extract year if present, to keep it in the search query for accuracy
  let year = '';
  const yearMatch = title.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) {
    year = yearMatch[0];
  }
  
  cleaned = cleaned
    .replace(/\(.*?\)/g, ' ') // Remove parentheses contents
    .replace(/\[.*?\]/g, ' ') // Remove brackets contents
    .replace(/\{.*?\}/g, ' ') // Remove braces contents
    .replace(/480p|720p|1080p|2160p|4k|hd|web-dl|webrip|hdtc|hdtv|camrip|telesync|tc|ts|rip/gi, ' ')
    .replace(/hindi|english|tamil|telugu|malayalam|kannada|punjabi|odia|bangali|gujarati|marathi|korean|chinese|urdu|multi-audio|dual-audio|org|dubbed|hq|dub/gi, ' ')
    .replace(/full movie|uncut|extended|directors cut|season \d+|s\d+ ep\d+|episodes? \d+/gi, ' ')
    .replace(/[\-|\|]/g, ' ') // Replace punctuation with space
    .replace(/\s+/g, ' ') // Collapse spaces
    .trim();
    
  if (year && !cleaned.includes(year)) {
    cleaned += ' ' + year;
  }
  
  return cleaned.replace(/\s+/g, ' ').trim();
}

// Fetch IMDb ID using official IMDb suggestions API (extremely fast and reliable)
async function getImdbIdByTitle(title) {
  const cleanTitle = cleanMovieTitle(title);
  if (!cleanTitle) return null;
  
  try {
    const firstChar = cleanTitle.charAt(0).toLowerCase();
    // Validate first character is alphanumeric, fallback to 'a'
    const queryChar = /^[a-z0-9]$/.test(firstChar) ? firstChar : 'a';
    
    const searchUrl = `https://sg.media-imdb.com/suggests/${queryChar}/${encodeURIComponent(cleanTitle.toLowerCase())}.json`;
    const response = await axios.get(searchUrl, { timeout: 6000 });
    
    const dataText = response.data;
    const jsonStart = dataText.indexOf('(') + 1;
    const jsonEnd = dataText.lastIndexOf(')');
    if (jsonStart > 0 && jsonEnd > jsonStart) {
      const jsonText = dataText.substring(jsonStart, jsonEnd);
      const json = JSON.parse(jsonText);
      if (json && json.d && json.d.length > 0) {
        // Return first match that has an IMDb ID starting with 'tt'
        const match = json.d.find(item => item.id && item.id.startsWith('tt'));
        if (match) {
          return match.id;
        }
      }
    }
  } catch (error) {
    console.error(`Failed to lookup IMDb ID for title "${cleanTitle}":`, error.message);
  }
  return null;
}

// 1. API: List movies (Home, Categories, Search)
app.get('/api/movies', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const search = req.query.s || '';
  const category = req.query.category || '';

  // Generate a unique cache key based on query params
  const cacheKey = `list-p${page}-s${search}-c${category}`;
  const cachedData = cache.list[cacheKey];

  if (cachedData && (Date.now() - cachedData.timestamp < cache.CACHE_DURATION)) {
    return res.json(cachedData.data);
  }

  try {
    let url = TARGET_BASE_URL;
    let isSearch = false;

    if (search) {
      // Search suggestion query
      url = `${TARGET_BASE_URL}/movies/src_data.php?q=${encodeURIComponent(search)}`;
      isSearch = true;
    } else if (category) {
      // Mapping categories
      if (category === 'bollywood') {
        url = `${TARGET_BASE_URL}/movies/Hindi/New-${page - 1}.html`;
      } else if (category === 'hollywood') {
        url = `${TARGET_BASE_URL}/movies/Hollywood-Dubbed/New-${page - 1}.html`;
      } else if (category === 'dual-audio') {
        url = `${TARGET_BASE_URL}/movies/Hindi-Movie/New-${page - 1}.html`;
      } else if (category === 'web-series' || category === 'tv-show') {
        url = `${TARGET_BASE_URL}/tv/Hindi-web-series/list-${page}.html`;
      } else if (category === 'south-indian') {
        url = `${TARGET_BASE_URL}/movies/south-indian-dubbed/new-${page - 1}.html`;
      } else if (category === '18') {
        url = `${TARGET_BASE_URL}/movies/B-Grade-Hindi-Movie/New-${page - 1}.html`;
      } else {
        url = `${TARGET_BASE_URL}/movies/${category}/New-${page - 1}.html`;
      }
    } else {
      // Homepage: load base URL for page 1, fallback to Hindi list for page > 1
      url = page > 1
        ? `${TARGET_BASE_URL}/movies/Hindi/New-${page - 1}.html`
        : `${TARGET_BASE_URL}/`;
    }

    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    const movies = [];

    // Parse logic supporting various styles
    // 1. Grid listing format (e.g. subcategory lists)
    $('.ml-item').each((i, el) => {
      const item = $(el);
      const linkEl = item.find('a.ml-mask');
      const href = linkEl.attr('href');
      if (!href) return;

      const title = linkEl.find('.mli-info h2').text().trim() || linkEl.attr('title') || '';
      const imgEl = linkEl.find('img');
      const poster = imgEl.attr('src') || imgEl.attr('data-original') || imgEl.attr('data-src') || '';

      if (title && href) {
        const absoluteDetailUrl = href.startsWith('http') ? href : new URL(href, TARGET_BASE_URL).href;
        const absolutePoster = poster ? (poster.startsWith('http') ? poster : new URL(poster, TARGET_BASE_URL).href) : '';
        movies.push({
          title,
          detailId: Buffer.from(absoluteDetailUrl).toString('base64'),
          poster: absolutePoster
        });
      }
    });

    // 2. Slider format (Home page layout)
    if (movies.length === 0) {
      $('.content-slider a, .item a').each((i, el) => {
        const linkEl = $(el);
        const href = linkEl.attr('href');
        if (!href || (!href.includes('/movie/') && !href.includes('/tv/'))) return;

        const liEl = linkEl.find('li');
        if (liEl.length === 0) return;

        const title = liEl.find('.titt').text().trim() || liEl.find('h2').text().replace(/\s+/g, ' ').trim() || '';
        const styleAttr = liEl.attr('style') || '';
        let poster = '';
        const bgMatch = styleAttr.match(/url\((.*?)\)/);
        if (bgMatch) {
          poster = bgMatch[1].replace(/['"]/g, '').trim();
        }

        if (title && href) {
          const absoluteDetailUrl = href.startsWith('http') ? href : new URL(href, TARGET_BASE_URL).href;
          const absolutePoster = poster ? (poster.startsWith('http') ? poster : new URL(poster, TARGET_BASE_URL).href) : '';
          movies.push({
            title,
            detailId: Buffer.from(absoluteDetailUrl).toString('base64'),
            poster: absolutePoster
          });
        }
      });
    }

    // 3. Search suggestions format (ul.sul li a)
    if (movies.length === 0) {
      $('.sul li a, li a').each((i, el) => {
        const linkEl = $(el);
        const href = linkEl.attr('href');
        if (!href) return;

        const title = linkEl.text().trim();
        const imgEl = linkEl.find('img');
        const poster = imgEl.attr('src') || '';

        if (title && href) {
          const absoluteDetailUrl = href.startsWith('http') ? href : new URL(href, TARGET_BASE_URL).href;
          const absolutePoster = poster ? (poster.startsWith('http') ? poster : new URL(poster, TARGET_BASE_URL).href) : '';
          movies.push({
            title,
            detailId: Buffer.from(absoluteDetailUrl).toString('base64'),
            poster: absolutePoster
          });
        }
      });
    }

    // Check pagination
    let hasNextPage = false;
    if (isSearch) {
      hasNextPage = false;
    } else if (category || page > 1) {
      const pageNav = $('.pageNav, .pagidiv');
      if (pageNav.length > 0) {
        const nextText = pageNav.text();
        if (nextText.includes('Next') || nextText.includes('»') || nextText.includes('Next»')) {
          hasNextPage = true;
        }
      } else {
        hasNextPage = movies.length >= 10;
      }
    } else {
      // Home page page 1 has next pages (since page 2 will fall back to Hindi category page 2)
      hasNextPage = true;
    }

    const result = { movies, page, hasNextPage };

    // Cache the result
    cache.list[cacheKey] = {
      timestamp: Date.now(),
      data: result
    };

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch movies', details: error.message });
  }
});

// 2. API: Movie Details (synopsis, download links, screenshots)
app.get('/api/movie-details', async (req, res) => {
  const detailId = req.query.id;
  if (!detailId) {
    return res.status(400).json({ error: 'Missing movie ID' });
  }

  let detailUrl;
  try {
    detailUrl = Buffer.from(detailId, 'base64').toString('utf8');
  } catch (e) {
    return res.status(400).json({ error: 'Invalid movie ID format' });
  }

  const cachedData = cache.details[detailUrl];
  if (cachedData && (Date.now() - cachedData.timestamp < cache.CACHE_DURATION)) {
    return res.json(cachedData.data);
  }

  try {
    const html = await fetchHtml(detailUrl);
    const $ = cheerio.load(html);

    const title = $('.meta-data-title h1, h1').text().trim();

    // Extract specs info HTML
    const infoParagraphs = [];
    $('.meta-data-side-by-side').each((i, el) => {
      const label = $(el).find('.meta-data-label').text().trim();
      const content = $(el).find('.meta-data-label-content').text().trim();
      if (label && content) {
        infoParagraphs.push(`<strong>${label}:</strong> ${content}`);
      }
    });
    
    let infoHtml = infoParagraphs.join('<br>');
    if (!infoHtml) {
      infoHtml = $('.meta-data-container').html() || '';
    }

    // Extract screenshots
    const screenshots = [];
    $('.scr_shot img, .ssrt img, .ss-box img').each((i, el) => {
      let imgUrl = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-original');
      if (imgUrl && !imgUrl.includes('logo') && !imgUrl.includes('gravatar') && !imgUrl.includes('favicon')) {
        if (!imgUrl.startsWith('http')) {
          imgUrl = new URL(imgUrl, detailUrl).href;
        }
        screenshots.push(imgUrl);
      }
    });

    // Extract synopsis/plot
    let plot = $('.meta-description-text').text().trim();
    if (!plot) {
      plot = $('.description-blog').text().trim();
    }
    if (!plot) {
      plot = $('.entry-content p').text().trim();
    }
    if (!plot) {
      plot = 'No synopsis found for this release.';
    }

    // Extract download links
    const downloads = [];
    let downloadPageUrl = null;
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      if (href && (href.includes('/movies/download/') || href.includes('/download/'))) {
        downloadPageUrl = new URL(href, detailUrl).href;
        return false;
      }
    });

    let streamUrl = null;

    if (downloadPageUrl) {
      try {
        const dwdHtml = await fetchHtml(downloadPageUrl);
        const $dwd = cheerio.load(dwdHtml);
        
        // Find direct video player streamUrl from video source elements
        $dwd('video source').each((i, el) => {
          const src = $dwd(el).attr('src');
          if (src && src.includes('.mp4')) {
            streamUrl = src;
            return false;
          }
        });
        
        if (!streamUrl) {
          $dwd('video').each((i, el) => {
            const src = $dwd(el).attr('src');
            if (src && src.includes('.mp4')) {
              streamUrl = src;
              return false;
            }
          });
        }
        
        if (!streamUrl) {
          $dwd('a').each((i, el) => {
            const href = $dwd(el).attr('href');
            if (href && href.includes('.mp4')) {
              streamUrl = href;
              return false;
            }
          });
        }

        $dwd('a').each((i, el) => {
          let href = $dwd(el).attr('href');
          if (href && !href.includes('.html') && (href.includes('checkyourlinks') || href.includes('cdn') || href.includes('.mp4') || href.includes('download') || href.includes('lnk-lnk'))) {
            let text = $dwd(el).text().trim().replace(/\s+/g, ' ');
            if (!text || text.length < 5) {
              text = 'Download Movie';
            }
            if (!href.startsWith('http')) {
              href = new URL(href, downloadPageUrl).href;
            }
            // Auto append index.php to query-only checkyourlinks URL to prevent FastCGI errors
            try {
              const urlObj = new URL(href);
              if (urlObj.hostname.includes('checkyourlinks') && (urlObj.pathname === '/' || urlObj.pathname === '')) {
                urlObj.pathname = '/index.php';
                href = urlObj.href;
              }
            } catch(e) {}
            const maskedUrl = `/api/download?id=${Buffer.from(href).toString('base64')}`;
            downloads.push({
              title: text,
              url: maskedUrl
            });
          }
        });
      } catch (err) {
        console.error('Failed to fetch intermediate download page:', err.message);
      }
    }

    // Fallback: search on the main details page
    if (downloads.length === 0) {
      $('a').each((i, el) => {
        let href = $(el).attr('href');
        if (href && !href.includes('.html') && (href.includes('checkyourlinks') || href.includes('cdn') || href.includes('.mp4') || href.includes('download') || href.includes('lnk-lnk'))) {
          let text = $(el).text().trim().replace(/\s+/g, ' ');
          if (!text || text.length < 5) {
            text = 'Download Movie';
          }
          if (!href.startsWith('http')) {
            href = new URL(href, detailUrl).href;
          }
          // Auto append index.php to query-only checkyourlinks URL to prevent FastCGI errors
          try {
            const urlObj = new URL(href);
            if (urlObj.hostname.includes('checkyourlinks') && (urlObj.pathname === '/' || urlObj.pathname === '')) {
              urlObj.pathname = '/index.php';
              href = urlObj.href;
            }
          } catch(e) {}
          const maskedUrl = `/api/download?id=${Buffer.from(href).toString('base64')}`;
          downloads.push({
            title: text,
            url: maskedUrl
          });
        }
      });
    }

    if (!streamUrl) {
      $('video source').each((i, el) => {
        const src = $(el).attr('src');
        if (src && src.includes('.mp4')) {
          streamUrl = src;
          return false;
        }
      });
      if (!streamUrl) {
        $('a').each((i, el) => {
          const href = $(el).attr('href');
          if (href && href.includes('.mp4')) {
            streamUrl = href;
            return false;
          }
        });
      }
    }

    // Fetch IMDb ID for this movie/show
    let imdbId = null;
    try {
      imdbId = await getImdbIdByTitle(title);
    } catch (err) {
      console.error('Error fetching IMDb ID:', err.message);
    }

    // Mask direct streamUrl
    const maskedStreamUrl = streamUrl ? `/api/stream-play?id=${Buffer.from(streamUrl).toString('base64')}` : null;

    const result = {
      title,
      infoHtml,
      plot,
      screenshots: screenshots.slice(0, 8), // limit to 8 screenshots
      downloads,
      imdbId,
      streamUrl: maskedStreamUrl
    };

    cache.details[detailUrl] = {
      timestamp: Date.now(),
      data: result
    };

    res.json(result);
  } catch (error) {
    console.error("Error in /api/movie-details:", error);
    res.status(500).json({ error: 'Failed to parse movie details', details: error.message });
  }
});

// 3. API: Masked download redirect
app.get('/api/download', async (req, res) => {
  const maskedId = req.query.id;
  if (!maskedId) {
    return res.status(400).send('Invalid download request');
  }

  try {
    let originalUrl = Buffer.from(maskedId, 'base64').toString('utf8');
    
    // Resolve relative URLs if any
    if (originalUrl.startsWith('/')) {
      originalUrl = new URL(originalUrl, TARGET_BASE_URL).href;
    }

    // Force HTTPS for checkyourlinks.shop as port 80/HTTP times out/fails due to Cloudflare block
    if (originalUrl.startsWith('http://') && (originalUrl.includes('checkyourlinks') || originalUrl.includes('cdn'))) {
      originalUrl = originalUrl.replace('http://', 'https://');
    }

    // Append index.php for checkyourlinks root queries to prevent FastCGI 'No input file specified' error
    try {
      const urlObj = new URL(originalUrl);
      if (urlObj.hostname.includes('checkyourlinks') && (urlObj.pathname === '/' || urlObj.pathname === '')) {
        urlObj.pathname = '/index.php';
        originalUrl = urlObj.href;
      }
    } catch(e) {}

    if (originalUrl.startsWith('http://') || originalUrl.startsWith('https://')) {
      // If it's a web page, instead of redirecting directly (which exposes okjatt), scrape it for direct download link
      if (originalUrl.includes('.html')) {
        try {
          const html = await fetchHtml(originalUrl);
          const $dwd = cheerio.load(html);
          let directUrl = null;
          $dwd('a').each((i, el) => {
            let href = $dwd(el).attr('href');
            if (href && !href.includes('.html') && (href.includes('checkyourlinks') || href.includes('cdn') || href.includes('.mp4') || href.includes('download') || href.includes('lnk-lnk'))) {
              directUrl = href.startsWith('http') ? href : new URL(href, originalUrl).href;
              return false; // break loop
            }
          });
          
          if (directUrl) {
            if (directUrl.startsWith('http://') && (directUrl.includes('checkyourlinks') || directUrl.includes('cdn'))) {
              directUrl = directUrl.replace('http://', 'https://');
            }
            return res.redirect(`/api/download?id=${Buffer.from(directUrl).toString('base64')}`);
          }
        } catch (e) {
          console.error('Failed to resolve nested html download link:', e.message);
        }
        // Fallback: send 404 instead of opening okjatt.com
        return res.status(404).send('Direct download link could not be parsed for this server page.');
      }

      // If it's a direct file, stream it to force download
      let filename = 'movie.mp4';
      try {
        const urlObj = new URL(originalUrl);
        const pathname = urlObj.pathname;
        const lastPart = pathname.substring(pathname.lastIndexOf('/') + 1);
        if (lastPart && lastPart.includes('.')) {
          filename = decodeURIComponent(lastPart);
        } else {
          const idParam = urlObj.searchParams.get('id') || 'movie';
          filename = `${idParam}.mp4`;
        }
      } catch (e) {}

      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      let refererHost = 'okjatthd.bond';
      try {
        const urlObj = new URL(originalUrl);
        refererHost = urlObj.searchParams.get('d') || refererHost;
      } catch (e) {}

      const response = await axios({
        method: 'get',
        url: originalUrl,
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Referer': `https://${refererHost}/`
        },
        httpsAgent: httpsAgent
      });

      if (response.headers['content-type']) {
        res.setHeader('content-type', response.headers['content-type']);
      }
      if (response.headers['content-length']) {
        res.setHeader('content-length', response.headers['content-length']);
      }

      response.data.pipe(res);
    } else {
      res.status(400).send('Malformed download URL');
    }
  } catch (error) {
    console.error('Download stream error, falling back to redirect:', error);
    try {
      let originalUrl = Buffer.from(maskedId, 'base64').toString('utf8');
      if (originalUrl.startsWith('/')) {
        originalUrl = new URL(originalUrl, TARGET_BASE_URL).href;
      }
      res.redirect(originalUrl);
    } catch (fallbackErr) {
      res.status(500).send('Error decrypting download URL');
    }
  }
});

// 4. API: Masked native streaming proxy with Range support (bypasses CORS/Referer blocks)
app.get('/api/stream-play', async (req, res) => {
  const maskedId = req.query.id;
  if (!maskedId) {
    return res.status(400).send('Invalid stream request');
  }

  const controller = new AbortController();
  
  // Clean up and abort axios request if the client disconnects
  req.on('close', () => {
    controller.abort();
  });

  try {
    let originalUrl = Buffer.from(maskedId, 'base64').toString('utf8');
    
    // Resolve relative URLs if any
    if (originalUrl.startsWith('/')) {
      originalUrl = new URL(originalUrl, TARGET_BASE_URL).href;
    }

    if (originalUrl.startsWith('http://') || originalUrl.startsWith('https://')) {
      let refererHost = 'okjatthd.bond';
      try {
        const urlObj = new URL(originalUrl);
        refererHost = urlObj.searchParams.get('d') || refererHost;
      } catch (e) {}

      const requestHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Referer': `https://${refererHost}/`
      };

      // Forward range header if requested by client (critical for seeking and mobile players)
      if (req.headers.range) {
        requestHeaders['Range'] = req.headers.range;
      }

      let currentUrl = originalUrl;
      let redirectCount = 0;
      let response = null;

      // Handle redirects manually to preserve the Referer header
      while (redirectCount < 5) {
        try {
          response = await axios({
            method: 'get',
            url: currentUrl,
            responseType: 'stream',
            headers: requestHeaders,
            timeout: 25000,
            httpsAgent: httpsAgent,
            maxRedirects: 0,
            validateStatus: status => (status >= 200 && status < 300) || status === 301 || status === 302 || status === 307 || status === 308,
            signal: controller.signal
          });

          // Check for redirect status codes
          if ([301, 302, 307, 308].includes(response.status)) {
            let redirectUrl = response.headers.location;
            if (!redirectUrl) {
              throw new Error('Redirect status received without Location header');
            }
            if (!redirectUrl.startsWith('http')) {
              redirectUrl = new URL(redirectUrl, currentUrl).href;
            }
            
            currentUrl = redirectUrl;
            redirectCount++;

            // Update referer host for the new redirect URL
            try {
              const urlObj = new URL(currentUrl);
              requestHeaders['Referer'] = `https://${urlObj.hostname}/`;
            } catch (e) {}

            continue;
          }

          break; // Got a valid non-redirect response
        } catch (err) {
          throw err;
        }
      }

      if (!response) {
        throw new Error('No response received from target stream server');
      }

      // Set headers from the target stream response
      if (response.headers['content-type']) {
        res.setHeader('Content-Type', response.headers['content-type']);
      }
      if (response.headers['content-range']) {
        res.setHeader('Content-Range', response.headers['content-range']);
      }
      if (response.headers['accept-ranges']) {
        res.setHeader('Accept-Ranges', response.headers['accept-ranges']);
      } else {
        res.setHeader('Accept-Ranges', 'bytes');
      }
      if (response.headers['content-length']) {
        res.setHeader('Content-Length', response.headers['content-length']);
      }

      res.status(req.headers.range ? 206 : 200);
      response.data.pipe(res);
    } else {
      res.status(400).send('Malformed stream URL');
    }
  } catch (error) {
    controller.abort();
    if (error.name === 'CanceledError' || error.name === 'AbortError') {
      // Request aborted by client, no need to log or redirect
      return;
    }
    console.error('Streaming proxy error, falling back to direct redirect:', error.message);
    try {
      let originalUrl = Buffer.from(maskedId, 'base64').toString('utf8');
      if (originalUrl.startsWith('/')) {
        originalUrl = new URL(originalUrl, TARGET_BASE_URL).href;
      }
      res.redirect(originalUrl);
    } catch (fallbackErr) {
      if (!res.headersSent) {
        res.status(500).send('Error proxying stream URL');
      }
    }
  }
});

// Catch-all route to serve the SPA frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
