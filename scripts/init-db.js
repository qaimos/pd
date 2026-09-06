import "dotenv/config";
import fs from "node:fs";
import { Client } from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false } });
await client.connect();
await client.query(fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
await client.end();
console.log("Database schema ready.");
