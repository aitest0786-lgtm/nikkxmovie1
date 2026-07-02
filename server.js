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
      timeout: 25000,
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

  // Replace target site names
  cleaned = cleaned.replace(/okjatt\.bond\.com|okjatt\.bond|okjatthd\.bond|okjatt\.in|okjatt\.org|okjatt|vegamovie\.ss|vegamovies|nikkXmovie/gi, ' ');
  
  // Extract year if present, to keep it in the search query for accuracy
  let year = '';
  const yearMatch = title.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) {
    year = yearMatch[0];
  }
  
  cleaned = cleaned
    .replace(/\b(s\d+ep\d+|s\d+\s+ep\d+|season\s+\d+|seanon\s+\d+|seasons|season|episodes|episode|episode\s+\d+|ep\d+|series|all|full)\b/gi, ' ') // Remove season, series and episode details
    .replace(/\(.*?\)/g, ' ') // Remove parentheses contents
    .replace(/\[.*?\]/g, ' ') // Remove brackets contents
    .replace(/\{.*?\}/g, ' ') // Remove braces contents
    .replace(/\b(480p|720p|1080p|2160p|4k|hd|web-dl|webrip|hdtc|hdtv|camrip|telesync|tc|ts|rip)\b/gi, ' ')
    .replace(/\b(hindi|english|tamil|telugu|malayalam|kannada|punjabi|odia|bangali|gujarati|marathi|korean|chinese|urdu|multi-audio|dual-audio|org|dubbed|hq|dub|dual|audio|esub|mkv|mp4|download|watch|online)\b/gi, ' ')
    .replace(/\b(full movie|uncut|extended|directors cut|complete|bootstrap)\b/gi, ' ')
    .replace(/\b(web series|webseries|tv show|tvshow|watch free)\b/gi, ' ')
    .replace(/[\-|\|]/g, ' ') // Replace punctuation with space
    .replace(/\s+/g, ' ') // Collapse spaces
    .trim();
    
  if (year && !cleaned.includes(year)) {
    cleaned += ' ' + year;
  }
  
  return cleaned.replace(/\s+/g, ' ').trim();
}

