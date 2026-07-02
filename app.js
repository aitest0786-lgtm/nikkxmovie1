// nikkXmovie Premium Client Script

let currentPage = 1;
let currentCategory = '';
let currentSearch = '';
let hasNextPage = false;
let firstMovieOnPage = null;
let currentImdbId = null;
let currentMediaType = 'movie';
let currentSeason = 1;
let currentEpisode = 1;
let currentDirectStreamUrl = null;

// DOM Elements
const moviesGrid = document.getElementById('movies-grid');
const skeletonLoader = document.getElementById('skeleton-loader');
const pagination = document.getElementById('pagination');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const pageNumDisplay = document.getElementById('page-num-display');
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const catButtons = document.querySelectorAll('.cat-btn');
const logo = document.querySelector('.logo');

// Modal Elements
const detailModal = document.getElementById('detail-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const modalSkeleton = document.getElementById('modal-skeleton');
const modalRealContent = document.getElementById('modal-real-content');
const movieDetailPoster = document.getElementById('movie-detail-poster');
const movieDetailTitle = document.getElementById('movie-detail-title');
const movieDetailPlot = document.getElementById('movie-detail-plot');
const movieSpecsBox = document.getElementById('movie-specs-box');
const movieScreenshots = document.getElementById('movie-screenshots');
const movieDownloads = document.getElementById('movie-downloads');
const screenshotsContainer = document.getElementById('screenshots-box-container');

// Video Player Elements
const playerBoxContainer = document.getElementById('player-box-container');
const videoPlayerIframe = document.getElementById('video-player-iframe');
const nativePlayerWrapper = document.getElementById('native-player-wrapper');
const nativeVideoPlayer = document.getElementById('native-video-player');
const iframePlayerWrapper = document.getElementById('iframe-player-wrapper');
const directServerBtn = document.getElementById('server-btn-direct');

// Hero elements
const heroBanner = document.getElementById('hero-banner');
const featuredTitle = document.getElementById('featured-title');
const featuredDesc = document.getElementById('featured-desc');
const featuredViewBtn = document.getElementById('featured-view-btn');

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadMovies();
});

