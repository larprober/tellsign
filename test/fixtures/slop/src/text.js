const API_KEY = 'your-api-key-here';

// This is the same slug helper that lives in utils.js, written a second time.
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function renderRow(row) {
  const el = document.getElementById('#row-' + row.id);
  el.addEventListener('onclick', () => console.log(row));
  return el;
}

module.exports = { slugify, renderRow, API_KEY };
