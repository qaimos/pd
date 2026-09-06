# AI Product Description Writer

An embedded Shopify app that turns a product title and key phrases into three SEO-conscious descriptions using Claude, then applies the selected version directly to the product.

## Run locally

1. Create a Shopify app in the [Dev Dashboard](https://dev.shopify.com/dashboard) and set its redirect URL to `https://YOUR-TUNNEL/auth/callback`.
2. Copy `.env.example` to `.env` and fill in the Shopify, Anthropic, PostgreSQL, cookie-secret, and public URL values.
3. Install and initialise:

   ```bash
   npm install
   npm run db:init
   npm run dev
   ```

4. Visit `/auth?shop=your-store.myshopify.com` to install it in a development store.

## Deploy on Railway

1. Create a new Railway project from this GitHub repository and add a PostgreSQL service.
2. Add the variables in `.env.example`. Set `DATABASE_URL` to Railway's Postgres connection URL and set `APP_URL` to the Railway public domain.
3. Run `npm run db:init` once from Railway's service shell (or a one-off deployment command).
4. In Shopify Dev Dashboard, update the app URL to `APP_URL`, add `APP_URL/auth/callback` as the allowed redirect URL, and set the embed URL to `APP_URL`.
5. Deploy, then begin installation at `APP_URL/auth?shop=your-store.myshopify.com`.

## Required Shopify scopes

`read_products,write_products`

The app stores each store's offline Admin API token in PostgreSQL. In production, use a strong randomly generated `COOKIE_SECRET`; do not reuse API secrets.
