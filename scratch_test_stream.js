const axios = require('axios');

async function testRedirect() {
  const streamId = 'aHR0cDovL2NkbjIuY2hlY2t5b3VybGlua3Muc2hvcC9IaW5kaS13ZWItc2VyaWVzLzE1NDU3L1RoZS1HcmVhdC1JbmRpYW4tS2FwaWwtU2hvdy0yMDI2LUhpbmRpLVM0RXAxLURlc2ktR2lybC1HbG9iYWwtU3dhZy1Qcml5YW5rYS1DaG9wcmEtRXBpc29kZS0xLS1oZC1bT2tKYXR0XS5tcDQ=';
  const url = `http://localhost:3000/api/stream-play?id=${streamId}`;
  
  console.log(`Querying local server: ${url}`);
  try {
    const response = await axios.get(url, {
      maxRedirects: 0, // don't follow, check redirect headers
      validateStatus: status => status === 302
    });
    console.log(`Success! Status: ${response.status}`);
    console.log(`Redirect Location: ${response.headers.location}`);
  } catch (error) {
    console.error(`Failed! Error: ${error.message}`);
  }
}

testRedirect();
