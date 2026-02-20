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

// Add crypto for hashing (required by Meta)
const crypto = require('crypto');

// Helper function to hash data (Meta requires SHA256) [citation:1]
function hashData(value) {
    if (!value) return null;
    // Normalize: lowercase and trim
    const normalized = value.toString().toLowerCase().trim();
    return crypto.createHash('sha256').update(normalized).digest('hex');
}

// Create a new custom audience
app.post('/api/meta/custom-audience', async (req, res) => {
    const { name, customers, createNew } = req.body;
    
    if (!name || !customers || !Array.isArray(customers)) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    try {
        let audienceId;
        
        // Step 1: Create a new audience if requested [citation:1]
        if (createNew) {
            const createResponse = await fetch(
                `https://graph.facebook.com/v24.0/act_${accountId}/customaudiences`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: name,
                        subtype: 'CUSTOM',
                        customer_file_source: 'USER_PROVIDED_ONLY',
                        access_token: accessToken,
                        description: `Created from dashboard on ${new Date().toLocaleDateString()}`
                    })
                }
            );
            
            const createData = await createResponse.json();
            if (createData.error) throw new Error(createData.error.message);
            audienceId = createData.id;
        } else {
            // For existing audience, you'd need to pass the ID
            // This would come from a dropdown or input in the UI
            return res.status(400).json({ error: 'Existing audience sync not implemented yet' });
        }
        
        // Step 2: Prepare the payload with hashed customer data [citation:8]
        const schema = ['EMAIL', 'PHONE', 'FN', 'LN']; // Fields we're sending
        const data = customers.map(c => {
            const row = [];
            if (c.email) row.push(hashData(c.email));
            if (c.phone) row.push(hashData(c.phone));
            if (c.fn) row.push(hashData(c.fn));
            if (c.ln) row.push(hashData(c.ln));
            return row;
        }).filter(row => row.length > 0); // Only include rows with at least one identifier
        
        // Meta limits to 10,000 records per batch [citation:1]
        // For simplicity, we'll just take first 10,000
        const batches = [];
        for (let i = 0; i < Math.min(data.length, 10000); i += 10000) {
            batches.push(data.slice(i, i + 10000));
        }
        
        // Upload each batch
        let totalUploaded = 0;
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            const session_id = Date.now() + i; // Unique session ID
            
            const payload = {
                schema: schema.slice(0, batch[0].length), // Only include fields we actually have
                data: batch,
                session: {
                    session_id: session_id,
                    batch_seq: i + 1,
                    last_batch_flag: i === batches.length - 1,
                    estimated_num_total: data.length
                }
            };
            
            const uploadResponse = await fetch(
                `https://graph.facebook.com/v24.0/${audienceId}/users`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        payload: payload,
                        access_token: accessToken
                    })
                }
            );
            
            const uploadData = await uploadResponse.json();
            if (uploadData.error) {
                console.error('Batch upload error:', uploadData.error);
                // Continue with next batch even if one fails
            } else {
                totalUploaded += uploadData.num_received || 0;
            }
        }
        
        res.json({
            success: true,
            audienceId: audienceId,
            uploaded: totalUploaded,
            message: `Audience created. It may take up to 24 hours for matches to appear.`
        });
        
    } catch (error) {
        console.error('Custom audience error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Use port from environment (Hostinger provides this) or fallback to 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
