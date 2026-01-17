require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');

// Configuration
const BOT_TOKEN = process.env.BOT_TOKEN;

// Channel mappings for different categories
const CHANNEL_MAPPINGS = [
  {
    name: 'MTG',
    source: process.env.MTG_SOURCE_CHANNEL_ID,
    target: process.env.MTG_TARGET_CHANNEL_ID,
    roleId: process.env.MTG_ROLE_ID
  },
  {
    name: 'Pokemon',
    source: process.env.POKEMON_SOURCE_CHANNEL_ID,
    target: process.env.POKEMON_TARGET_CHANNEL_ID,
    roleId: process.env.POKEMON_ROLE_ID
  },
  {
    name: 'One Piece',
    source: process.env.ONEPIECE_SOURCE_CHANNEL_ID,
    target: process.env.ONEPIECE_TARGET_CHANNEL_ID,
    roleId: process.env.ONEPIECE_ROLE_ID
  }
];

// Load proxies from file
let proxies = [];
try {
  const proxyData = fs.readFileSync('proxies.txt', 'utf-8');
  proxies = proxyData.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const [ip, port, username, password] = line.split(':');
      return `http://${username}:${password}@${ip}:${port}`;
    });
  console.log(`✅ Loaded ${proxies.length} proxies`);
} catch (error) {
  console.log('⚠️ No proxies.txt found, will fetch without proxy');
}

// Get random proxy
function getRandomProxy() {
  if (proxies.length === 0) return null;
  return proxies[Math.floor(Math.random() * proxies.length)];
}

// Site URL builders and metadata
const siteUrls = {
  walmartca: {
    url: (productId) => `https://www.walmart.ca/en/ip/${productId}`,
    name: 'Walmart Canada',
    color: 0x0071CE // Walmart blue
  },
  bestbuyca: {
    url: (productId) => `https://www.bestbuy.ca/en-ca/product/${productId}`,
    name: 'Best Buy Canada',
    color: 0xFFF200 // Best Buy yellow
  },
  amazonca: {
    url: (productId) => `https://www.amazon.ca/dp/${productId}`,
    name: 'Amazon Canada',
    color: 0xFF9900 // Amazon orange
  },
  canadiantire: {
    url: (productId) => `https://www.canadiantire.ca/en/pdp/${productId}.html`,
    name: 'Canadian Tire',
    color: 0xE31E24 // CT red
  },
  toysrus: {
    url: (productId) => `https://www.toysrus.ca/en/${productId}`,
    name: 'Toys R Us',
    color: 0xFF6B9D // Pink
  },
};

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Parse Stellar's message format
function parseStellarMessage(message) {
  let site = '';
  let productId = '';
  let timestamp = '';
  
  // First try to parse from embed fields (Stellar's actual format)
  if (message.embeds.length > 0) {
    const embed = message.embeds[0];
    
    // Parse from fields
    if (embed.fields && embed.fields.length > 0) {
      const siteField = embed.fields.find(f => f.name === 'Site');
      const productField = embed.fields.find(f => f.name === 'Product');
      
      if (siteField) site = siteField.value.toLowerCase();
      if (productField) productId = productField.value;
    }
    
    // Get timestamp from footer
    if (embed.footer?.text) {
      timestamp = embed.footer.text.split('|')[1]?.trim() || '';
    }
  }
  
  // Fallback: try to parse from description or content
  if (!site || !productId) {
    let content = message.content;
    if (message.embeds.length > 0 && message.embeds[0].description) {
      content = message.embeds[0].description;
    }
    
    const lines = content.split('\n').map(l => l.trim()).filter(l => l);
    
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
  }
  
  return { site, productId, timestamp };
}

// Build product URL and get site info
function getSiteInfo(site, productId) {
  const siteData = siteUrls[site];
  if (siteData) {
    return {
      url: siteData.url(productId),
      name: siteData.name,
      color: siteData.color
    };
  }
  return null;
}

// Check if message is from Stellar webhook
function isStellarMessage(message) {
  // Check if it's a webhook
  const hasWebhookId = message.webhookId !== null;
  
  // Check content
  const contentCheck = message.content.includes('@stellara_io') || 
                      message.content.includes('stellara') ||
                      message.content.includes('Monitor Notification') || 
                      message.content.includes('Site');
  
  // Check embeds
  const embedCheck = message.embeds.length > 0 && 
                     message.embeds.some(e => 
                       e.description?.includes('@stellara_io') ||
                       e.description?.includes('Site') ||
                       e.footer?.text?.includes('stellara')
                     );
  
  console.log('Message check:', {
    webhookId: hasWebhookId,
    author: message.author.username,
    hasContent: message.content.length > 0,
    hasEmbeds: message.embeds.length > 0,
    contentMatch: contentCheck,
    embedMatch: embedCheck
  });
  
  return hasWebhookId && (contentCheck || embedCheck);
}