// Event Listeners Configuration
function setupEventListeners() {
  // Category tabs
  catButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Toggle active states
      catButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      currentCategory = btn.dataset.category;
      currentSearch = '';
      searchInput.value = '';
      currentPage = 1;
      
      // Update section header
      const catText = btn.textContent === 'Home' ? 'Latest Uploads' : btn.textContent;
      document.getElementById('section-title').innerHTML = `<i class="fa-solid fa-clapperboard"></i> ${catText}`;

      loadMovies();
    });
  });

  // Search trigger
  searchBtn.addEventListener('click', performSearch);
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  });

  // Logo home navigation
  logo.addEventListener('click', () => {
    catButtons.forEach(b => b.classList.remove('active'));
    document.querySelector('.cat-btn[data-category=""]').classList.add('active');
    
    currentCategory = '';
    currentSearch = '';
    searchInput.value = '';
    currentPage = 1;
    document.getElementById('section-title').innerHTML = `<i class="fa-solid fa-clapperboard"></i> Latest Uploads`;
    
    loadMovies();
  });

  // Pagination triggers
  prevBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      loadMovies();
      scrollToMoviesSection();
    }
  });

  nextBtn.addEventListener('click', () => {
    if (hasNextPage) {
      currentPage++;
      loadMovies();
      scrollToMoviesSection();
    }
  });

  // Modal closing triggers
  closeModalBtn.addEventListener('click', closeModal);
  detailModal.addEventListener('click', (e) => {
    if (e.target === detailModal) {
      closeModal();
    }
  });

  // ESC key to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && detailModal.classList.contains('open')) {
      closeModal();
    }
  });

  // Hero Featured View Button trigger
  featuredViewBtn.addEventListener('click', () => {
    if (firstMovieOnPage) {
      openDetailsModal(firstMovieOnPage.detailId, firstMovieOnPage.poster);
    }
  });

  // Server buttons click to switch sources
  const serverButtons = document.querySelectorAll('#player-servers .server-btn');
  serverButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active class from all and add to clicked
      const btns = document.querySelectorAll('#player-servers .server-btn');
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (btn.id === 'server-btn-direct') {
        iframePlayerWrapper.style.display = 'none';
        videoPlayerIframe.src = '';
        nativePlayerWrapper.style.display = 'block';
        if (currentDirectStreamUrl) {
          nativeVideoPlayer.src = currentDirectStreamUrl;
          nativeVideoPlayer.load();
          nativeVideoPlayer.play().catch(e => console.log('Autoplay blocked:', e));
        }
      } else {
        nativePlayerWrapper.style.display = 'none';
        nativeVideoPlayer.pause();
        nativeVideoPlayer.removeAttribute('src');
        nativeVideoPlayer.load();
        iframePlayerWrapper.style.display = 'block';

        if (currentImdbId) {
          let prefix = btn.dataset.srcPrefix;
          if (currentMediaType === 'tv') {
            if (prefix.includes('multiembed.mov')) {
              videoPlayerIframe.src = `${prefix}${currentImdbId}&s=${currentSeason}&e=${currentEpisode}`;
            } else {
              prefix = prefix.replace('/movie/', '/tv/');
              videoPlayerIframe.src = `${prefix}${currentImdbId}/${currentSeason}/${currentEpisode}`;
            }
          } else {
            videoPlayerIframe.src = `${prefix}${currentImdbId}`;
          }
        }
      }
    });
  });

  // Aspect ratio switcher triggers
  const aspectButtons = document.querySelectorAll('#player-aspects .aspect-btn');
  aspectButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Toggle active states
      aspectButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const aspect = btn.dataset.aspect;
      applyPlayerAspectRatio(aspect);
    });
  });

  // Native Video Player error handler to assist debugging
  nativeVideoPlayer.addEventListener('error', () => {
    // Only handle error if the modal is actually open and video has a source
    if (!detailModal.classList.contains('open') || !nativeVideoPlayer.src) {
      return;
    }

    const err = nativeVideoPlayer.error;
    let message = 'Unknown playback error.';
    if (err) {
      switch (err.code) {
        case 1: message = 'Playback aborted by user/client request.'; break;
        case 2: message = 'Network error while loading video stream.'; break;
        case 3: message = 'Video decoding failed. The format or codec (like AC3/DTS audio) is not supported by your browser.'; break;
        case 4: message = 'Video stream source format not supported.'; break;
      }
      console.error(`Native video error [Code ${err.code}]: ${message}`, err);

      // Automatic fallback to Server 1 (vidsrc.net) if IMDb ID is available
      if (currentImdbId) {
        console.log('Direct stream failed. Switching to Server 1 (vidsrc.net) fallback...');
        const serverBtn = document.querySelector('#player-servers .server-btn[data-src-prefix]');
        if (serverBtn) {
          // Switch to Server 1
          serverBtn.click();
          showPlayerToast('Direct stream format not supported. Switching to Server 1...');
        } else {
          showPlayerToast(`Direct stream failed: ${message}`);
        }
      } else {
        showPlayerToast(`Direct stream failed: ${message}`);
      }
    }
  });
}

function scrollToMoviesSection() {
  document.querySelector('.movies-section').scrollIntoView({ behavior: 'smooth' });
}

function performSearch() {
  const query = searchInput.value.trim();
  if (query) {
    currentSearch = query;
    currentCategory = '';
    currentPage = 1;

    // Deselect category buttons
    catButtons.forEach(b => b.classList.remove('active'));

    document.getElementById('section-title').innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> Search Results for: "${query}"`;
    loadMovies();
  }
}

// Load Movies list from Express Server API
async function loadMovies() {
  showLoader();
  try {
    const url = `/api/movies?page=${currentPage}&s=${encodeURIComponent(currentSearch)}&category=${currentCategory}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.movies && data.movies.length > 0) {
      renderMovies(data.movies);
      hasNextPage = data.hasNextPage;
      firstMovieOnPage = data.movies[0];
      
      // Dynamically update hero banner background and content on page 1
      if (currentPage === 1 && !currentSearch) {
        updateHeroBanner(firstMovieOnPage);
      }
    } else {
      moviesGrid.innerHTML = `
        <div class="no-results">
          <i class="fa-solid fa-face-frown"></i>
          <h3>No Movies Found</h3>
          <p>We couldn't find anything matching your request. Please try another search or category.</p>
        </div>
      `;
      hasNextPage = false;
      firstMovieOnPage = null;
    }

    updatePaginationDisplay();
  } catch (error) {
    console.error('Failed to load movies:', error);
    moviesGrid.innerHTML = `
      <div class="no-results error-state">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <h3>Connection Error</h3>
        <p>Something went wrong while connecting to the scraper backend server. Please try again later.</p>
      </div>
    `;
    hasNextPage = false;
  } finally {
    hideLoader();
  }
}

