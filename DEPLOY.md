# Deploying BunBite to Fly.io

BunBite runs as a single Bun machine with a mounted SQLite volume. One machine only
(SQLite is single writer). The app is fully usable on the free tier without Stripe;
billing endpoints return 503 until the Stripe secrets below are set.

## 1. Authenticate (you, once)
```bash
fly auth login            # opens a browser
# or, headless:  export FLY_API_TOKEN=...   (fly tokens create deploy)
```

## 2. Create the app + volume + deploy
```bash
fly apps create bunbite                              # pick another name if taken
fly volumes create bunbite_data --region fra --size 1
fly deploy --ha=false                                # --ha=false keeps it to ONE machine
```
If you used a different app name, edit `PUBLIC_BASE_URL` in `fly.toml` to
`https://<your-app>.fly.dev` and run `fly deploy --ha=false` again.

Verify:
```bash
fly status                       # must show exactly ONE machine
curl https://<app>.fly.dev/api/health     # {"status":"ok",...}
curl https://<app>.fly.dev/api/config     # {"billing":false} until step 4
```

## 3. Create Stripe products + prices (test mode)
With your `sk_test_` key, the prices can be created by API (the agent can run this for you):
```bash
SK=sk_test_xxx
PROD=$(curl -s https://api.stripe.com/v1/products -u "$SK:" -d name="BunBite Pro" | jq -r .id)
curl -s https://api.stripe.com/v1/prices -u "$SK:" \
  -d product="$PROD" -d unit_amount=900 -d currency=eur \
  -d "recurring[interval]"=month | jq -r .id     # -> STRIPE_PRICE_MONTHLY
curl -s https://api.stripe.com/v1/prices -u "$SK:" \
  -d product="$PROD" -d unit_amount=9000 -d currency=eur \
  -d "recurring[interval]"=year | jq -r .id      # -> STRIPE_PRICE_YEARLY
```

## 4. Set secrets
```bash
fly secrets set \
  STRIPE_SECRET_KEY=sk_test_xxx \
  STRIPE_PRICE_MONTHLY=price_xxx \
  STRIPE_PRICE_YEARLY=price_xxx
```

## 5. Create the webhook, then set its secret
In the Stripe dashboard (Developers -> Webhooks) add an endpoint:
- URL: `https://<app>.fly.dev/api/stripe/webhook`
- Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

Copy the signing secret (`whsec_...`) and set it:
```bash
fly secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx
```
Setting secrets restarts the app. Then `curl .../api/config` should report `{"billing":true}`.

## 6. Smoke test the purchase
Open `/pricing.html`, click Go Pro, pay with Stripe test card `4242 4242 4242 4242`
(any future expiry / any CVC). You land on `/success.html`, which reveals your key and
activates it in the app. The header pill should switch to Pro.

## Notes
- Custom domain later: `fly certs add bunbite.app` then update `PUBLIC_BASE_URL`.
- Logs: `fly logs`. Restart: `fly apps restart <app>`.
- The volume persists across deploys, so issued keys and usage survive restarts.
