const $ = (selector) => document.querySelector(selector);
let selectedProduct = null;
let descriptions = [];

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
function setMessage(text, error = false) { const target = $("#message"); target.textContent = text; target.classList.toggle("error", error); }
function option(product) { const node = document.createElement("option"); node.value = product.id; node.textContent = product.title; node.dataset.title = product.title; return node; }
function renderCards() {
  const root = $("#cards"); root.replaceChildren();
  descriptions.forEach((description, index) => {
    const card = document.createElement("article"); card.className = "card";
    card.innerHTML = `<div class="card-top"><span>OPTION 0${index + 1}</span><button class="apply">Apply to Shopify</button></div><h2>${escapeHtml(description.headline)}</h2><div class="copy">${description.html}</div>`;
    card.querySelector(".apply").addEventListener("click", () => apply(card, description.html));
    root.append(card);
  });
}
function escapeHtml(value) { const element = document.createElement("div"); element.textContent = value || ""; return element.innerHTML; }
async function apply(buttonCard, descriptionHtml) {
  if (!selectedProduct) return;
  const button = buttonCard.querySelector("button"); button.disabled = true; button.textContent = "Applying…";
  try { const data = await request("/api/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ productId: selectedProduct.id, descriptionHtml }) }); button.textContent = "Applied ✓"; setMessage(`${data.product.title} updated`); }
  catch (error) { button.disabled = false; button.textContent = "Try again"; setMessage(error.message, true); }
}
async function setup() {
  const session = await request("/api/session");
  if (!session.shop) return;
  $("#connect").hidden = true; $("#app").hidden = false;
  $("#store-status").textContent = session.shop;
  try { const { products } = await request("/api/products"); products.forEach((product) => $("#product").append(option(product))); }
  catch (error) { setMessage(error.message, true); }
}
$("#product").addEventListener("change", async (event) => { const { products } = await request("/api/products"); selectedProduct = products.find((item) => item.id === event.target.value); $("#title").value = selectedProduct?.title || ""; });
$("#writer").addEventListener("submit", async (event) => {
  event.preventDefault(); const button = $("#generate"); button.disabled = true; button.innerHTML = "Writing…"; setMessage("Claude is drafting your options");
  try { const data = await request("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ productId: selectedProduct?.id, title: $("#title").value, keywords: $("#keywords").value, tone: $("#tone").value, length: $("#length").value }) }); descriptions = data.descriptions; $("#empty").hidden = true; renderCards(); setMessage("3 fresh descriptions ready"); }
  catch (error) { setMessage(error.message, true); }
  finally { button.disabled = false; button.innerHTML = "Generate 3 options <span>↗</span>"; }
});
setup().catch(() => {});
