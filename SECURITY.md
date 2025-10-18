# Security Guide

## Keypair Security

### Development vs Production

#### ❌ Development (Current Setup)
```bash
# .env file
ADMIN_PRIVATE_KEY=[1,2,3,4,...]
```

**Risks:**
- Private key stored in plain text
- Easy to accidentally commit to git
- Anyone with file access can steal funds

**Use only for:**
- Local testing
- Devnet deployments
- Non-production environments

#### ✅ Production (Recommended)

### Option 1: AWS KMS (Recommended for most projects)

**Setup:**
1. Create KMS key in AWS Console
2. Encrypt your keypair:
   ```bash
   aws kms encrypt \
     --key-id alias/solana-admin \
     --plaintext fileb://keypair.json \
     --output text \
     --query CiphertextBlob > encrypted-key.txt
   ```
3. Store encrypted key in environment variable
4. Use AWS SDK to decrypt at runtime

**Code:**
```typescript
import { KMSClient, DecryptCommand } from '@aws-sdk/client-kms';

async function loadAdminKeypair() {
  const client = new KMSClient({ region: 'us-east-1' });
  const command = new DecryptCommand({
    CiphertextBlob: Buffer.from(process.env.ENCRYPTED_KEY, 'base64'),
  });
  const response = await client.send(command);
  return Keypair.fromSecretKey(new Uint8Array(response.Plaintext));
}
```

**Cost:** ~$1/month per key

### Option 2: Google Cloud KMS

**Setup:**
1. Create key ring and key in GCP Console
2. Encrypt keypair:
   ```bash
   gcloud kms encrypt \
     --location=global \
     --keyring=solana \
     --key=admin-key \
     --plaintext-file=keypair.json \
     --ciphertext-file=encrypted-key.enc
   ```
3. Use Google Cloud KMS SDK

**Code:**
```typescript
import { KeyManagementServiceClient } from '@google-cloud/kms';

async function loadAdminKeypair() {
  const client = new KeyManagementServiceClient();
  const [response] = await client.decrypt({
    name: 'projects/PROJECT/locations/global/keyRings/solana/cryptoKeys/admin-key',
    ciphertext: Buffer.from(process.env.ENCRYPTED_KEY, 'base64'),
  });
  return Keypair.fromSecretKey(new Uint8Array(response.plaintext));
}
```

### Option 3: Password-Encrypted Storage

**For smaller projects:**
```typescript
import { KeypairManager } from './utils/keypairManager';

// Encrypt keypair once
const encrypted = KeypairManager.encryptKeypair(adminKeypair, 'strong-password');
console.log('Store this:', encrypted);

// Load at runtime (password from secure source)
const keypair = KeypairManager.decryptKeypair(
  process.env.ENCRYPTED_KEYPAIR,
  process.env.KEYPAIR_PASSWORD
);
```

**Store password in:**
- AWS Secrets Manager
- Google Secret Manager
- HashiCorp Vault
- Environment variable (separate from encrypted key)

### Option 4: Multi-Sig with Squads Protocol

**Best for high-value operations:**
```typescript
// Requires multiple approvers to execute transactions
// See: https://squads.so/

// Example: 2-of-3 multisig
// - Admin 1 proposes transaction
// - Admin 2 or Admin 3 approves
// - Transaction executes
```

**Benefits:**
- No single point of failure
- Requires collusion to steal funds
- Audit trail of all approvals

---

## Environment Variable Security

### ❌ Bad Practice
```bash
# Committing .env to git
git add .env
git commit -m "Add config"
```

### ✅ Good Practice
```bash
# .gitignore
.env
.env.local
.env.production
*.key
*.pem

# Use separate env files per environment
.env.development
.env.staging
.env.production
```

### Production Deployment

**Vercel/Netlify:**
- Store secrets in dashboard
- Never in code or git

**AWS/GCP/Azure:**
- Use native secret management
- Rotate regularly

**Docker:**
```bash
# Pass secrets at runtime
docker run -e ADMIN_PRIVATE_KEY="$(cat encrypted-key.txt)" app
```

---

## Rate Limiting

Prevent abuse of admin endpoints:

```typescript
// Example with Express
import rateLimit from 'express-rate-limit';

const createVestingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per window
  message: 'Too many vesting creation requests',
});

app.post('/api/admin/create-vestings', createVestingLimiter, handler);
```

---

## Monitoring & Alerts

### Track Admin Wallet Balance

```typescript
// Check balance before operations
const balance = await connection.getBalance(adminKeypair.publicKey);
const minBalance = 0.1 * LAMPORTS_PER_SOL;

if (balance < minBalance) {
  // Send alert (email, Slack, PagerDuty)
  await sendAlert('Admin wallet balance low!');
  throw new Error('Insufficient admin balance');
}
```

### Log All Admin Operations

