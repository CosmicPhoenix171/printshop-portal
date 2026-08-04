const form = document.querySelector('#shipping-form');
const results = document.querySelector('#results');
const button = document.querySelector('#calculate');
const message = document.querySelector('#form-message');

function showErrors(errors = {}) {
  document.querySelectorAll('[data-error]').forEach((element) => { element.textContent = errors[element.dataset.error] || ''; });
}

function money(value) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value); }

function renderRates(data) {
  const sorted = [...data.rates].sort((a, b) => a.price - b.price);
  results.innerHTML = `<h2>Available USPS services</h2><p class="result-note">${data.mock ? 'MOCK MODE - these are test values, not USPS prices.' : 'Published USPS retail prices.'}</p><div class="rate-list">${sorted.map((rate, index) => `<article class="rate ${index === 0 ? 'best' : ''}"><div class="rate-name">${rate.service}${index === 0 ? '<span class="best-label">Lowest price</span>' : ''}</div><div class="rate-price">${money(rate.price)}</div><div class="rate-meta">Estimated delivery: ${rate.deliveryTime}</div>${rate.warning ? `<div class="rate-warning">${rate.warning}</div>` : ''}</article>`).join('')}</div>`;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showErrors();
  message.textContent = '';
  button.disabled = true;
  button.textContent = 'Checking USPS rates...';
  try {
    const response = await fetch('/api/shipping-rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    const data = await response.json();
    if (!response.ok) { showErrors(data.errors); throw new Error(data.message || 'Unable to retrieve shipping rates.'); }
    renderRates(data);
  } catch (error) {
    message.textContent = error.message || 'Unable to retrieve shipping rates. Please try again.';
    if (!error.message?.includes('highlighted')) results.innerHTML = '<div class="empty-state">No rates are shown until USPS returns a valid response.</div>';
  } finally { button.disabled = false; button.textContent = 'Calculate shipping'; }
});