// Helper to replace target site brandings with nikkXmovie
function cleanTitleBranding(title) {
  if (!title) return '';
  return title
    .replace(/okjatt\.bond\.com/gi, 'nikkXmovie')
    .replace(/okjatt\.bond/gi, 'nikkXmovie')
    .replace(/okjatthd\.bond/gi, 'nikkXmovie')
    .replace(/okjatt\.in/gi, 'nikkXmovie')
    .replace(/okjatt\.org/gi, 'nikkXmovie')
    .replace(/okjatt/gi, 'nikkXmovie')
    .replace(/vegamovie\.ss/gi, 'nikkXmovie')
    .replace(/vegamovies/gi, 'nikkXmovie')
    .replace(/vegamovie/gi, 'nikkXmovie')
    .replace(/\[OkJatt\]/gi, '[nikkXmovie]')
    .replace(/\(OkJatt\)/gi, '(nikkXmovie)')
    .replace(/\s+/g, ' ')
    .trim();
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

// Helper to scrape specific category listings from Vegamovies with pagination support
async function scrapeVegaCategory(category, page) {
  let url = 'https://vegamovie.ss/';
  if (category === 'anime') {
    url = page > 1 ? `https://vegamovie.ss/category/animation/page/${page}/` : `https://vegamovie.ss/category/animation/`;
  } else if (category === 'bollywood') {
    url = page > 1 ? `https://vegamovie.ss/bollywood-movies/page/${page}/` : `https://vegamovie.ss/bollywood-movies/`;
  } else if (category === 'hollywood') {
    url = page > 1 ? `https://vegamovie.ss/hollywood-movies/page/${page}/` : `https://vegamovie.ss/hollywood-movies/`;
  } else if (category === 'dual-audio') {
    url = page > 1 ? `https://vegamovie.ss/dual-audio-hindi-english-movies/page/${page}/` : `https://vegamovie.ss/dual-audio-hindi-english-movies/`;
  } else if (category === 'web-series' || category === 'tv-show') {
    url = page > 1 ? `https://vegamovie.ss/tv-shows/page/${page}/` : `https://vegamovie.ss/tv-shows/`;
  } else if (category === 'south-indian') {
    url = page > 1 ? `https://vegamovie.ss/category/south-indian-dubbed-movies-download/page/${page}/` : `https://vegamovie.ss/category/south-indian-dubbed-movies-download/`;
  } else {
    url = page > 1 ? `https://vegamovie.ss/page/${page}/` : `https://vegamovie.ss/`;
  }

  const items = [];
  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    $('article, .post-item, .blog-post, .post').each((i, el) => {
      const titleEl = $(el).find('h2 a, h3 a, a').first();
      const href = titleEl.attr('href');
      const title = titleEl.text().trim() || $(el).find('img').attr('alt') || '';
      const imgEl = $(el).find('img').first();
      let poster = imgEl.attr('src') || imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || '';

      if (href && title) {
        const absoluteDetailUrl = href.startsWith('http') ? href : new URL(href, 'https://vegamovie.ss').href;
        const absolutePoster = poster ? (poster.startsWith('http') ? poster : new URL(poster, 'https://vegamovie.ss').href) : '';
        items.push({
          title: cleanTitleBranding(title),
          detailId: Buffer.from(absoluteDetailUrl).toString('base64'),
          poster: absolutePoster
        });
      }
    });
  } catch (err) {
    console.error(`Failed to scrape Vegamovies category ${category} page ${page}:`, err.message);
  }
  return items;
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

    let html = '';
    if (category !== 'anime') {
      try {
        html = await fetchHtml(url);
      } catch(e) {
        console.error(`Failed to fetch main category URL: ${url}`, e.message);
      }
    }
    
    const $ = cheerio.load(html || '');
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
          title: cleanTitleBranding(title),
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
            title: cleanTitleBranding(title),
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
            title: cleanTitleBranding(title),
            detailId: Buffer.from(absoluteDetailUrl).toString('base64'),
            poster: absolutePoster
          });
        }
      });
    }

    // Background Integration: Fetch and merge Vegamovies results
    let vegaMovies = [];
    if (search) {
      try {
        console.log(`[Vega Scraper] Background search for: "${search}"`);
        const vegaHtml = await fetchHtml(`https://vegamovie.ss/?s=${encodeURIComponent(search)}`);
        const $vega = cheerio.load(vegaHtml);
        $vega('article, .post-item, .blog-post, .post').each((i, el) => {
          const titleEl = $vega(el).find('h2 a, h3 a, a').first();
          const href = titleEl.attr('href');
          const title = titleEl.text().trim() || $vega(el).find('img').attr('alt') || '';
          const imgEl = $vega(el).find('img').first();
          let poster = imgEl.attr('src') || imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || '';

          if (href && title) {
            const absoluteDetailUrl = href.startsWith('http') ? href : new URL(href, 'https://vegamovie.ss').href;
            const absolutePoster = poster ? (poster.startsWith('http') ? poster : new URL(poster, 'https://vegamovie.ss').href) : '';
            vegaMovies.push({
              title: cleanTitleBranding(title),
              detailId: Buffer.from(absoluteDetailUrl).toString('base64'),
              poster: absolutePoster
            });
          }
        });
      } catch (e) {
        console.error("Failed to query Vegamovies in background:", e.message);
      }
    } else {
      // Scrape Vegamovies category or home page matching the requested page index
      try {
        console.log(`[Vega Scraper] Fetching category "${category || 'home'}" page ${page}`);
        const vegaItems = await scrapeVegaCategory(category, page);
        vegaMovies = vegaItems;
      } catch (e) {
        console.error("Failed to query Vegamovies category:", e.message);
      }
    }

    // Merge lists
    const finalMoviesList = [...movies, ...vegaMovies];

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
        hasNextPage = finalMoviesList.length >= 10;
      }
    } else {
      hasNextPage = true;
    }

    const result = { movies: finalMoviesList, page, hasNextPage };

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
    let html = await fetchHtml(detailUrl);
    let $ = cheerio.load(html);

    // Vegamovies details scraper integration
    const isVega = detailUrl.includes('vegamovie.ss');
    if (isVega) {
      const title = $('h1').text().trim();
      
      // Extract screenshots
      const screenshots = [];
      $('img').each((i, el) => {
        let imgUrl = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
        if (imgUrl && imgUrl.includes('/uploads/') && imgUrl.toLowerCase().includes('screenshot')) {
          if (!imgUrl.startsWith('http')) {
            imgUrl = new URL(imgUrl, detailUrl).href;
          }
          screenshots.push(imgUrl);
        }
      });
      
      // Extract synopsis/plot
      let plot = '';
      $('p').each((i, el) => {
        const txt = $(el).text().trim();
        if (txt && txt.length > 80 && !txt.includes('vegamovie') && !txt.includes('Prefect Spot') && !txt.includes('G-Drive') && !txt.includes('Quality:')) {
          plot = txt;
          return false;
        }
      });
      if (!plot) plot = 'No synopsis found for this release.';
      
      // Extract info html specs
      let infoHtml = '';
      $('p').each((i, el) => {
        const txt = $(el).text().trim();
        if (txt && (txt.includes('Web-Series Name:') || txt.includes('Movie Name:') || txt.includes('Release Year:') || txt.includes('Format:'))) {
          infoHtml += txt.replace(/\n/g, '<br>') + '<br>';
        }
      });

      // Extract downloads
      const downloads = [];
      $('.download-links-div').each((i, div) => {
        $(div).find('a').each((j, el) => {
          const href = $(el).attr('href');
          if (!href) return;
          
          let label = '';
          let prev = $(el).closest('h3, div, p').prev();
          while (prev.length > 0) {
            const txt = prev.text().trim();
            if (txt && (txt.includes('480p') || txt.includes('720p') || txt.includes('1080p') || txt.includes('Quality'))) {
              label = txt;
              break;
            }
            prev = prev.prev();
          }
          
          if (!label) {
            label = $(div).find('h3').first().text().trim() || 'Download Link';
          }
          
          const linkText = $(el).text().trim() || 'Download';
          const title = `${linkText} (${label})`;
          
          const titleLower = title.toLowerCase();
          const isEp = titleLower.includes('episode') || titleLower.includes('ep-') || /\bep\b/i.test(titleLower) || titleLower.includes('ep ') || titleLower.includes('pack') || titleLower.includes('complete') || titleLower.includes('season') || titleLower.includes('s0') || titleLower.includes('s1') || titleLower.includes('s2') || titleLower.includes('s3') || titleLower.includes('s4') || titleLower.includes('s5');
          
          const maskedUrl = `/api/download?id=${Buffer.from(href).toString('base64')}`;
          downloads.push({
            title: title,
            url: maskedUrl,
            isEpisode: isEp
          });
        });
      });
      
      // Fallback parser if downloads is empty
      if (downloads.length === 0) {
        $('a').each((i, el) => {
          const href = $(el).attr('href');
          let text = $(el).text().trim().replace(/\s+/g, ' ');
          if (href && (href.includes('nexdrive') || href.includes('v-cloud') || href.includes('howtoblog') || href.includes('drive') || text.includes('Download'))) {
            if (!text || text.length < 5 || text.includes('[]')) {
              text = $(el).attr('title') || 'Download Link';
            }
            const titleLower = text.toLowerCase();
            const isEp = titleLower.includes('episode') || titleLower.includes('ep-') || /\bep\b/i.test(titleLower) || titleLower.includes('ep ') || titleLower.includes('pack') || titleLower.includes('complete') || titleLower.includes('season') || titleLower.includes('s0') || titleLower.includes('s1') || titleLower.includes('s2') || titleLower.includes('s3') || titleLower.includes('s4') || titleLower.includes('s5');
            const maskedUrl = `/api/download?id=${Buffer.from(href).toString('base64')}`;
            downloads.push({
              title: text,
              url: maskedUrl,
              isEpisode: isEp
            });
          }
        });
      }

      // Resolve IMDb ID
      let imdbId = null;
      try {
        imdbId = await getImdbIdByTitle(title);
      } catch (err) {
        console.error('Error fetching IMDb ID for VegaMovie:', err.message);
      }

      const result = {
        title: cleanTitleBranding(title),
        infoHtml: cleanTitleBranding(infoHtml),
        plot: cleanTitleBranding(plot),
        screenshots: screenshots.slice(0, 8),
        downloads: downloads.map(d => ({
          title: cleanTitleBranding(d.title),
          url: d.url,
          isEpisode: d.isEpisode
        })),
        imdbId,
        streamUrl: null
      };

      cache.details[detailUrl] = {
        timestamp: Date.now(),
        data: result
      };

      return res.json(result);
    }

    // If it's a TV series intermediate page, resolve it to the complete page URL
    if (detailUrl.includes('/tv/') && detailUrl.endsWith('-full.html')) {
      let completeUrl = null;
      $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (href && href.includes('-complete.html')) {
          completeUrl = href.startsWith('http') ? href : new URL(href, detailUrl).href;
          return false; // break loop
        }
      });
      if (completeUrl) {
        console.log(`[Scraper] Resolving intermediate series page: ${detailUrl} -> ${completeUrl}`);
        detailUrl = completeUrl;
        html = await fetchHtml(detailUrl);
        $ = cheerio.load(html);
      }
    }

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
      // Find plot in paragraphs that are not part of header/footer
      $('p').each((i, el) => {
        const txt = $(el).text().trim();
        if (txt && txt.length > 50 && !txt.includes('HTML5 video') && !txt.includes('Online play') && !txt.includes('watch on')) {
          plot = txt;
          return false;
        }
      });
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
              url: maskedUrl,
              isEpisode: false
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
        const isTvEpisode = href && href.includes('/tv/') && href.includes('-download-') && href.endsWith('.html');
        if (href && (isTvEpisode || (!href.includes('.html') && (href.includes('checkyourlinks') || href.includes('cdn') || href.includes('.mp4') || href.includes('download') || href.includes('lnk-lnk'))))) {
          let text = $(el).text().trim().replace(/\s+/g, ' ');
          if (!text || text.length < 5) {
            text = isTvEpisode ? 'Download Episode' : 'Download Movie';
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
            url: maskedUrl,
            isEpisode: isTvEpisode
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
      title: cleanTitleBranding(title),
      infoHtml: cleanTitleBranding(infoHtml),
      plot: cleanTitleBranding(plot),
      screenshots: screenshots.slice(0, 8), // limit to 8 screenshots
      downloads: downloads.map(d => ({
        title: cleanTitleBranding(d.title),
        url: d.url,
        isEpisode: d.isEpisode
      })),
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

// 2b. API: Fetch direct masked stream url for any episode on demand
app.get('/api/episode-stream', async (req, res) => {
  const episodeId = req.query.id;
  if (!episodeId) {
    return res.status(400).json({ error: 'Missing episode ID' });
  }

  try {
    let episodeUrl = Buffer.from(episodeId, 'base64').toString('utf8');
    if (episodeUrl.startsWith('/')) {
      episodeUrl = new URL(episodeUrl, TARGET_BASE_URL).href;
    }

    console.log(`[Scraper] Fetching direct stream URL for episode: ${episodeUrl}`);
    const html = await fetchHtml(episodeUrl);
    const $ = cheerio.load(html);

    let streamUrl = null;
    $('video source').each((i, el) => {
      const src = $(el).attr('src');
      if (src && src.includes('.mp4')) {
        streamUrl = src;
        return false;
      }
    });

    if (!streamUrl) {
      $('video').each((i, el) => {
        const src = $(el).attr('src');
        if (src && src.includes('.mp4')) {
          streamUrl = src;
          return false;
        }
      });
    }

    if (!streamUrl) {
      $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (href && href.includes('.mp4')) {
          streamUrl = href;
          return false;
        }
      });
    }

    if (streamUrl) {
      const maskedStreamUrl = `/api/stream-play?id=${Buffer.from(streamUrl).toString('base64')}`;
      return res.json({ streamUrl: maskedStreamUrl });
    }

    res.status(404).json({ error: 'Direct video stream URL could not be resolved from this episode page' });
  } catch (error) {
    console.error("Error in /api/episode-stream:", error.message);
    res.status(500).json({ error: 'Failed to resolve episode stream', details: error.message });
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
    console.error('Streaming proxy error (failing fast):', error.message);
    if (!res.headersSent) {
      res.status(500).send('Streaming proxy error: ' + error.message);
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
