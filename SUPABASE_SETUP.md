# Supabase Setup Guide

## Prerequisites

- Supabase account (free tier works)
- Node.js project set up

## Step 1: Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Click "New Project"
3. Fill in:
   - Name: `vesting-system`
   - Database Password: (generate strong password)
   - Region: (choose closest to your users)
4. Wait for project to be created (~2 minutes)

## Step 2: Run Database Schema

1. In Supabase dashboard, go to **SQL Editor**
2. Click "New Query"
3. Copy contents of `supabase/schema.sql`
4. Paste and click "Run"
5. Verify tables created:
   - Go to **Table Editor**
   - Should see: `config`, `vestings`, `claim_history`, `admin_logs`

## Step 3: Insert Initial Config

```sql
INSERT INTO config (
  admin_wallet,
  collection_address,
  token_mint,
  nft_threshold,
  total_vesting_amount,
  vesting_start_time,
  vesting_cliff_time,
  vesting_end_time,
  fee_wallet,
  claim_fee_sol
) VALUES (
  'YOUR_ADMIN_WALLET_ADDRESS',
  'YOUR_NFT_COLLECTION_ADDRESS',
  'YOUR_TOKEN_MINT_ADDRESS',
  20,
  10000000000000, -- 10,000 tokens (9 decimals)
  NOW() + INTERVAL '1 day',
  NOW() + INTERVAL '2 days',
  NOW() + INTERVAL '32 days',
  'YOUR_FEE_WALLET_ADDRESS',
  0.01
);
```

## Step 4: Get API Keys

1. Go to **Settings** → **API**
2. Copy these values:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon public key**: For frontend (safe to expose)
   - **service_role key**: For backend (KEEP SECRET!)

## Step 5: Install Supabase Client

```bash
npm install @supabase/supabase-js
```

## Step 6: Configure Environment Variables

Add to `.env`:

```bash
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

⚠️ **NEVER commit `SUPABASE_SERVICE_ROLE_KEY` to git!**

## Step 7: Test Connection

Create `src/testSupabase.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';
import { SupabaseService } from './services/supabaseService';

async function test() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const dbService = new SupabaseService(supabase);

  // Test: Get config
  const config = await dbService.getConfig();
  console.log('Config:', config);

  // Test: Get stats
  const stats = await dbService.getStats();
  console.log('Stats:', stats);
}

test().catch(console.error);
```

Run:
```bash
npx ts-node src/testSupabase.ts
```

## Step 8: Set Up Row Level Security (RLS)

RLS is already configured in the schema, but verify:

1. Go to **Authentication** → **Policies**
2. Check each table has policies enabled
3. Test with different user roles

### Testing RLS

```typescript
// As authenticated user (can only see their own data)
const userClient = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
    },
  }
);

// Set user context (in production, this comes from JWT)
await userClient.auth.setSession({
  access_token: 'user_jwt_token',
  refresh_token: 'refresh_token',
});

// User can only see their own vesting
const { data } = await userClient
  .from('vestings')
  .select('*');
// Returns only vestings where user_wallet matches JWT claim
```

## Step 9: Set Up Realtime (Optional)

Enable realtime updates for tables:

1. Go to **Database** → **Replication**
2. Enable replication for:
   - `vestings`
   - `claim_history`
3. In your frontend:

```typescript
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Subscribe to vesting changes
const subscription = supabase
  .channel('vestings')
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'vestings',
      filter: `user_wallet=eq.${userWallet}`,
    },
    (payload) => {
      console.log('Vesting updated:', payload);
      // Update UI
    }
  )
  .subscribe();
```

## Step 10: Set Up Cron Jobs (Optional)

For automated eligibility checks:

1. Install Supabase CLI:
   ```bash
   npm install -g supabase
   ```

2. Create Edge Function:
   ```bash
   supabase functions new verify-eligibility
   ```

3. Edit `supabase/functions/verify-eligibility/index.ts`:
   ```typescript
   import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
   import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

   serve(async (req) => {
     const supabase = createClient(
       Deno.env.get('SUPABASE_URL')!,
       Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
     );

     // Your eligibility verification logic here
     // ...

     return new Response(JSON.stringify({ success: true }), {
       headers: { 'Content-Type': 'application/json' },
     });
   });
   ```

4. Deploy:
   ```bash
   supabase functions deploy verify-eligibility
   ```

5. Set up cron (using external service like cron-job.org):
   - URL: `https://xxxxx.supabase.co/functions/v1/verify-eligibility`
   - Schedule: Every 6 hours
   - Add header: `Authorization: Bearer YOUR_ANON_KEY`

## Database Maintenance

### Backup

Supabase automatically backs up your database daily (free tier: 7 days retention).

Manual backup:
```bash
# Install pg_dump
pg_dump -h db.xxxxx.supabase.co -U postgres -d postgres > backup.sql
```

### Indexes

Monitor slow queries:
1. Go to **Database** → **Query Performance**
2. Add indexes for slow queries

Example:
```sql
CREATE INDEX idx_custom ON vestings(user_wallet, is_active) WHERE is_cancelled = FALSE;
```

### Vacuum

Run periodically to reclaim space:
```sql
VACUUM ANALYZE vestings;
VACUUM ANALYZE claim_history;
```

## Security Checklist

- [ ] RLS policies enabled on all tables
- [ ] Service role key stored securely (not in git)
- [ ] API rate limiting configured
- [ ] Database password is strong
- [ ] Regular backups scheduled
- [ ] Monitoring alerts set up
- [ ] Only necessary columns exposed via RLS
- [ ] Admin actions logged
- [ ] User authentication implemented

## Troubleshooting

### "relation does not exist"
- Run the schema.sql again
- Check you're connected to the right project

### "permission denied"
- Check RLS policies
- Verify you're using service_role key for admin operations

### "duplicate key value"
- Check for unique constraint violations
- Verify wallet addresses are unique

### Slow queries
- Add indexes
- Use `EXPLAIN ANALYZE` to debug
- Consider pagination for large result sets

## Production Checklist

- [ ] Upgrade to Pro plan (better performance, more storage)
- [ ] Set up custom domain
- [ ] Configure connection pooling
- [ ] Set up monitoring (Datadog, New Relic)
- [ ] Enable point-in-time recovery
- [ ] Set up staging environment
- [ ] Document all custom functions
- [ ] Train team on Supabase dashboard
- [ ] Set up alerting for errors
- [ ] Configure backup retention policy

## Resources

- [Supabase Docs](https://supabase.com/docs)
- [Supabase JS Client](https://supabase.com/docs/reference/javascript/introduction)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [Edge Functions](https://supabase.com/docs/guides/functions)
- [Realtime](https://supabase.com/docs/guides/realtime)