function updateHeroBanner(movie) {
  if (movie) {
    // If it has poster, apply as background gradient image
    heroBanner.style.backgroundImage = `linear-gradient(90deg, rgba(7, 6, 11, 0.95) 0%, rgba(7, 6, 11, 0.5) 100%), url(${movie.poster})`;
    heroBanner.style.backgroundSize = 'cover';
    heroBanner.style.backgroundPosition = 'center 20%';
    featuredTitle.textContent = movie.title;
    featuredDesc.textContent = `Now streaming in full high-definition. Access complete download mirrors, screenshots, and audio track details.`;
    featuredViewBtn.style.display = 'inline-flex';
  } else {
    // Default hero style
    heroBanner.style.backgroundImage = 'none';
    featuredTitle.textContent = 'Explore Premium Cinema & Anime';
    featuredDesc.textContent = 'Stream and download the latest high-quality Bollywood, Hollywood, South Indian movies, and Web series. Zero redirects on searches, hidden origin links, absolute privacy.';
    featuredViewBtn.style.display = 'none';
  }
}

// Render cards inside Grid
function renderMovies(movies) {
  moviesGrid.innerHTML = '';
  
  movies.forEach(movie => {
    const card = document.createElement('div');
    card.className = 'movie-card';
    
    // Check if poster is empty, fallback placeholder
    const posterSrc = movie.poster || 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?q=80&w=300';

    card.innerHTML = `
      <div class="poster-wrapper">
        <img src="${posterSrc}" alt="${movie.title}" loading="lazy">
        <div class="card-hover-overlay">
          <div class="play-icon-glow">
            <i class="fa-solid fa-play"></i>
          </div>
        </div>
      </div>
      <div class="movie-info">
        <div class="movie-title" title="${movie.title}">${movie.title}</div>
      </div>
    `;

    card.addEventListener('click', () => {
      openDetailsModal(movie.detailId, posterSrc);
    });

    moviesGrid.appendChild(card);
  });
}

