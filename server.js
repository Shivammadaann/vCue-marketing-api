const express = require('express');
const cors = require('cors');
const bizSdk = require('facebook-nodejs-business-sdk');

const app = express();
const port = 3000;

app.use(cors());

if (!accessToken || !accountId) {
    console.error('ERROR: Missing required environment variables');
    process.exit(1);
}
const FacebookAdsApi = bizSdk.FacebookAdsApi;
const AdAccount = bizSdk.AdAccount;

FacebookAdsApi.init(accessToken);
const account = new AdAccount(accountId);

app.get('/api/meta-ads', async (req, res) => {
    console.log('Received request...');
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
        'level': 'campaign',
        'time_range': { since, until }
    };

    try {
        const insights = await account.getInsights(fields, params);
        res.json(insights);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});