const express = require('express');
const cors = require('cors');
const bizSdk = require('facebook-nodejs-business-sdk');
const crypto = require('crypto');

const app = express();

// Essential middleware
app.use(cors());
app.use(express.json()); // Required to read req.body

// Environment variables – set these in your hosting environment
const accessToken = process.env.META_ACCESS_TOKEN;
const accountId = process.env.META_ACCOUNT_ID;   // numeric ID only, e.g., "123456789"

if (!accessToken || !accountId) {
    console.error('ERROR: Missing required environment variables META_ACCESS_TOKEN and/or META_ACCOUNT_ID');
    process.exit(1);
}

// Initialize Facebook SDK for the insights endpoint
const FacebookAdsApi = bizSdk.FacebookAdsApi;
const AdAccount = bizSdk.AdAccount;
FacebookAdsApi.init(accessToken);
const account = new AdAccount(accountId);

// ----------------------------------------------------------------------
// 1. GET endpoint for campaign insights (existing functionality)
// ----------------------------------------------------------------------
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

// ----------------------------------------------------------------------
// 2. Helper: hash data for Custom Audiences (Meta requires SHA256)
// ----------------------------------------------------------------------
function hashData(value) {
    if (!value) return null;
    // Normalize: lowercase and trim
    const normalized = value.toString().toLowerCase().trim();
    return crypto.createHash('sha256').update(normalized).digest('hex');
}

// ----------------------------------------------------------------------
// 3. POST endpoint to create a Custom Audience from CRM data
// ----------------------------------------------------------------------
app.post('/api/meta/custom-audience', async (req, res) => {
    const { name, customers } = req.body; // customers = array of { email, phone, fn, ln }

    if (!name || !customers || !Array.isArray(customers)) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // --- Step 1: Create a new Custom Audience (empty) ---
        const createResponse = await fetch(
            `https://graph.facebook.com/v22.0/act_${accountId}/customaudiences?access_token=${accessToken}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name,
                    subtype: 'CUSTOM',
                    customer_file_source: 'USER_PROVIDED_ONLY',
                    description: `Created from dashboard on ${new Date().toLocaleDateString()}`
                })
            }
        );

        const createData = await createResponse.json();
        if (createData.error) {
            throw new Error(`Meta API error (create): ${createData.error.message}`);
        }
        const audienceId = createData.id;
        console.log(`Audience created with ID: ${audienceId}`);

        // --- Step 2: Prepare hashed customer data, grouped by available fields ---
        // Meta requires that every row in a batch has exactly the same set of fields.
        // We'll group records by which of the four fields are present.
        const fieldGroups = {
            // Key is a string like "email,phone,fn,ln" for the fields that are present
        };
        const allFields = ['EMAIL', 'PHONE', 'FN', 'LN'];

        customers.forEach(c => {
            const fieldsPresent = [];
            const row = [];
            if (c.email) {
                fieldsPresent.push('EMAIL');
                row.push(hashData(c.email));
            }
            if (c.phone) {
                fieldsPresent.push('PHONE');
                row.push(hashData(c.phone));
            }
            if (c.fn) {
                fieldsPresent.push('FN');
                row.push(hashData(c.fn));
            }
            if (c.ln) {
                fieldsPresent.push('LN');
                row.push(hashData(c.ln));
            }
            if (row.length === 0) return; // skip records with no identifiers

            const key = fieldsPresent.join(',');
            if (!fieldGroups[key]) {
                fieldGroups[key] = {
                    schema: fieldsPresent,
                    data: []
                };
            }
            fieldGroups[key].data.push(row);
        });

        // If no valid data after grouping
        if (Object.keys(fieldGroups).length === 0) {
            return res.status(400).json({ error: 'No valid customer data to upload' });
        }

        // Meta accepts up to 10,000 records per batch. We'll process each group separately,
        // splitting large groups into multiple batches.
        const BATCH_SIZE = 10000;
        let totalUploaded = 0;

        for (const [key, group] of Object.entries(fieldGroups)) {
            const schema = group.schema;
            const rows = group.data;
            const totalRows = rows.length;

            for (let i = 0; i < totalRows; i += BATCH_SIZE) {
                const batch = rows.slice(i, i + BATCH_SIZE);
                const session_id = `${Date.now()}_${key}_${i}`; // unique session per batch

                const payload = {
                    schema: schema,
                    data: batch,
                    session: {
                        session_id: session_id,
                        batch_seq: Math.floor(i / BATCH_SIZE) + 1,
                        last_batch_flag: i + BATCH_SIZE >= totalRows,
                        estimated_num_total: totalRows
                    }
                };

                const uploadResponse = await fetch(
                    `https://graph.facebook.com/v22.0/${audienceId}/users?access_token=${accessToken}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ payload })
                    }
                );

                const uploadData = await uploadResponse.json();
                if (uploadData.error) {
                    console.error('Batch upload error:', uploadData.error);
                    // Continue with next batches even if one fails
                } else {
                    totalUploaded += uploadData.num_received || 0;
                }
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

// ----------------------------------------------------------------------
// 4. Start the server
// ----------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});