// Show details modal and scrape specific page
async function openDetailsModal(detailId, posterUrl) {
  // Reset modal display states
  detailModal.classList.add('open');
  modalSkeleton.style.display = 'grid';
  modalRealContent.style.display = 'none';
  document.body.style.overflow = 'hidden'; // Lock background scroll

  // Push state to browser history for Android Back Button modal close support
  history.pushState({ modalOpen: true }, '', '#movie-details');

  try {
    const response = await fetch(`/api/movie-details?id=${detailId}`);
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.details || errData.error || `HTTP ${response.status}`);
    }
    const movie = await response.json();

    // Populate Details
    movieDetailPoster.src = posterUrl || (movie.screenshots && movie.screenshots[0]) || '';
    movieDetailPoster.alt = movie.title;
    movieDetailTitle.textContent = movie.title;
    
    // Synopsis
    movieDetailPlot.textContent = movie.plot || 'No synopsis found for this release.';

    // Technical specifications info block HTML
    if (movie.infoHtml) {
      movieSpecsBox.style.display = 'block';
      movieSpecsBox.innerHTML = movie.infoHtml;
    } else {
      movieSpecsBox.style.display = 'none';
    }

    // Screenshots list
    movieScreenshots.innerHTML = '';
    if (movie.screenshots && movie.screenshots.length > 0) {
      screenshotsContainer.style.display = 'block';
      movie.screenshots.forEach(src => {
        const img = document.createElement('img');
        img.src = src;
        img.alt = 'Movie Screenshot';
        img.loading = 'lazy';
        // Add full screen zoom view click handler
        img.addEventListener('click', () => {
          window.open(src, '_blank');
        });
        movieScreenshots.appendChild(img);
      });
    } else {
      screenshotsContainer.style.display = 'none';
    }

    // Dynamic Download Links listing
    movieDownloads.innerHTML = '';
    if (movie.downloads && movie.downloads.length > 0) {
      movie.downloads.forEach(dwd => {
        const item = document.createElement('div');
        item.className = 'dwd-item';
        
        if (dwd.isEpisode) {
          item.innerHTML = `
            <div class="dwd-lbl" title="${dwd.title}">${dwd.title}</div>
            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <button class="play-ep-btn" data-url="${dwd.url}" data-title="${dwd.title}">
                <i class="fa-solid fa-circle-play"></i> Play Online
              </button>
              <a href="${dwd.url}" class="dwd-btn-action" target="_blank" style="padding: 8px 14px;">
                <i class="fa-solid fa-circle-down"></i> Download
              </a>
            </div>
          `;
          
          // Attach Play handler
          const playBtn = item.querySelector('.play-ep-btn');
          playBtn.addEventListener('click', () => {
            const epUrl = playBtn.dataset.url;
            const epTitle = playBtn.dataset.title;
            playEpisode(epUrl, epTitle);
          });
        } else {
          item.innerHTML = `
            <div class="dwd-lbl" title="${dwd.title}">${dwd.title}</div>
            <a href="${dwd.url}" class="dwd-btn-action" target="_blank">
              <i class="fa-solid fa-circle-down"></i> Download Now
            </a>
          `;
        }
        movieDownloads.appendChild(item);
      });
    } else {
      movieDownloads.innerHTML = `
        <div class="no-links-msg">
          <i class="fa-solid fa-circle-xmark"></i>
          <span>No download links could be parsed for this release.</span>
        </div>
      `;
    }

    // Set up Video Player
    let hasPlayer = false;
    let streamOnline = false;

    // Verify direct stream availability in background (to prevent video element native error dialogs)
    if (movie.streamUrl) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000); // 2 second timeout limit
        
        const check = await fetch(movie.streamUrl, {
          method: 'GET',
          headers: { 'Range': 'bytes=0-0' }, // request first byte only
          signal: controller.signal
        });
        clearTimeout(timeout);
        
        if (check.ok || check.status === 206) {
          streamOnline = true;
        }
      } catch (err) {
        console.log('Direct stream is offline or unsupported:', err.message);
      }
    }

    // Configure Native Player (Direct Stream)
    if (movie.streamUrl && streamOnline) {
      currentDirectStreamUrl = movie.streamUrl;
      nativeVideoPlayer.src = movie.streamUrl;
      nativeVideoPlayer.load();
      directServerBtn.style.display = 'inline-block';
      hasPlayer = true;
    } else {
      currentDirectStreamUrl = null;
      nativeVideoPlayer.removeAttribute('src');
      nativeVideoPlayer.load();
      directServerBtn.style.display = 'none';
    }

    // Reset iframe buttons display style back to visible
    const allServerBtns = document.querySelectorAll('#player-servers .server-btn');
    allServerBtns.forEach(btn => {
      if (btn.id !== 'server-btn-direct') {
        btn.style.display = 'inline-block';
      }
    });

    const hasEpisodes = movie.downloads && movie.downloads.some(d => d.isEpisode);

    if (movie.imdbId || hasEpisodes) {
      if (movie.imdbId) {
        currentImdbId = movie.imdbId;
        
        // Determine if it is a show
        const lowerTitle = movie.title.toLowerCase();
        const isShow = currentCategory === 'tv-show' || 
                       currentCategory === 'web-series' || 
                       lowerTitle.includes('season') || 
                       /\bs\d+/i.test(lowerTitle) ||
                       /\bep\d+/i.test(lowerTitle) ||
                       lowerTitle.includes('complete');
                       
        currentMediaType = isShow ? 'tv' : 'movie';
      } else {
        currentImdbId = null;
        currentMediaType = 'tv';
      }
      hasPlayer = true;
    } else if (!movie.streamUrl || !streamOnline) {
      currentImdbId = null;
    }

    if (hasPlayer) {
      playerBoxContainer.style.display = 'block';
      
      // Set active player state based on availability
      const btns = document.querySelectorAll('#player-servers .server-btn');
      btns.forEach(btn => btn.classList.remove('active'));
      
      if (movie.streamUrl && streamOnline) {
        // Direct stream default (user preference)
        directServerBtn.classList.add('active');
        iframePlayerWrapper.style.display = 'none';
        videoPlayerIframe.src = '';
        nativePlayerWrapper.style.display = 'block';
      } else if (currentImdbId) {
        // Fallback to first available iframe server
        const firstIframeBtn = document.querySelector('.server-btn[data-src-prefix]');
        if (firstIframeBtn) {
          firstIframeBtn.classList.add('active');
          let prefix = firstIframeBtn.dataset.srcPrefix;
          if (currentMediaType === 'tv') {
            prefix = prefix.replace('/movie/', '/tv/');
          }
          videoPlayerIframe.src = `${prefix}${currentImdbId}`;
        }
        nativePlayerWrapper.style.display = 'none';
        iframePlayerWrapper.style.display = 'block';
      } else {
        // Missing IMDb ID and direct stream is down/offline, but show contains play online episodes!
        nativePlayerWrapper.style.display = 'block';
        iframePlayerWrapper.style.display = 'none';
        videoPlayerIframe.src = '';
        nativeVideoPlayer.removeAttribute('src');
        nativeVideoPlayer.load();
        
        // Hide iframe server buttons since IMDb is missing
        const iframeBtns = document.querySelectorAll('#player-servers .server-btn[data-src-prefix]');
        iframeBtns.forEach(btn => {
          btn.style.display = 'none';
        });
      }
    } else {
      playerBoxContainer.style.display = 'none';
      nativePlayerWrapper.style.display = 'none';
      iframePlayerWrapper.style.display = 'none';
    }

    // Switch display from skeleton to real content
    modalSkeleton.style.display = 'none';
    modalRealContent.style.display = 'block';
  } catch (error) {
    console.error('Failed to load movie details:', error);
    closeModal();
    alert(`Failed to load movie details: ${error.message}`);
  }
}