```typescript
// Log to database or monitoring service
await db.adminLogs.insert({
  action: 'create_vesting',
  admin_wallet: adminKeypair.publicKey.toBase58(),
  recipient: recipient.toBase58(),
  amount: amount,
  timestamp: new Date(),
  ip_address: req.ip,
});
```

### Set Up Alerts

**Monitor for:**
- Unusual transaction patterns
- Failed authentication attempts
- Low balance warnings
- Unexpected withdrawals
- High gas usage

**Tools:**
- Datadog
- New Relic
- Sentry
- Custom webhooks

---

## Access Control

### Admin Authentication

```typescript
// Verify admin signature before operations
import { sign } from 'tweetnacl';

function verifyAdminSignature(
  message: string,
  signature: Uint8Array,
  publicKey: PublicKey
): boolean {
  const messageBytes = new TextEncoder().encode(message);
  return sign.detached.verify(messageBytes, signature, publicKey.toBytes());
}

// In API endpoint
app.post('/api/admin/create-vestings', async (req, res) => {
  const { message, signature, publicKey } = req.body;
  
  // Verify signature
  if (!verifyAdminSignature(message, signature, new PublicKey(publicKey))) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Check if public key is authorized
  if (!AUTHORIZED_ADMINS.includes(publicKey)) {
    return res.status(403).json({ error: 'Unauthorized admin' });
  }
  
  // Proceed with operation
  // ...
});
```

### IP Whitelisting

```typescript
const ALLOWED_IPS = [
  '203.0.113.1', // Office IP
  '203.0.113.2', // VPN IP
];

app.use('/api/admin/*', (req, res, next) => {
  const clientIP = req.ip;
  if (!ALLOWED_IPS.includes(clientIP)) {
    return res.status(403).json({ error: 'IP not whitelisted' });
  }
  next();
});
```

---

## Backup & Recovery

### Backup Admin Keypair

1. **Physical backup:**
   - Write seed phrase on paper
   - Store in fireproof safe
   - Keep in multiple locations

2. **Digital backup:**
   - Encrypt with strong password
   - Store in password manager (1Password, Bitwarden)
   - Keep offline copy on USB drive

3. **Recovery procedure:**
   - Document step-by-step process
   - Test recovery regularly
   - Train team members

### Key Rotation

```typescript
// 1. Generate new admin keypair
const newAdmin = Keypair.generate();

// 2. Transfer authority to new keypair
// (Implementation depends on your setup)

// 3. Update all systems with new keypair

// 4. Revoke old keypair

// 5. Securely destroy old keypair
```

**Rotate keys:**
- Every 90 days (recommended)
- After team member leaves
- If compromise suspected
- After security incident

---

## Security Checklist

### Before Production

- [ ] Admin keypair stored in KMS/HSM (not .env)
- [ ] .env files in .gitignore
- [ ] Rate limiting on all admin endpoints
- [ ] Admin authentication implemented
- [ ] Monitoring and alerts configured
- [ ] Backup procedures documented
- [ ] Key rotation schedule set
- [ ] IP whitelisting configured (if applicable)
- [ ] All logs going to secure storage
- [ ] Security audit completed
- [ ] Incident response plan documented
- [ ] Team trained on security procedures

### Regular Maintenance

- [ ] Review admin logs weekly
- [ ] Check wallet balances daily
- [ ] Rotate keys quarterly
- [ ] Update dependencies monthly
- [ ] Test backup recovery quarterly
- [ ] Review access control lists monthly
- [ ] Audit transactions weekly

---

## Incident Response

### If Admin Key Compromised

1. **Immediate actions:**
   - Revoke compromised key
   - Transfer all funds to new wallet
   - Cancel all pending operations
   - Alert all stakeholders

2. **Investigation:**
   - Review all transactions
   - Check for unauthorized operations
   - Identify breach source
   - Document timeline

3. **Recovery:**
   - Generate new admin keypair
   - Update all systems
   - Notify affected users
   - Implement additional security measures

4. **Post-mortem:**
   - Document what happened
   - Identify root cause
   - Implement preventive measures
   - Update security procedures

### Emergency Contacts

```typescript
// Store emergency contacts securely
const EMERGENCY_CONTACTS = {
  security_lead: 'security@example.com',
  cto: 'cto@example.com',
  on_call: '+1-555-0100',
};

async function triggerSecurityAlert(incident: string) {
  // Send alerts to all emergency contacts
  // Use multiple channels (email, SMS, Slack)
}
```

---

## Additional Resources

- [Solana Security Best Practices](https://docs.solana.com/developing/programming-model/security)
- [AWS KMS Documentation](https://docs.aws.amazon.com/kms/)
- [Google Cloud KMS](https://cloud.google.com/kms/docs)
- [Squads Protocol (Multi-sig)](https://squads.so/)
- [OWASP Security Guidelines](https://owasp.org/)
