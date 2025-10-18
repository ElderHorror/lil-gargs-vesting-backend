# Admin Authentication Setup

Admin authentication is now handled via environment variables instead of the database.

## Setup

### 1. Set Admin Wallets

Add admin wallet addresses to your `.env` file:

```bash
# Single admin
ADMIN_WALLETS=FiKEWEJfcyd49MNwLvxnkzZbRJ2tm11zFUkZu11yFAud

# Multiple admins (comma-separated)
ADMIN_WALLETS=FiKEWEJfcyd49MNwLvxnkzZbRJ2tm11zFUkZu11yFAud,AnotherWallet123...,ThirdWallet456...
```

### 2. Configure on Render

In your Render dashboard:
1. Go to your service → Environment
2. Add environment variable:
   - Key: `ADMIN_WALLETS`
   - Value: `your_admin_wallet_1,your_admin_wallet_2`

### 3. Frontend Integration

The frontend should:
1. Connect user's Solana wallet
2. Send wallet address with admin requests:

```typescript
// Example API call
await api.put('/config', {
  gracePeriodDays: 30,
  adminWallet: wallet.publicKey.toBase58(), // Connected wallet
});
```

## How It Works

1. **Frontend**: User connects Solana wallet
2. **Request**: Wallet address sent as `adminWallet` parameter
3. **Backend**: Checks if wallet is in `ADMIN_WALLETS` env variable
4. **Response**: Authorized ✅ or Denied ❌

## Security

✅ **Advantages:**
- No database queries needed
- Faster authentication
- Easier to manage (just update ENV)
- Can't be changed by SQL injection

⚠️ **Important:**
- Never commit `.env` to git
- Keep admin wallet addresses private
- Rotate wallets if compromised
- Use hardware wallets for admin accounts

## Testing

Test admin auth:

```bash
# Should succeed (if wallet is in ADMIN_WALLETS)
curl -X PUT https://your-api.com/api/config \
  -H "Content-Type: application/json" \
  -d '{"adminWallet": "FiKEWEJfcyd49MNwLvxnkzZbRJ2tm11zFUkZu11yFAud", "gracePeriodDays": 30}'

# Should fail (unauthorized wallet)
curl -X PUT https://your-api.com/api/config \
  -H "Content-Type: application/json" \
  -d '{"adminWallet": "UnauthorizedWallet123...", "gracePeriodDays": 30}'
```

## Migration from Database

If you previously used database-based admin auth:

1. Get current admin wallet(s) from database
2. Add them to `ADMIN_WALLETS` environment variable
3. Deploy updated code
4. Old `admin_wallet` column in database is no longer used

No data migration needed - just set the ENV variable!
