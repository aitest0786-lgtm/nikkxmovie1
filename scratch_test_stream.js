const axios = require('axios');

async function testMergedSearch() {
  const query = 'Kapil';
  const url = `http://localhost:3000/api/movies?page=1&s=${encodeURIComponent(query)}&search_category=all`;
  console.log(`Querying merged search API: ${url}`);
  
  try {
    const response = await axios.get(url, { timeout: 10000 });
    console.log("Status:", response.status);
    console.log("Total Movies returned:", response.data.movies ? response.data.movies.length : 0);
    if (response.data.movies) {
      response.data.movies.forEach((m, i) => {
        const decodedId = Buffer.from(m.detailId, 'base64').toString('utf8');
        console.log(`[${i}] Title: "${m.title}" | Decoded ID: "${decodedId}"`);
      });
    }
  } catch (error) {
    console.error("Failed:", error.message);
  }
}

testMergedSearch();
