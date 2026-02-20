const express = require('express');
const cors = require('cors');
const bizSdk = require('facebook-nodejs-business-sdk');

const app = express();
app.use(cors());

// Read environment variables (set these in Hostinger)
const accessToken = process.env.META_ACCESS_TOKEN;
const accountId = process.env.META_ACCOUNT_ID;

// Validate required variables
if (!accessToken || !accountId) {
    console.error('ERROR: Missing required environment variables META_ACCESS_TOKEN and/or META_ACCOUNT_ID');
    process.exit(1);
}

// Initialize Facebook SDK
const FacebookAdsApi = bizSdk.FacebookAdsApi;
const AdAccount = bizSdk.AdAccount;
FacebookAdsApi.init(accessToken);
const account = new AdAccount(accountId);

// API endpoint
app.get('/api/meta-ads', async (req, res) => {
    console.log('Received request with query:', req.query);
    const since = req.query.since || '2025-01-01';
    const until = req.query.until || '2025-01-30';

    const fields = [
        'campaign_name',
        'impressions',
        'clicks',
        'spend',
        'cpc',
        'ctr',
        'date_start',
        'date_stop'
    ];
    const params = {
        level: 'campaign',
        time_range: { since, until }
    };

    try {
        const insights = await account.getInsights(fields, params);
        res.json(insights);
    } catch (error) {
        console.error('Meta API error:', error);
        res.status(500).json({ error: 'Failed to fetch data from Meta' });
    }
});

// Use port from environment (Hostinger provides this) or fallback to 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});