function closeModal() {
  detailModal.classList.remove('open');
  document.body.style.overflow = 'auto'; // Restore background scroll
  
  // Reset video player state to stop background audio playback
  videoPlayerIframe.src = '';
  nativeVideoPlayer.pause();
  nativeVideoPlayer.src = '';
  currentImdbId = null;

  // Reset aspect ratio UI state
  const aspectButtons = document.querySelectorAll('#player-aspects .aspect-btn');
  aspectButtons.forEach(btn => btn.classList.remove('active'));
  const fitBtn = document.querySelector('#player-aspects .aspect-btn[data-aspect="fit"]');
  if (fitBtn) fitBtn.classList.add('active');
  applyPlayerAspectRatio('fit');

  // If closed manually and hash exists, go back in history to clear hash
  if (window.location.hash === '#movie-details') {
    history.back();
  }
}

// Global popstate event handler for browser / Android Back Button modal close support
window.addEventListener('popstate', (event) => {
  if (detailModal.classList.contains('open')) {
    detailModal.classList.remove('open');
    document.body.style.overflow = 'auto';
    videoPlayerIframe.src = '';
    nativeVideoPlayer.pause();
    nativeVideoPlayer.src = '';
    currentImdbId = null;
  }
});

function applyPlayerAspectRatio(aspect) {
  const wrappers = [nativePlayerWrapper, iframePlayerWrapper];
  const ratioClasses = ['ratio-16-9', 'ratio-21-9', 'ratio-4-3', 'ratio-stretch', 'ratio-zoom'];
  
  wrappers.forEach(wrapper => {
    if (wrapper) {
      ratioClasses.forEach(cls => wrapper.classList.remove(cls));
      if (aspect !== 'fit') {
        wrapper.classList.add(`ratio-${aspect}`);
      }
    }
  });

  if (nativeVideoPlayer) {
    if (aspect === 'stretch') {
      nativeVideoPlayer.style.objectFit = 'fill';
    } else if (aspect === 'zoom') {
      nativeVideoPlayer.style.objectFit = 'cover';
    } else {
      nativeVideoPlayer.style.objectFit = 'contain';
    }
  }
}

function showLoader() {
  moviesGrid.style.display = 'none';
  skeletonLoader.style.display = 'grid';
  pagination.style.display = 'none';
}

function hideLoader() {
  skeletonLoader.style.display = 'none';
  moviesGrid.style.display = 'grid';
  pagination.style.display = 'flex';
}

function updatePaginationDisplay() {
  pageNumDisplay.textContent = `Page ${currentPage}`;
  prevBtn.disabled = currentPage === 1;
  nextBtn.disabled = !hasNextPage;
}