// Bot ready event
client.once('ready', () => {
  console.log(`🤖 Bot logged in as ${client.user.tag}`);
  console.log(`📡 Monitoring channels:`);
  CHANNEL_MAPPINGS.forEach(mapping => {
    console.log(`   ${mapping.name}: ${mapping.source} → ${mapping.target}`);
  });
});

// Message event handler
client.on('messageCreate', async (message) => {
  try {
    // Find which channel mapping this message belongs to
    const channelMapping = CHANNEL_MAPPINGS.find(m => m.source === message.channelId);
    
    // Only process messages in configured source channels
    if (!channelMapping) return;
    
    // Only process Stellar webhook messages
    if (!isStellarMessage(message)) return;
    
    console.log(`📥 Stellar message detected in ${channelMapping.name} channel, reformatting...`);
    
    // Debug: log the full message structure
    console.log('Message content:', message.content);
    console.log('Embed count:', message.embeds.length);
    if (message.embeds.length > 0) {
      console.log('Embed description:', message.embeds[0].description);
      console.log('Embed fields:', message.embeds[0].fields);
      console.log('Embed title:', message.embeds[0].title);
    }
    
    // Parse the message
    const { site, productId, timestamp } = parseStellarMessage(message);
    
    if (!site || !productId) {
      console.log('⚠️ Could not parse site or product ID');
      return;
    }
    
    // Get site info
    const siteInfo = getSiteInfo(site, productId);
    
    if (!siteInfo) {
      console.log(`⚠️ No URL builder configured for ${site}`);
      return;
    }
    
    // Fetch product name from the URL using proxy
    let productName = 'Product';
    try {
      const proxyUrl = getRandomProxy();
      const fetchOptions = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        }
      };
      
      // Add proxy if available
      if (proxyUrl) {
        fetchOptions.agent = new HttpsProxyAgent(proxyUrl);
        console.log(`🔄 Using proxy: ${proxyUrl.split('@')[1]}`);
      }
      
      const response = await fetch(siteInfo.url, fetchOptions);
      const html = await response.text();
      
      // Try to extract title from HTML
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        productName = titleMatch[1]
          .replace(/- Walmart\.ca/gi, '')
          .replace(/- Best Buy Canada/gi, '')
          .replace(/- Amazon\.ca/gi, '')
          .replace(/- Canadian Tire/gi, '')
          .replace(/- Toys R Us/gi, '')
          .replace(/\|.*$/g, '')
          .trim();
        
        // If still too long, truncate
        if (productName.length > 100) {
          productName = productName.substring(0, 97) + '...';
        }
      }
    } catch (error) {
      console.log('⚠️ Could not fetch product name:', error.message);
    }
    
    // Calculate time since detection
    const now = new Date();
    const detectionTime = timestamp ? new Date(timestamp.replace(' ', 'T')) : now;
    const secondsAgo = Math.floor((now - detectionTime) / 1000);
    
    let timeAgoText = '';
    if (secondsAgo < 60) {
      timeAgoText = `${secondsAgo} second${secondsAgo !== 1 ? 's' : ''} ago`;
    } else if (secondsAgo < 3600) {
      const minutes = Math.floor(secondsAgo / 60);
      timeAgoText = `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    } else {
      const hours = Math.floor(secondsAgo / 3600);
      timeAgoText = `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    }
    
    // Create embed
    const embed = new EmbedBuilder()
      .setTitle(`${productName}`)
      .setURL(siteInfo.url)
      .setColor(siteInfo.color)
      .setDescription(`**✅ IN STOCK NOW**\n\n**[Click here to view & purchase](${siteInfo.url})**`)
      .addFields(
        { name: 'Retailer', value: siteInfo.name, inline: true },
        { name: 'Product ID', value: `\`${productId}\``, inline: true },
        { name: 'Detected', value: timeAgoText, inline: true }
      )
      .setFooter({ text: `CCZ Monitor • Detected at ${timestamp || now.toISOString()}` })
      .setTimestamp();
    
    // Get the target channel from the mapping
    const targetChannel = await client.channels.fetch(channelMapping.target);
    
    if (!targetChannel) {
      console.error(`❌ Target channel not found for ${channelMapping.name}!`);
      return;
    }
    
    // Send the formatted embed to TARGET channel with role ping
    const rolePing = channelMapping.roleId ? `<@&${channelMapping.roleId}>` : '';
    await targetChannel.send({ 
      content: rolePing,
      embeds: [embed] 
    });
    
    console.log(`✅ Reformatted message sent to ${channelMapping.name} alerts: ${site} - ${productId}`);
    
  } catch (error) {
    console.error('❌ Error processing message:', error.message);
  }
});

// Login to Discord
client.login(BOT_TOKEN);