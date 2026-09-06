import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import { Pool } from "pg";

const required = ["APP_URL", "SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "ANTHROPIC_API_KEY", "DATABASE_URL", "COOKIE_SECRET"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) console.warn(`Missing environment variables: ${missing.join(", ")}`);

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false } });
const secure = process.env.APP_URL?.startsWith("https://") || process.env.NODE_ENV === "production";

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(express.static(path.join(__dirname, "public")));

function validShop(shop) { return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop || ""); }
function timingSafe(a, b) { return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
function signedCookie(res, name, value, maxAge) { res.cookie(name, value, { signed: true, httpOnly: true, secure, sameSite: "lax", maxAge }); }
function shopFrom(req) { return req.signedCookies.shop; }

app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

app.get("/auth", (req, res) => {
  const shop = String(req.query.shop || "").toLowerCase();
  if (!validShop(shop)) return res.status(400).send("A valid myshopify.com store domain is required.");
  const state = crypto.randomBytes(24).toString("hex");
  signedCookie(res, "oauth_state", state, 600000);
  const params = new URLSearchParams({ client_id: process.env.SHOPIFY_API_KEY || "", scope: process.env.SHOPIFY_SCOPES || "read_products,write_products", redirect_uri: `${process.env.APP_URL}/auth/callback`, state });
  res.redirect(`https://${shop}/admin/oauth/authorize?${params}`);
});

app.get("/auth/callback", async (req, res, next) => {
  try {
    const query = Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, String(v)]));
    const { hmac, state, shop } = query;
    const signed = { ...query };
    delete signed.hmac;
    delete signed.signature;
    const message = Object.keys(signed).sort().map((key) => `${key}=${signed[key]}`).join("&");
    const expected = crypto.createHmac("sha256", process.env.SHOPIFY_API_SECRET || "").update(message).digest("hex");
    if (!hmac || !timingSafe(hmac, expected) || state !== req.signedCookies.oauth_state || !validShop(shop)) return res.status(401).send("Invalid Shopify authorization response.");
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_id: process.env.SHOPIFY_API_KEY, client_secret: process.env.SHOPIFY_API_SECRET, code: query.code }) });
    if (!tokenResponse.ok) throw new Error(`Token exchange failed: ${await tokenResponse.text()}`);
    const { access_token } = await tokenResponse.json();
    await pool.query("INSERT INTO shops (shop_domain, access_token) VALUES ($1, $2) ON CONFLICT (shop_domain) DO UPDATE SET access_token = EXCLUDED.access_token, updated_at = NOW()", [shop, access_token]);
    signedCookie(res, "shop", shop, 2592000000);
    res.clearCookie("oauth_state");
    res.redirect("/");
  } catch (error) { next(error); }
});

async function adminGraphql(shop, query, variables = {}) {
  const { rows } = await pool.query("SELECT access_token FROM shops WHERE shop_domain = $1", [shop]);
  if (!rows[0]) { const error = new Error("Install the app for this store first."); error.status = 401; throw error; }
  const response = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, { method: "POST", headers: { "content-type": "application/json", "X-Shopify-Access-Token": rows[0].access_token }, body: JSON.stringify({ query, variables }) });
  const payload = await response.json();
  if (!response.ok || payload.errors) throw new Error(payload.errors?.map((e) => e.message).join(", ") || "Shopify request failed");
  return payload.data;
}
function requireShop(req, res, next) { if (!shopFrom(req)) return res.status(401).json({ error: "Connect a Shopify store first." }); next(); }

app.get("/api/session", (req, res) => res.json({ shop: shopFrom(req) || null }));
app.get("/api/products", requireShop, async (req, res, next) => {
  try {
    const data = await adminGraphql(shopFrom(req), `query { products(first: 50, sortKey: UPDATED_AT, reverse: true) { nodes { id title descriptionHtml featuredImage { url altText } } } }`);
    res.json({ products: data.products.nodes });
  } catch (error) { next(error); }
});

app.post("/api/generate", requireShop, async (req, res, next) => {
  try {
    const { title, keywords, tone = "persuasive", length = "medium", productId = null } = req.body;
    if (!title?.trim() || !keywords?.trim()) return res.status(400).json({ error: "Product title and keywords are required." });
    const prompt = `Create exactly three unique, SEO-conscious Shopify product descriptions for this product.\nTitle: ${title.trim()}\nKeywords to integrate naturally: ${keywords.trim()}\nTone: ${tone}\nLength: ${length}\nReturn only JSON: {"descriptions":[{"headline":"short headline","html":"valid concise HTML using p, h3, ul, li, strong only"}]}. Never mention SEO, keywords, or that you are AI.`;
    const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929", max_tokens: 1800, temperature: 0.8, messages: [{ role: "user", content: prompt }] }) });
    if (!response.ok) throw new Error(`Claude request failed: ${await response.text()}`);
    const output = await response.json();
    const raw = output.content?.find((block) => block.type === "text")?.text || "";
    const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ""));
    if (!Array.isArray(parsed.descriptions) || parsed.descriptions.length !== 3) throw new Error("Claude returned an invalid response. Please try again.");
    await pool.query("INSERT INTO generations (shop_domain, product_id, title, keywords, tone, length, results) VALUES ($1, $2, $3, $4, $5, $6, $7)", [shopFrom(req), productId, title.trim(), keywords.trim(), tone, length, JSON.stringify(parsed.descriptions)]);
    res.json(parsed);
  } catch (error) { next(error); }
});

app.post("/api/apply", requireShop, async (req, res, next) => {
  try {
    const { productId, descriptionHtml } = req.body;
    if (!productId || !descriptionHtml) return res.status(400).json({ error: "Product and description are required." });
    const data = await adminGraphql(shopFrom(req), `mutation UpdateProduct($input: ProductInput!) { productUpdate(input: $input) { product { id title } userErrors { field message } } }`, { input: { id: productId, descriptionHtml } });
    const errors = data.productUpdate.userErrors;
    if (errors.length) return res.status(422).json({ error: errors.map((e) => e.message).join(", ") });
    res.json({ product: data.productUpdate.product });
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => { console.error(error); res.status(error.status || 500).json({ error: error.message || "Something went wrong." }); });
app.listen(port, () => console.log(`AI Product Description Writer listening on ${port}`));
