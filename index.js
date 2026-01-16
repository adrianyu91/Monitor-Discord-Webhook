const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Configuration - REPLACE THESE!
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL 
const SECRET_KEY = process.env.SECRET_KEY;

// Site URL builders
const siteUrls = {
  walmartca: (productId) => `https://www.walmart.ca/en/ip/${productId}`,
  bestbuyca: (productId) => `https://www.bestbuy.ca/en-ca/product/${productId}`,
  amazonca: (productId) => `https://www.amazon.ca/dp/${productId}`,
  canadiantire: (productId) => `https://www.canadiantire.ca/en/pdp/${productId}.html`,
  toysrus: (productId) => `https://www.toysrus.ca/en/${productId}`,
  // Add more sites as needed
};

// Parse Stellar's message format
function parseStellarMessage(content) {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l);
  
  let site = '';
  let productId = '';
  let timestamp = '';
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === 'Site' && lines[i + 1]) {
      site = lines[i + 1].toLowerCase();
    }
    if (lines[i] === 'Product' && lines[i + 1]) {
      productId = lines[i + 1];
    }
    if (lines[i].includes('@stellara_io')) {
      timestamp = lines[i].split('|')[1]?.trim() || '';
    }
  }
  
  return { site, productId, timestamp };
}

// Build product URL
function buildProductUrl(site, productId) {
  const builder = siteUrls[site];
  if (builder) {
    return builder(productId);
  }
  return null;
}

// Route to receive webhooks from Stellar
app.post('/webhook', async (req, res) => {
  try {
    // Check secret key for security
    const providedSecret = req.query.secret || req.headers['x-secret-key'];
    
    if (providedSecret !== SECRET_KEY) {
      console.log('Unauthorized webhook attempt');
      return res.status(401).send('Unauthorized');
    }
    
    const { content, embeds } = req.body;
    
    // Parse the message
    let parsedData;
    if (content) {
      parsedData = parseStellarMessage(content);
    } else if (embeds && embeds[0]?.description) {
      parsedData = parseStellarMessage(embeds[0].description);
    } else {
      return res.status(400).send('Invalid webhook format');
    }
    
    const { site, productId, timestamp } = parsedData;
    
    if (!site || !productId) {
      return res.status(400).send('Missing site or product ID');
    }
    
    // Build product URL
    const productUrl = buildProductUrl(site, productId);
    
    // Create Discord embed
    const discordEmbed = {
      embeds: [{
        title: '🔔 Monitor Notification',
        color: 0x00ff00, // Green
        fields: [
          {
            name: 'Site',
            value: site.toUpperCase(),
            inline: true
          },
          {
            name: 'Product ID',
            value: productId,
            inline: true
          }
        ],
        footer: {
          text: `Stellar AIO | ${timestamp || new Date().toISOString()}`
        },
        timestamp: new Date().toISOString()
      }]
    };
    
    // Add URL field if we could build it
    if (productUrl) {
      discordEmbed.embeds[0].description = `**[🛒 Click here to view product](${productUrl})**`;
    } else {
      discordEmbed.embeds[0].description = `⚠️ URL builder not configured for ${site}`;
    }
    
    // Send to Discord
    await axios.post(DISCORD_WEBHOOK_URL, discordEmbed);
    
    console.log(`✅ Webhook processed: ${site} - ${productId}`);
    res.status(200).send('Webhook processed successfully');
    
  } catch (error) {
    console.error('Error processing webhook:', error.message);
    res.status(500).send('Error processing webhook');
  }
});

// Health check endpoint
app.get('/', (req, res) => {
  res.send('🚀 Stellar AIO Webhook Reformatter is running!');
});

// Test endpoint to check if webhook works (remove in production)
app.get('/test', (req, res) => {
  res.json({
    status: 'OK',
    webhookUrl: DISCORD_WEBHOOK_URL ? '✅ Configured' : '❌ Not configured',
    secretKey: SECRET_KEY !== 'YOUR_SECRET_KEY_HERE' ? '✅ Configured' : '❌ Not configured'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Webhook endpoint: /webhook?secret=${SECRET_KEY}`);
});