// Custom Glassmorphic Toast Notification for Player
function showPlayerToast(message) {
  // Check if there is an existing toast, remove it
  const existingToast = document.getElementById('player-toast-notification');
  if (existingToast) {
    existingToast.remove();
  }

  // Create toast element
  const toast = document.createElement('div');
  toast.id = 'player-toast-notification';
  toast.innerHTML = `<i class="fa-solid fa-circle-info" style="color: #00f2fe; margin-right: 8px;"></i>${message}`;
  
  // Apply beautiful glassmorphic CSS styles
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '30px',
    left: '50%',
    transform: 'translateX(-50%) translateY(20px)',
    background: 'rgba(18, 16, 28, 0.85)',
    backdropFilter: 'blur(10px)',
    '-webkit-backdrop-filter': 'blur(10px)',
    color: '#f3f3f5',
    padding: '12px 24px',
    borderRadius: '30px',
    border: '1px solid rgba(130, 87, 229, 0.4)',
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5), 0 0 15px rgba(130, 87, 229, 0.2)',
    zIndex: '9999',
    fontSize: '0.9rem',
    fontWeight: '500',
    fontFamily: "'Outfit', sans-serif",
    display: 'flex',
    alignItems: 'center',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    opacity: '0'
  });

  document.body.appendChild(toast);

  // Trigger animation (reflow + style update)
  setTimeout(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  }, 10);

  // Remove toast after 3.5 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3500);
}

// Play Episode on-demand handler
async function playEpisode(epUrl, epTitle) {
  showPlayerToast(`Loading Episode: ${epTitle}...`);
  
  // Parse Season and Episode
  let season = 1;
  let episode = 1;
  const sMatch = epTitle.match(/s(\d+)|season\s*(\d+)/i);
  if (sMatch) {
    season = parseInt(sMatch[1] || sMatch[2]);
  }
  const eMatch = epTitle.match(/ep(\d+)|episode\s*(\d+)/i);
  if (eMatch) {
    episode = parseInt(eMatch[1] || eMatch[2]);
  }
  
  currentSeason = season;
  currentEpisode = episode;

  console.log(`[Player] Playing Episode: Season ${season}, Episode ${episode}`);
  
  // Ensure player container is visible
  playerBoxContainer.style.display = 'block';
  
  // Smooth scroll to video player
  document.getElementById('player-box-container').scrollIntoView({ behavior: 'smooth' });

  const activeServerBtn = document.querySelector('#player-servers .server-btn.active');
  const serverId = activeServerBtn ? activeServerBtn.id : '';

  if (serverId === 'server-btn-direct') {
    try {
      const epId = epUrl.split('?id=')[1];
      const res = await fetch(`/api/episode-stream?id=${epId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      if (data.streamUrl) {
        iframePlayerWrapper.style.display = 'none';
        videoPlayerIframe.src = '';
        nativePlayerWrapper.style.display = 'block';
        nativeVideoPlayer.src = data.streamUrl;
        nativeVideoPlayer.load();
        nativeVideoPlayer.play().catch(e => console.log('Autoplay blocked:', e));
      } else {
        throw new Error('Stream URL empty');
      }
    } catch (err) {
      console.error('Failed to load direct stream:', err);
      showPlayerToast('Direct stream offline. Switching to Server 1...');
      const server1Btn = document.querySelector('#player-servers .server-btn[data-src-prefix]');
      if (server1Btn) {
        server1Btn.click();
        setTimeout(() => playEpisode(epUrl, epTitle), 100);
      }
    }
  } else if (currentImdbId) {
    let prefix = activeServerBtn.dataset.srcPrefix;
    let iframeSrc = '';
    
    if (prefix.includes('multiembed.mov')) {
      iframeSrc = `${prefix}${currentImdbId}&s=${season}&e=${episode}`;
    } else {
      prefix = prefix.replace('/movie/', '/tv/');
      iframeSrc = `${prefix}${currentImdbId}/${season}/${episode}`;
    }
    
    nativePlayerWrapper.style.display = 'none';
    nativeVideoPlayer.pause();
    iframePlayerWrapper.style.display = 'block';
    videoPlayerIframe.src = iframeSrc;
  } else {
    showPlayerToast('IMDb ID missing. Playing direct stream...');
    const directBtn = document.getElementById('server-btn-direct');
    if (directBtn) {
      directBtn.click();
      setTimeout(() => playEpisode(epUrl, epTitle), 100);
    }
  }
}
