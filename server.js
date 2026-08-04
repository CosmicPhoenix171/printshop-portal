import 'dotenv/config';
import express from 'express';

const app = express();
const port = Number(process.env.PORT || 3000);
const apiBaseUrl = (process.env.USPS_API_BASE_URL || 'https://apis.usps.com').replace(/\/$/, '');
const requestTimeoutMs = 15000;
let tokenCache = null;

app.use(express.json({ limit: '20kb' }));
app.use('/shipping-calculator', express.static('public/shipping-calculator'));

function validateRequest(body) {
  const errors = {};
  const zip = value => /^\d{5}$/.test(String(value || ''));
  if (!zip(body.originZip)) errors.originZip = 'Enter a valid five-digit ZIP code.';
  if (!zip(body.destinationZip)) errors.destinationZip = 'Enter a valid five-digit ZIP code.';
  const pounds = Number(body.pounds);
  const ounces = Number(body.ounces);
  for (const [name, value] of [['pounds', pounds], ['ounces', ounces]]) {
    if (!Number.isFinite(value) || value < 0) errors[name] = 'Enter zero or more.';
  }
  if (!errors.ounces && ounces >= 16) errors.ounces = 'Enter ounces from 0 to less than 16.';
  if (!errors.pounds && !errors.ounces && pounds === 0 && ounces === 0) errors.pounds = 'Package weight must be greater than zero.';
  for (const dimension of ['length', 'width', 'height']) {
    const value = Number(body[dimension]);
    if (!Number.isFinite(value) || value <= 0) errors[dimension] = 'Enter a positive measurement.';
  }
  return errors;
}

function mockRates(body) {
  const pounds = Number(body.pounds) + Number(body.ounces) / 16;
  return [
    { service: 'USPS Ground Advantage', price: 8.99 + pounds * 0.35, deliveryTime: '2-5 business days', warning: 'MOCK RESULT - not a USPS price.' },
    { service: 'Priority Mail', price: 12.95 + pounds * 0.55, deliveryTime: '1-3 business days', warning: 'MOCK RESULT - not a USPS price.' },
    { service: 'Priority Mail Express', price: 29.95 + pounds * 1.1, deliveryTime: '1-2 business days', warning: 'MOCK RESULT - not a USPS price.' },
  ];
}

// Cache the OAuth token until shortly before USPS says it expires.
async function getAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30000) return tokenCache.value;
  if (!process.env.USPS_CONSUMER_KEY || !process.env.USPS_CONSUMER_SECRET) {
    const error = new Error('USPS credentials are not configured.');
    error.code = 'USPS_AUTH_CONFIG';
    throw error;
  }
  const response = await fetch(`${apiBaseUrl}/oauth2/v3/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: process.env.USPS_CONSUMER_KEY, client_secret: process.env.USPS_CONSUMER_SECRET }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error('USPS OAuth failed:', response.status, detail.slice(0, 500));
    const error = new Error('USPS authentication failed. Check the USPS Developer Portal credentials.');
    error.code = 'USPS_AUTH';
    throw error;
  }
  const data = await response.json();
  if (!data.access_token) throw new Error('USPS authentication returned no access token.');
  tokenCache = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 };
  return tokenCache.value;
}

// Normalize the documented USPS Shipping Options response without inventing rates.
function normalizeRates(payload) {
  const candidates = payload?.rates || payload?.rateOptions || payload?.services || payload?.pricing || [];
  if (!Array.isArray(candidates)) throw new Error('USPS returned an unexpected rate response.');
  return candidates.map(rate => ({
    service: rate.serviceName || rate.mailClass || rate.description || rate.name,
    price: Number(rate.price ?? rate.totalBasePrice ?? rate.totalPrice),
    deliveryTime: rate.deliveryTime || rate.commitment?.description || rate.expectedDeliveryDate || 'USPS delivery estimate unavailable',
    warning: rate.warning || rate.warningMessage || rate.messages?.join?.(' '),
  })).filter(rate => rate.service && Number.isFinite(rate.price));
}

async function fetchUspsRates(body) {
  const token = await getAccessToken();
  const payload = { originZIPCode: body.originZip, destinationZIPCode: body.destinationZip, weight: Number(body.pounds) + Number(body.ounces) / 16, length: Number(body.length), width: Number(body.width), height: Number(body.height), priceType: 'RETAIL' };
  const response = await fetch(`${apiBaseUrl}/shipments/v3/options/search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    console.error('USPS rate request failed:', response.status, text.slice(0, 1000));
    const error = new Error(response.status === 429 ? 'USPS is rate-limiting requests. Please try again shortly.' : 'USPS rejected the package or ZIP code details.');
    error.code = response.status === 429 ? 'USPS_RATE_LIMIT' : 'USPS_REQUEST';
    throw error;
  }
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('USPS returned malformed rate data.'); }
  const allowed = normalizeRates(data).filter(rate => /ground advantage|priority mail(?! express)|priority mail express/i.test(rate.service));
  if (allowed.length === 0) throw new Error('USPS did not return an eligible service for this package.');
  return allowed.sort((a, b) => a.price - b.price);
}

app.post('/api/shipping-rates', async (request, response) => {
  const errors = validateRequest(request.body || {});
  if (Object.keys(errors).length) return response.status(400).json({ message: 'Check the highlighted package details.', errors });
  if (process.env.USPS_MOCK_MODE === 'true') return response.json({ mock: true, rates: mockRates(request.body) });
  try { return response.json({ mock: false, rates: await fetchUspsRates(request.body) }); }
  catch (error) { console.error('Shipping rate error:', error); return response.status(error.code?.startsWith('USPS_') ? 502 : 500).json({ message: error.message || 'Unable to retrieve USPS shipping rates.' }); }
});

app.get('/health', (_request, response) => response.json({ ok: true }));
app.listen(port, () => console.log(`Shipping calculator: http://localhost:${port}/shipping-calculator/`));