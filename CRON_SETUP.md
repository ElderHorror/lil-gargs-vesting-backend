# External Cron Job Setup

This guide explains how to set up external cron jobs to trigger scheduled tasks for your vesting system.

## Why External Cron?

Render's cron jobs require a paid plan. Instead, we use free external cron services to call API endpoints on your backend.

## Setup Steps

### 1. Generate a Cron Secret

Generate a secure random string for `CRON_SECRET`:

```bash
# On Linux/Mac
openssl rand -hex 32

# Or use any password generator
```

Add this to your Render environment variables:
- Key: `CRON_SECRET`
- Value: `your-generated-secret-here`

### 2. Choose a Free Cron Service

**Recommended Services:**
- **[cron-job.org](https://cron-job.org)** - Free, reliable, easy to use
- **[EasyCron](https://www.easycron.com)** - Free tier available
- **[Pipedream](https://pipedream.com)** - Free with generous limits

### 3. Configure Cron Jobs

#### Job 1: Snapshot Checker (Hourly)

**URL:** `https://your-backend.onrender.com/api/cron/snapshot`  
**Method:** POST  
**Schedule:** Every hour (e.g., `0 * * * *`)  
**Headers:**
```
X-Cron-Secret: your-cron-secret-here
Content-Type: application/json
```

#### Job 2: Dynamic Pool Sync (Daily)

**URL:** `https://your-backend.onrender.com/api/cron/sync-dynamic`  
**Method:** POST  
**Schedule:** Daily at 2 AM UTC (e.g., `0 2 * * *`)  
**Headers:**
```
X-Cron-Secret: your-cron-secret-here
Content-Type: application/json
```

### 4. Test the Endpoints

Test using curl:

```bash
# Test snapshot endpoint
curl -X POST https://your-backend.onrender.com/api/cron/snapshot \
  -H "X-Cron-Secret: your-cron-secret-here" \
  -H "Content-Type: application/json"

# Test dynamic sync endpoint
curl -X POST https://your-backend.onrender.com/api/cron/sync-dynamic \
  -H "X-Cron-Secret: your-cron-secret-here" \
  -H "Content-Type: application/json"

# Health check (no auth required)
curl https://your-backend.onrender.com/api/cron/health
```

## Example: Setting up on cron-job.org

1. **Sign up** at [cron-job.org](https://cron-job.org)
2. **Create new cron job**:
   - Title: "Vesting Snapshot Checker"
   - URL: `https://your-backend.onrender.com/api/cron/snapshot`
   - Schedule: Every hour
   - Request method: POST
   - Request headers: Add `X-Cron-Secret` with your secret
3. **Repeat** for dynamic sync job (daily schedule)

## Monitoring

- Check cron job execution logs in your chosen service
- View Render logs to see if endpoints are being called
- Use `/api/cron/health` to verify the service is running

## Security

- ✅ Never commit `CRON_SECRET` to git
- ✅ Use HTTPS only
- ✅ Rotate the secret periodically
- ✅ Monitor for unauthorized access attempts

## Troubleshooting

**"Invalid cron secret" error:**
- Verify `CRON_SECRET` is set in Render
- Check the header name is exactly `X-Cron-Secret`
- Ensure no extra spaces in the secret value

**Endpoint not responding:**
- Check if your Render service is running
- Verify the URL is correct
- Check Render logs for errors

**Jobs not running:**
- Verify cron schedule syntax
- Check if the external service is active
- Look for execution logs in the cron service dashboard
