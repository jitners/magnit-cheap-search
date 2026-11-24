'use strict';

/* ------------------------------------------------------------------ config */

const STORE_TYPE_LABELS = {
  MM: 'Магнит у дома',
  MM_MINI: 'Магнит Мини',
  GM: 'Магнит Семейный',
  MC: 'Магнит',
  ME: 'Магнит Экстра',
  V1: 'В1',
  MO: 'Магнит Опт',
  DG: 'Магнит Косметик',
  MA: 'Магнит Аптека',
  DARKSTORE: 'Даркстор',
  MARKET: 'Магнит Маркет',
  RTE: 'Партнёр',
};

const POPULAR_CITIES = [
  'Москва', 'Санкт-Петербург', 'Новосибирск', 'Екатеринбург', 'Казань',
  'Нижний Новгород', 'Челябинск', 'Самара', 'Омск', 'Ростов-на-Дону',
  'Уфа', 'Красноярск', 'Воронеж', 'Пермь', 'Волгоград', 'Краснодар',
];

const SUGGESTIONS = ['молоко', 'хлеб', 'яйца', 'сыр', 'курица', 'кофе', 'сахар', 'масло', 'бананы', 'пельмени'];

const PAGE_LIMIT = 24;

const LS_CITY = 'magnit.city.v1';
const LS_STORE = 'magnit.store.v1';
const LS_FAV = 'magnit.favorites.v1';

/* ------------------------------------------------------------------- utils */

const $ = (sel) => document.querySelector(sel);

const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('ru-RU');

function money(value) {
  if (value === null || value === undefined) return '—';
  return nf2.format(value) + ' ₽';
}

function plural(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

function esc(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function storeTypeLabel(type) {
  return STORE_TYPE_LABELS[type] || type || 'Магазин';
}

function storeLabel(store) {
  return store ? shortAddress(store.address) : '';
}

function unitName(label) {
  if (!label) return 'ед.';
  return String(label).replace(/^1\s*(?=[^\d])/, '');
}

function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
}

function load(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

let toastTimer = null;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

async function api(path, params = {}, signal) {
  const url = new URL(path, location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  let data = null;
  try { data = await response.json(); } catch (e) { /* ignore */ }
  if (!response.ok) {
    const message = (data && (data.error || data.message)) || `Ошибка ${response.status}`;
    throw new Error(message);
  }
  return data;
}

const API = {
  cities: (q, limit) => api('/api/cities', { q, limit }),
  stores: (city) => api('/api/stores', { city }),
  categories: (store) => api('/api/categories', { store }),
  products: (params, signal) => api('/api/products', params, signal),
};

/* ------------------------------------------------------------------- state */

const state = {
  city: null,
  store: null,
  stores: [],
  categories: [],
  categoryId: '',
  query: '',
  sort: 'price_asc',
  mode: 'store',
  items: [],
  total: 0,
  page: 1,
  hasMore: false,
  loading: false,
};

const cityInput = $('#cityInput');
const cityList = $('#cityList');
const storeInput = $('#storeInput');
const storeList = $('#storeList');
const storeCount = $('#storeCount');
const storeField = storeInput.closest('.field');
const mapBox = $('#mapBox');
const mapToggle = $('#mapToggle');
const mapHint = $('#mapHint');
const mapCityBtn = $('#mapCityBtn');
const mapStoreBtn = $('#mapStoreBtn');
const mapClose = $('#mapClose');
const mapEl = $('#storeMap');
const queryInput = $('#queryInput');
const categoryTrigger = $('#categoryTrigger');
const categoryLabel = $('#categoryLabel');
const categoryCount = $('#categoryCount');
const categoryClear = $('#categoryClear');
const categoryControl = $('#categoryControl');
const categoryField = categoryTrigger.closest('.field');
const catDrawer = $('#catDrawer');
const catBackdrop = $('#catBackdrop');
const catDrawerClose = $('#catDrawerClose');
const catDrawerCount = $('#catDrawerCount');
const catSearch = $('#catSearch');
const catSearchClear = $('#catSearchClear');
const catCrumbs = $('#catCrumbs');
const catList = $('#catList');
const sortSelect = $('#sortSelect');
const searchBtn = $('#searchBtn');
const moreBtn = $('#moreBtn');
const moreWrap = $('#moreWrap');
const statusBar = $('#statusBar');
const results = $('#results');
const compareControls = $('#compareControls');
const compareBtn = $('#compareBtn');
const compareCancel = $('#compareCancel');
const compareCountSelect = $('#compareCount');
const compareResults = $('#compareResults');
const favToggle = $('#favToggle');
const favCount = $('#favCount');
const favLayer = $('#favLayer');
const favBackdrop = $('#favBackdrop');
const favClose = $('#favClose');
const favList = $('#favList');
const favHint = $('#favHint');
const favClear = $('#favClear');
const favRetry = $('#favRetry');

/* ------------------------------------------------------- combobox: helpers */

function markActive(listEl, index) {
  const nodes = listEl.querySelectorAll('.combo-item');
  nodes.forEach((node, i) => node.classList.toggle('is-active', i === index));
  if (nodes[index]) nodes[index].scrollIntoView({ block: 'nearest' });
}

function closeLists() {
  cityList.hidden = true;
  storeList.hidden = true;
  cityInput.setAttribute('aria-expanded', 'false');
  storeInput.setAttribute('aria-expanded', 'false');
}

/* ---------------------------------------------------------- combobox: city */

let cityItems = [];
let cityActive = -1;
let cityRequestId = 0;

function renderCityItems(items, title) {
  cityItems = items;
  cityActive = -1;
  if (!items.length) {
    cityList.innerHTML = '<div class="combo-empty">Города не найдены</div>';
    cityList.hidden = false;
    cityInput.setAttribute('aria-expanded', 'true');
    return;
  }
  const head = title ? `<div class="combo-title">${esc(title)}</div>` : '';
  const rows = items.map((item, i) => {
    if (item.name) {
      return `<div class="combo-item" role="option" data-index="${i}">
        <span class="main">${esc(item.name)}</span>
      </div>`;
    }
    const sub = [item.region, item.area && item.area !== item.city ? item.area : ''].filter(Boolean).join(' · ');
    return `<div class="combo-item" role="option" data-index="${i}">
      <span class="main">${esc(item.city)}</span>
      <span class="sub">${esc(sub || 'Россия')}</span>
    </div>`;
  }).join('');
  cityList.innerHTML = head + rows;
  cityList.hidden = false;
  cityInput.setAttribute('aria-expanded', 'true');
}

function renderPopularCities() {
  renderCityItems(POPULAR_CITIES.map((name) => ({ name })), 'Популярные города');
}

async function searchCities(query) {
  const requestId = ++cityRequestId;
  cityList.innerHTML = '<div class="combo-empty">Ищем города…</div>';
  cityList.hidden = false;
  try {
    const data = await API.cities(query, 20);
    if (requestId !== cityRequestId) return;
    renderCityItems(data.items || []);
  } catch (err) {
    if (requestId !== cityRequestId) return;
    cityList.innerHTML = `<div class="combo-empty">${esc(err.message)}</div>`;
    cityList.hidden = false;
  }
}

const debouncedCitySearch = debounce((query) => searchCities(query), 280);

cityInput.addEventListener('input', () => {
  const query = cityInput.value.trim();
  if (!query) {
    renderPopularCities();
    return;
  }
  if (query.length < 2) return;
  debouncedCitySearch(query);
});

cityInput.addEventListener('focus', () => {
  if (!cityInput.value.trim()) renderPopularCities();
  else if (cityItems.length) {
    cityList.hidden = false;
    cityInput.setAttribute('aria-expanded', 'true');
  }
});

cityInput.addEventListener('keydown', (event) => {
  if (cityList.hidden) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const count = cityList.querySelectorAll('.combo-item').length;
    if (!count) return;
    cityActive = event.key === 'ArrowDown'
      ? (cityActive + 1) % count
      : (cityActive - 1 + count) % count;
    markActive(cityList, cityActive);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const index = cityActive >= 0 ? cityActive : 0;
    const node = cityList.querySelectorAll('.combo-item')[index];
    if (node) node.click();
  } else if (event.key === 'Escape') {
    cityList.hidden = true;
  }
});

cityList.addEventListener('mousedown', (event) => event.preventDefault());
cityList.addEventListener('click', async (event) => {
  const node = event.target.closest('.combo-item');
  if (!node) return;
  const item = cityItems[Number(node.dataset.index)];
  if (!item) return;
  if (item.name) {
    await pickCityByName(item.name);
  } else {
    await selectCity(item);
  }
});

async function pickCityByName(name) {
  try {
    const data = await API.cities(name, 20);
    const normalized = name.trim().toLowerCase();
    const match = (data.items || []).find((c) => c.city.toLowerCase() === normalized) || (data.items || [])[0];
    if (!match) {
      toast('Город не найден');
      return;
    }
    await selectCity(match);
  } catch (err) {
    toast(err.message);
  }
}

async function selectCity(city) {
  state.city = { id: city.id, city: city.city, region: city.region || '' };
  cityInput.value = city.city;
  save(LS_CITY, state.city);
  closeLists();
  if (state.mode === 'compare') {
    if (compareState.controller) compareState.controller.abort();
    renderCompareIntro();
  }
  await loadStores();
}

/* --------------------------------------------------------- combobox: store */

let storeItems = [];
let storeActive = -1;

function openStoreList(filterText) {
  const filter = (filterText || '').trim().toLowerCase();
  storeItems = state.stores.filter((store) => {
    if (!filter) return true;
    return store.address.toLowerCase().includes(filter);
  });
  storeActive = -1;

  if (!state.store) {
    storeList.innerHTML = '<div class="combo-empty">Сначала выберите город</div>';
    storeList.hidden = false;
    return;
  }

  if (!storeItems.length) {
    storeList.innerHTML = '<div class="combo-empty">Магазины не найдены</div>';
    storeList.hidden = false;
    return;
  }

  const shown = storeItems.slice(0, 300);
  const rows = shown.map((store, i) => {
    const current = state.store && store.code === state.store.code;
    return `<div class="combo-item${current ? ' is-active' : ''}" role="option" data-index="${i}">
      <span class="main">${esc(store.address)}</span>
      <span class="sub">${esc(storeTypeLabel(store.type))} · код ${esc(store.code)}</span>
    </div>`;
  }).join('');
  const tail = storeItems.length > shown.length
    ? `<div class="combo-empty">Показаны первые ${shown.length} из ${storeItems.length}. Уточните адрес.</div>`
    : '';
  storeList.innerHTML = rows + tail;
  storeList.hidden = false;
  storeInput.setAttribute('aria-expanded', 'true');
}

storeInput.addEventListener('focus', () => {
  if (storeInput.disabled) return;
  const selectedLabel = storeLabel(state.store);
  openStoreList(storeInput.value === selectedLabel ? '' : storeInput.value);
});

storeInput.addEventListener('input', () => {
  if (storeInput.disabled) return;
  openStoreList(storeInput.value);
});

storeInput.addEventListener('keydown', (event) => {
  if (storeList.hidden) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const count = storeList.querySelectorAll('.combo-item').length;
    if (!count) return;
    storeActive = event.key === 'ArrowDown'
      ? (storeActive + 1) % count
      : (storeActive - 1 + count) % count;
    markActive(storeList, storeActive);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const index = storeActive >= 0 ? storeActive : 0;
    const node = storeList.querySelectorAll('.combo-item')[index];
    if (node) node.click();
  } else if (event.key === 'Escape') {
    storeList.hidden = true;
  }
});

storeList.addEventListener('mousedown', (event) => event.preventDefault());
storeList.addEventListener('click', (event) => {
  const node = event.target.closest('.combo-item');
  if (!node) return;
  const store = storeItems[Number(node.dataset.index)];
  if (store) selectStore(store);
});

/* --------------------------------------------------------------------- map */

const mapState = { map: null, layer: null, markers: new Map() };

function mapAvailable() {
  return typeof window.L !== 'undefined' && typeof window.L.map === 'function';
}

function storeLatLng(store) {
  const lat = Number(store && store.lat);
  const lng = Number(store && store.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !lat || !lng) return null;
  return [lat, lng];
}

function setMapHint(text) {
  mapHint.textContent = text;
}

function ensureMap() {
  if (!mapAvailable()) return null;
  if (mapState.map) return mapState.map;

  const map = L.map(mapEl, { zoomControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
  }).addTo(map);
  map.setView([55.751244, 37.618423], 10);
  mapState.layer = L.layerGroup().addTo(map);
  mapState.map = map;
  return map;
}

function clearMapStores() {
  if (!mapState.map) return;
  mapState.markers.clear();
  mapState.layer.clearLayers();
}

function mapTooltip(store) {
  const type = store.type ? ' · ' + storeTypeLabel(store.type) : '';
  return `<b>${esc(shortAddress(store.address))}</b>${esc(type)}`;
}

function highlightMapStore() {
  if (!mapState.map) return;
  mapState.markers.forEach((marker, code) => {
    const selected = state.store && String(state.store.code) === code;
    marker.setStyle(selected
      ? { radius: 8, color: '#ffffff', weight: 3, fillColor: '#e30613', fillOpacity: 1 }
      : { radius: 5, color: '#ffffff', weight: 1.5, fillColor: '#6b6f76', fillOpacity: .9 });
    if (selected && marker.bringToFront) marker.bringToFront();
  });
}

function fitMapToCity() {
  if (!mapState.map) return;
  const points = [];
  mapState.markers.forEach((marker) => points.push(marker.getLatLng()));
  if (!points.length) {
    mapState.map.setView([55.751244, 37.618423], 10);
    return;
  }
  mapState.map.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 14 });
}

function focusMapStore(zoom = 15) {
  if (!mapState.map || !state.store) return false;
  const ll = storeLatLng(state.store);
  if (!ll) return false;
  mapState.map.setView(ll, zoom, { animate: true });
  return true;
}

function syncMapStores() {
  if (!mapState.map) return;
  clearMapStores();

  let count = 0;
  for (const store of state.stores) {
    const ll = storeLatLng(store);
    if (!ll) continue;

    const marker = L.circleMarker(ll, {
      radius: 5,
      color: '#ffffff',
      weight: 1.5,
      fillColor: '#6b6f76',
      fillOpacity: .9,
    });
    marker.bindTooltip(mapTooltip(store), {
      className: 'store-tip',
      direction: 'top',
      offset: [0, -7],
      sticky: true,
    });
    marker.on('mouseover', () => {
      if (!state.store || state.store.code !== store.code) {
        marker.setStyle({ radius: 7, fillColor: '#e30613' });
      }
    });
    marker.on('mouseout', () => {
      if (!state.store || state.store.code !== store.code) {
        marker.setStyle({ radius: 5, fillColor: '#6b6f76' });
      }
    });
    marker.on('click', () => {
      if (!state.store || state.store.code !== store.code) selectStore(store);
    });
    marker.addTo(mapState.layer);
    mapState.markers.set(String(store.code), marker);
    count += 1;
  }

  setMapHint(count
    ? 'Нажмите на точку, чтобы выбрать магазин'
    : 'У магазинов этого города нет координат');
  highlightMapStore();
  fitMapToCity();
}

function openMap() {
  if (!mapAvailable()) {
    toast('Не удалось загрузить карту');
    return;
  }

  mapBox.hidden = false;
  mapToggle.textContent = 'Скрыть карту';
  mapToggle.setAttribute('aria-expanded', 'true');

  const map = ensureMap();
  if (!map) return;
  syncMapStores();
  map.invalidateSize();
  if (!focusMapStore(15)) fitMapToCity();
}

function closeMap() {
  if (mapBox.hidden) return;
  mapBox.hidden = true;
  mapToggle.textContent = 'На карте';
  mapToggle.setAttribute('aria-expanded', 'false');
}

mapToggle.addEventListener('click', () => {
  if (mapBox.hidden) openMap();
  else closeMap();
});
mapClose.addEventListener('click', closeMap);
mapCityBtn.addEventListener('click', fitMapToCity);
mapStoreBtn.addEventListener('click', () => {
  if (!focusMapStore(16)) fitMapToCity();
});

if (!mapAvailable()) mapToggle.hidden = true;

async function loadStores() {
  if (!state.city) return;

  state.stores = [];
  state.store = null;
  state.items = [];
  state.total = 0;
  state.hasMore = false;

  clearMapStores();
  if (mapState.map) setMapHint('Загружаем магазины города…');

  storeInput.disabled = true;
  storeInput.value = '';
  storeInput.placeholder = 'Загружаем магазины города…';
  storeCount.textContent = '';
  closeLists();
  renderStart('Загружаем список магазинов…');

  try {
    const data = await API.stores(state.city.id);
    state.stores = data.items || [];
    syncMapStores();
    storeInput.disabled = false;
    storeInput.placeholder = 'Выберите магазин или начните вводить адрес';
    storeCount.textContent = state.stores.length ? `· ${nf0.format(state.stores.length)}` : '';

    if (!state.stores.length) {
      renderEmpty('<h3>Магазины не найдены</h3><p>В этом городе не удалось найти магазины Магнит. Попробуйте другой город.</p>');
      return;
    }

    const saved = load(LS_STORE);
    let pick = null;
    if (saved && saved.cityId === state.city.id) {
      pick = state.stores.find((store) => store.code === saved.code) || null;
    }
    if (!pick) pick = state.stores.find((store) => store.code === '992301') || state.stores[0];

    await selectStore(pick);
  } catch (err) {
    storeInput.placeholder = 'Не удалось загрузить магазины';
    toast(err.message);
    renderEmpty(`<h3>Ошибка загрузки</h3><p>${esc(err.message)}</p>`);
  }
}

async function selectStore(store) {
  state.store = store;
  save(LS_STORE, { ...store, cityId: state.city ? state.city.id : '' });
  storeInput.value = storeLabel(store);
  storeInput.title = store.address;
  closeLists();
  highlightMapStore();
  if (!mapBox.hidden) focusMapStore(15);
  await loadCategories();
  if (state.mode === 'store' && (state.query || state.categoryId)) {
    await runSearch();
  } else if (state.mode === 'compare') {
    renderCompareIntro();
  } else {
    renderStart();
  }
}

/* ------------------------------------------------------- category drawer */

let categoryIndex = [];
let categoryMap = new Map();
let categoryTree = [];
let categoryPath = [];

function categoryEntry(id) {
  if (!id) return null;
  return categoryMap.get(String(id)) || null;
}

function setCategoryTrigger(entry) {
  categoryLabel.textContent = entry ? entry.name : 'Все категории';
  categoryTrigger.title = entry ? entry.pathLabel : 'Выбрать категорию';
  categoryTrigger.classList.toggle('has-value', !!entry);
  categoryClear.hidden = !entry;
  categoryControl.classList.toggle('has-value', !!entry);
}

function resetCategoryDisplay() {
  state.categoryId = '';
  setCategoryTrigger(null);
  categoryPath = [];
}

async function loadCategories() {
  if (!state.store) return;
  const store = state.store;
  categoryTrigger.disabled = true;
  if (!state.categoryId) categoryLabel.textContent = 'Загружаем категории…';
  categoryCount.textContent = '';

  try {
    const data = await API.categories(store.code);
    if (state.store !== store) return;
    state.categories = data.items || [];
    renderCategories();
  } catch (err) {
    if (state.store !== store) return;
    state.categories = [];
    renderCategories();
  } finally {
    if (state.store === store) categoryTrigger.disabled = false;
  }
}

function renderCategories() {
  categoryIndex = [];
  categoryMap = new Map();
  categoryTree = [];

  const addNode = (node, parents, parentIds, hue) => {
    const name = String(node.name || '').trim();
    if (!name) return null;

    const item = {
      id: String(node.id),
      name,
      parents,
      parentIds,
      pathLabel: parents.join(' › '),
      hue,
      children: [],
    };
    categoryIndex.push(item);
    categoryMap.set(item.id, item);

    for (const child of (node.children || [])) {
      if (!child || !child.name) continue;
      const built = addNode(child, parents.concat(name), parentIds.concat(item.id), hue);
      if (built) item.children.push(built);
    }
    item.childCount = item.children.length;
    return item;
  };

  state.categories.forEach((top, index) => {
    if (!top || !top.name) return;
    const built = addNode(top, [], [], (index * 47) % 360);
    if (built) categoryTree.push(built);
  });

  categoryCount.textContent = categoryIndex.length ? `· ${nf0.format(categoryIndex.length)}` : '';
  catDrawerCount.textContent = categoryIndex.length
    ? `${nf0.format(categoryIndex.length)} ${plural(categoryIndex.length, 'категория', 'категории', 'категорий')}`
    : '';

  const current = categoryEntry(state.categoryId);
  if (!current) state.categoryId = '';
  setCategoryTrigger(current);
  if (!catDrawer.hidden) renderCategoryDrawer();
}

function normalizeCategoryText(text) {
  return String(text).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function renderCategoryCrumbs(pathNodes, searching) {
  if (searching) {
    catCrumbs.innerHTML = '<span class="cat-crumb is-current">Результаты поиска</span>';
    return;
  }

  const parts = [];
  if (!pathNodes.length) {
    parts.push('<span class="cat-crumb is-current">Все разделы</span>');
  } else {
    parts.push('<button type="button" class="cat-crumb" data-depth="0">Все разделы</button>');
    pathNodes.forEach((node, index) => {
      parts.push('<span class="cat-crumb-sep">›</span>');
      parts.push(index === pathNodes.length - 1
        ? `<span class="cat-crumb is-current">${esc(node.name)}</span>`
        : `<button type="button" class="cat-crumb" data-depth="${index + 1}">${esc(node.name)}</button>`);
    });
  }
  catCrumbs.innerHTML = parts.join('');
}

function renderCategorySearch(query) {
  const matches = categoryIndex.filter((cat) =>
    normalizeCategoryText(cat.name).includes(query) ||
    normalizeCategoryText(cat.pathLabel).includes(query));

  if (!matches.length) {
    catList.innerHTML = '<div class="cat-empty">Ничего не найдено. Попробуйте другое слово.</div>';
    return;
  }

  const shown = matches.slice(0, 100);
  const rows = shown.map((cat) => `
    <button type="button" class="cat-row${state.categoryId === cat.id ? ' is-current' : ''}" data-pick="${esc(cat.id)}">
      <span class="cat-dot" style="background:hsl(${cat.hue} 64% 52%)"></span>
      <span class="cat-row-main">
        <span class="cat-row-name">${esc(cat.name)}</span>
        <span class="cat-row-sub">${esc(cat.pathLabel || 'раздел')}</span>
      </span>
    </button>`);

  const note = `<div class="cat-note">Найдено: ${nf0.format(matches.length)}</div>`;
  const tail = matches.length > shown.length
    ? `<div class="cat-note">Показаны первые ${shown.length}. Уточните запрос.</div>`
    : '';
  catList.innerHTML = note + rows.join('') + tail;
  catList.scrollTop = 0;
}

function renderCategoryDrawer() {
  categoryPath = categoryPath.filter((id) => categoryMap.has(id));

  if (!categoryMap.size) {
    catCrumbs.innerHTML = '';
    catList.innerHTML = '<div class="cat-empty">Категории ещё загружаются…</div>';
    return;
  }

  const query = normalizeCategoryText(catSearch.value);
  catSearchClear.hidden = !query;

  const pathNodes = categoryPath.map((id) => categoryMap.get(id)).filter(Boolean);
  renderCategoryCrumbs(pathNodes, !!query);

  if (query) {
    renderCategorySearch(query);
    return;
  }

  const items = pathNodes.length ? pathNodes[pathNodes.length - 1].children : categoryTree;
  const rows = [];

  if (!pathNodes.length) {
    rows.push(`
      <button type="button" class="cat-row is-reset${state.categoryId ? '' : ' is-current'}" data-reset>
        <span class="cat-row-main">
          <span class="cat-row-name">Все категории</span>
          <span class="cat-row-sub">весь ассортимент магазина</span>
        </span>
      </button>`);
  } else {
    const section = pathNodes[pathNodes.length - 1];
    rows.push(`
      <button type="button" class="cat-row is-section${state.categoryId === section.id ? ' is-current' : ''}" data-pick="${esc(section.id)}">
        <span class="cat-dot" style="background:hsl(${section.hue} 64% 52%)"></span>
        <span class="cat-row-main">
          <span class="cat-row-name">Весь раздел «${esc(section.name)}»</span>
          <span class="cat-row-sub">${section.childCount} ${plural(section.childCount, 'подраздел', 'подраздела', 'подразделов')}</span>
        </span>
      </button>`);
  }

  for (const item of items) {
    const hasChildren = item.children.length > 0;
    const sub = hasChildren
      ? `${item.children.length} ${plural(item.children.length, 'подраздел', 'подраздела', 'подразделов')}`
      : 'категория';
    rows.push(`
      <button type="button" class="cat-row${state.categoryId === item.id ? ' is-current' : ''}" ${hasChildren ? `data-drill="${esc(item.id)}"` : `data-pick="${esc(item.id)}"`}>
        <span class="cat-dot" style="background:hsl(${item.hue} 64% 52%)"></span>
        <span class="cat-row-main">
          <span class="cat-row-name">${esc(item.name)}</span>
          <span class="cat-row-sub">${esc(sub)}</span>
        </span>
        ${hasChildren ? '<span class="cat-row-chevron" aria-hidden="true">›</span>' : ''}
      </button>`);
  }

  catList.innerHTML = rows.join('');
  catList.scrollTop = 0;
}

function openCategoryDrawer() {
  if (categoryTrigger.disabled) return;

  const current = categoryEntry(state.categoryId);
  categoryPath = current ? current.parentIds.slice() : [];
  catSearch.value = '';
  catSearchClear.hidden = true;

  renderCategoryDrawer();
  catDrawer.hidden = false;
  categoryTrigger.setAttribute('aria-expanded', 'true');
  document.body.classList.add('cat-open');
  requestAnimationFrame(() => catSearch.focus());
}

function closeCategoryDrawer() {
  if (catDrawer.hidden) return;
  catDrawer.hidden = true;
  categoryTrigger.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('cat-open');
  categoryTrigger.focus();
}

function selectCategory(id) {
  const entry = categoryEntry(id);
  state.categoryId = entry ? entry.id : '';
  setCategoryTrigger(entry);
  closeCategoryDrawer();
  runSearch();
}

categoryTrigger.addEventListener('click', openCategoryDrawer);
categoryClear.addEventListener('click', () => {
  if (!state.categoryId) return;
  resetCategoryDisplay();
  runSearch();
});
catDrawerClose.addEventListener('click', closeCategoryDrawer);
catBackdrop.addEventListener('click', closeCategoryDrawer);

catSearch.addEventListener('input', renderCategoryDrawer);
catSearch.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.stopPropagation();
  if (catSearch.value) {
    catSearch.value = '';
    renderCategoryDrawer();
  } else {
    closeCategoryDrawer();
  }
});

catSearchClear.addEventListener('click', () => {
  catSearch.value = '';
  renderCategoryDrawer();
  catSearch.focus();
});

catCrumbs.addEventListener('click', (event) => {
  const button = event.target.closest('[data-depth]');
  if (!button) return;
  categoryPath = categoryPath.slice(0, Number(button.dataset.depth));
  renderCategoryDrawer();
});

catList.addEventListener('click', (event) => {
  if (event.target.closest('[data-reset]')) {
    selectCategory('');
    return;
  }
  const pick = event.target.closest('[data-pick]');
  if (pick) {
    selectCategory(pick.dataset.pick || '');
    return;
  }
  const drill = event.target.closest('[data-drill]');
  if (drill) {
    categoryPath.push(drill.dataset.drill);
    renderCategoryDrawer();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !catDrawer.hidden) closeCategoryDrawer();
});

/* --------------------------------------------------------------- rendering */

function renderSkeletons() {
  statusBar.hidden = true;
  moreWrap.hidden = true;
  results.innerHTML = Array.from({ length: 8 }, () => `
    <div class="skeleton" aria-hidden="true">
      <div class="sk-img"></div>
      <div class="sk-line"></div>
      <div class="sk-line short"></div>
      <div class="sk-line price"></div>
    </div>`).join('');
}

function renderStart(message) {
  statusBar.hidden = true;
  moreWrap.hidden = true;
  if (message) {
    renderEmpty(`<h3>Секунду…</h3><p>${esc(message)}</p>`);
    return;
  }
  renderEmpty(`
    <h3>Найдите дешёвые товары</h3>
    <p>Выберите город и магазин, затем введите название товара или откройте категорию.
       Можно и без запроса — нажмите «Все товары магазина», чтобы увидеть весь ассортимент
       от дешёвых к дорогим.</p>
    <div class="chips">
      <button type="button" class="chip chip-all" data-q="">все товары магазина</button>
      ${SUGGESTIONS.map((s) => `<button type="button" class="chip" data-q="${esc(s)}">${esc(s)}</button>`).join('')}
    </div>`);
}

function renderEmpty(html) {
  results.innerHTML = `<div class="empty">${html}</div>`;
}

function shortAddress(address) {
  if (!address) return '';
  const city = state.city && state.city.city;
  if (city) {
    const safe = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:^|[,\\s])(?:г\\.?\\s*)?${safe}(?:\\s+г\\.?)?(?=[\\s,]|$)`, 'gi');
    let match;
    let last = null;
    while ((match = re.exec(address)) !== null) {
      last = match;
      if (match.index === re.lastIndex) re.lastIndex += 1;
    }
    if (last) {
      const rest = address.slice(last.index + last[0].length)
        .replace(/^[\s,]+/, '')
        .replace(/^г\.?\s*,?\s*/i, '');
      if (rest) return rest;
    }
  }
  return address;
}

function productUrl(product) {
  return productUrlFor(product, state.store);
}

function productUrlFor(product, store) {
  const params = new URLSearchParams();
  if (store) {
    params.set('shopCode', store.code);
    if (store.type) params.set('shopType', `STORE_TYPE_${store.type}`);
  }
  const id = encodeURIComponent(product.id || product.productId || '');
  const seo = encodeURIComponent(product.seoCode || '');
  return `https://magnit.ru/product/${id}-${seo}?${params.toString()}`;
}

/* ---------------------------------------------------------------- favorites */

let favorites = [];

function favoriteKey(product) {
  const storeCode = (product && product.storeCode) || (state.store && state.store.code) || '';
  const id = (product && (product.id || product.productId || product.seoCode || product.name)) || '';
  return `${storeCode}|${id}`;
}

function favoriteSnapshot(product) {
  return {
    id: product.id || '',
    productId: product.productId || '',
    name: product.name || '',
    seoCode: product.seoCode || '',
    price: Number(product.price) || 0,
    oldPrice: product.oldPrice || null,
    discount: product.discount || null,
    image: product.image || '',
    unitPrice: product.unitPrice || null,
    unitLabel: product.unitLabel || '',
    stock: Number(product.stock) || 0,
    lowStock: Boolean(product.lowStock),
  };
}

function storeSnapshot(store) {
  return {
    code: store.code,
    address: store.address,
    type: store.type || '',
    city: state.city ? state.city.city : '',
  };
}

function loadFavorites() {
  const raw = load(LS_FAV);
  favorites = Array.isArray(raw)
    ? raw.filter((item) => item && item.key && item.product && item.store)
    : [];
  updateFavBadge();
}

function persistFavorites() {
  save(LS_FAV, favorites);
  updateFavBadge();
}

function isFavorite(product) {
  const key = favoriteKey(product);
  return favorites.some((item) => item.key === key);
}

function updateFavBadge() {
  const count = favorites.length;
  favCount.textContent = String(count);
  favCount.hidden = count === 0;
  favToggle.setAttribute('aria-label', count
    ? `Корзина: ${count} ${plural(count, 'товар', 'товара', 'товаров')}`
    : 'Корзина');
}

function updateCardFavButtons() {
  for (const button of results.querySelectorAll('.fav-btn')) {
    const active = favorites.some((item) => item.key === button.dataset.fav);
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
    button.title = active ? 'Убрать из избранного' : 'В избранное';
  }
}

function toggleFavorite(product) {
  if (!product) return;
  const key = favoriteKey(product);
  const index = favorites.findIndex((item) => item.key === key);

  if (index >= 0) {
    favorites.splice(index, 1);
    toast('Удалено из корзины');
  } else {
    favorites.push({
      key,
      product: favoriteSnapshot(product),
      store: storeSnapshot(state.store || { code: product.storeCode || '', address: '', type: '' }),
      addedAt: Date.now(),
      checkedAt: Date.now(),
      missing: false,
    });
    toast('Добавлено в корзину');
  }

  persistFavorites();
  updateCardFavButtons();
  if (!favLayer.hidden) renderFavorites();
}

function favoriteDate(timestamp) {
  try {
    return new Date(timestamp).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  } catch (e) {
    return '';
  }
}

function favoriteStock(product, missing) {
  if (missing) return '<span class="fav-stock none">нет в продаже</span>';
  const stock = Number(product.stock) || 0;
  if (stock <= 0) return '<span class="fav-stock none">нет в наличии</span>';
  const low = product.lowStock || stock <= 5;
  return `<span class="fav-stock${low ? ' low' : ''}">${low ? 'мало' : 'в наличии'}: ${nf0.format(stock)} шт.</span>`;
}

function renderFavorites() {
  const count = favorites.length;
  const total = favorites.reduce((sum, item) => sum + (Number(item.product.price) || 0), 0);

  favHint.textContent = count
    ? `${count} ${plural(count, 'товар', 'товара', 'товаров')} · ${money(total)}`
    : 'Пока пусто';
  favClear.disabled = !count;

  if (!count) {
    favList.innerHTML = `
      <div class="fav-empty">
        <strong>Корзина пустая</strong>
        Нажмите ★ на карточке товара — он сохранится здесь вместе с ценой, остатком и магазином.
      </div>`;
    return;
  }

  const groups = new Map();
  for (const item of favorites) {
    const code = item.store.code || 'unknown';
    if (!groups.has(code)) groups.set(code, { store: item.store, items: [] });
    groups.get(code).items.push(item);
  }

  const sections = [];
  for (const group of groups.values()) {
    const store = group.store;
    const label = [store.city, store.address].filter(Boolean).join(' · ') || 'Магазин';
    const rows = group.items.map((item) => {
      const product = item.product;
      const image = product.image
        ? `<img src="${esc(product.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
        : '<span class="fav-noimg">нет фото</span>';
      const unit = product.unitPrice
        ? ` · ${money(product.unitPrice)} / ${esc(unitName(product.unitLabel))}`
        : '';
      const old = product.oldPrice && product.oldPrice > product.price
        ? ` <span class="muted">${money(product.oldPrice)}</span>` : '';
      const missing = item.missing === true;
      return `
        <div class="fav-item${missing ? ' is-missing' : ''}" data-key="${esc(item.key)}">
          <div class="fav-thumb">${image}</div>
          <div class="fav-main">
            <span class="fav-name">${esc(product.name)}</span>
            <span class="fav-sub">${esc(favoriteDate(item.addedAt))}${unit}</span>
            <span class="fav-price">${money(product.price)}${old}</span>
            ${favoriteStock(product, missing)}
          </div>
          <div class="fav-side">
            <button type="button" class="fav-add" data-open="${esc(item.key)}">В магазин</button>
            <button type="button" class="fav-del" data-del="${esc(item.key)}" aria-label="Убрать из избранного">×</button>
          </div>
        </div>`;
    }).join('');

    sections.push(`<div class="fav-group-title">${esc(label)}</div>${rows}`);
  }

  const missingCount = favorites.filter((item) => item.missing === true).length;
  const note = missingCount
    ? `Проверено ${favoriteCheckedText()}. Не найдено в магазине: ${missingCount} ${plural(missingCount, 'товар', 'товара', 'товаров')}.`
    : 'Остатки и цены проверены в магазине. Нажмите «Проверить цены», чтобы обновить.';
  sections.push(`<div class="fav-note">${esc(note)}</div>`);
  favList.innerHTML = sections.join('');
}

function favoriteCheckedText() {
  let last = 0;
  for (const item of favorites) if (item.checkedAt) last = Math.max(last, item.checkedAt);
  if (!last) return 'при добавлении';
  try {
    return new Date(last).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return 'при добавлении';
  }
}

function openFavorites() {
  renderFavorites();
  favLayer.hidden = false;
  favToggle.setAttribute('aria-expanded', 'true');
  document.body.classList.add('fav-open');
}

async function refreshFavoritePrices() {
  if (!favorites.length || favRetry.disabled) return;

  const label = favRetry.textContent;
  favRetry.disabled = true;
  favRetry.textContent = 'Проверяем…';

  try {
    const groups = new Map();
    for (const item of favorites) {
      const code = item.store.code || '';
      if (!groups.has(code)) groups.set(code, []);
      groups.get(code).push(item);
    }

    for (const [code, items] of groups) {
      const names = [...new Set(items.map((item) => item.product.name))].slice(0, 20);
      const found = new Map();

      for (const name of names) {
        try {
          const data = await API.products({ store: code, q: name, limit: 50 });
          for (const product of data.items || []) {
            const key = `${product.id}|${product.seoCode}`;
            if (!found.has(key)) found.set(key, product);
          }
        } catch (err) {
          /* keep the stored values when the lookup fails */
        }
      }

      for (const item of items) {
        const product = [...found.values()].find((candidate) =>
          candidate.id === item.product.id ||
          (candidate.seoCode && candidate.seoCode === item.product.seoCode));
        if (product) {
          item.product.price = Number(product.price) || item.product.price;
          item.product.oldPrice = product.oldPrice || null;
          item.product.discount = product.discount || null;
          item.product.stock = Number(product.stock) || 0;
          item.product.lowStock = Boolean(product.lowStock);
          item.product.image = product.image || item.product.image;
          item.product.unitPrice = product.unitPrice || item.product.unitPrice;
          item.product.unitLabel = product.unitLabel || item.product.unitLabel;
          item.missing = false;
        } else {
          item.missing = true;
        }
        item.checkedAt = Date.now();
      }
    }

    persistFavorites();
    renderFavorites();
    toast('Цены и остатки обновлены');
  } catch (err) {
    toast('Не удалось обновить цены');
  } finally {
    favRetry.disabled = false;
    favRetry.textContent = label;
  }
}

function closeFavorites() {
  if (favLayer.hidden) return;
  favLayer.hidden = true;
  favToggle.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('fav-open');
  favToggle.focus();
}

function productCard(product, isCheapest) {
  const badges = (product.badges || []).slice(0, 2)
    .map((b) => `<span class="badge" title="${esc(b)}">${esc(b)}</span>`).join('');

  const discount = product.discount
    ? `<span class="disc">−${esc(product.discount)}%</span>` : '';

  const oldPrice = product.oldPrice && product.oldPrice > product.price
    ? `<span class="old">${money(product.oldPrice)}</span>` : '';

  const unit = product.unitPrice
    ? `<div class="unit">${money(product.unitPrice)} / ${esc(unitName(product.unitLabel))}</div>` : '';

  const rating = product.rating
    ? `<span class="rating"><span class="star">★</span> ${nf1.format(product.rating)}</span>` : '';

  const reviews = product.reviews
    ? `<span>${nf0.format(product.reviews)} ${plural(product.reviews, 'отзыв', 'отзыва', 'отзывов')}</span>` : '';

  const stock = product.stock > 0
    ? `<span class="stock${product.lowStock || product.stock <= 5 ? ' low' : ''}">
         ${product.lowStock || product.stock <= 5 ? 'Мало' : 'В наличии'}: ${nf0.format(product.stock)} шт.
       </span>`
    : '<span class="stock low">Нет в наличии</span>';

  const image = product.image
    ? `<img src="${esc(product.image)}" alt="" loading="lazy" referrerpolicy="no-referrer"
            onerror="this.style.display='none';this.parentNode.insertAdjacentHTML('beforeend','<span class=&quot;noimg&quot;>нет фото</span>')">`
    : '<span class="noimg">нет фото</span>';

  const favorite = isFavorite(product);
  const favoriteId = favoriteKey(product);

  return `<article class="card${isCheapest ? ' is-cheapest' : ''}" data-href="${esc(productUrl(product))}" tabindex="0" role="link">
    ${isCheapest ? '<span class="card-ribbon">самый дешёвый</span>' : ''}
    <div class="thumb">${image}${discount}
      <button type="button" class="fav-btn${favorite ? ' is-active' : ''}" data-fav="${esc(favoriteId)}"
              aria-pressed="${favorite}" aria-label="${favorite ? 'Убрать из избранного' : 'В избранное'}"
              title="${favorite ? 'Убрать из избранного' : 'В избранное'}">★</button>
    </div>
    <div class="card-body">
      <h3 class="card-name">${esc(product.name)}</h3>
      <div class="card-meta">${rating}${reviews}</div>
      <div class="badges">${badges}</div>
      <div class="price-row">
        <span class="price">${money(product.price)}</span>
        ${oldPrice}
      </div>
      ${unit}
      <div class="card-meta">${stock}</div>
    </div>
  </article>`;
}

function renderResults() {
  compareResults.hidden = true;
  moreWrap.hidden = !state.hasMore;

  if (!state.items.length) {
    renderEmpty(`
      <h3>Ничего не нашлось</h3>
      <p>Попробуйте другой запрос, другую категорию или магазин с более широким ассортиментом.</p>`);
    statusBar.hidden = true;
    return;
  }

  const cheapest = state.items.reduce((min, p) => (p.price < min.price ? p : min), state.items[0]);
  const canMarkCheapest = state.sort === 'price_asc';

  results.innerHTML = state.items
    .map((product) => productCard(product, canMarkCheapest && product === cheapest))
    .join('');

  statusBar.hidden = false;
  statusBar.innerHTML = `
    <div>
      Найдено <b>${nf0.format(state.total)}</b> ${plural(state.total, 'товар', 'товара', 'товаров')}
      · минимум <b>${money(cheapest.price)}</b>
    </div>
    <div class="status-pills">
      ${state.city ? `<span class="pill">${esc(state.city.city)}</span>` : ''}
      <span class="pill pill-store" title="${esc(state.store ? state.store.address : '')}"><span class="dot"></span>${esc(storeLabel(state.store))}</span>
    </div>`;
}

/* --------------------------------------------------------------- searching */

function setBusy(busy) {
  state.loading = busy;
  searchBtn.disabled = busy;
  moreBtn.disabled = busy;
}

async function runSearch(options = {}) {
  const more = Boolean(options.more);
  if (!state.store) {
    toast('Сначала выберите магазин');
    return;
  }

  const query = queryInput.value.trim();
  state.query = query;
  state.page = more ? state.page + 1 : 1;

  if (more && state.loading) return;
  if (!more) {
    state.items = [];
    renderSkeletons();
  }

  setBusy(true);
  try {
    const data = await API.products({
      store: state.store.code,
      q: state.query,
      cat: state.categoryId,
      sort: state.sort,
      page: state.page,
      limit: PAGE_LIMIT,
    });

    state.items = more ? state.items.concat(data.items || []) : (data.items || []);
    state.total = data.total || 0;
    state.hasMore = Boolean(data.hasMore) && state.items.length < (data.total || 0);
    renderResults();
  } catch (err) {
    if (more) {
      state.page = Math.max(1, state.page - 1);
      toast(err.message);
    } else {
      renderEmpty(`<h3>Не удалось загрузить товары</h3><p>${esc(err.message)}</p>`);
      statusBar.hidden = true;
    }
  } finally {
    setBusy(false);
  }
}

/* -------------------------------------------------------------- comparison */

const compareState = { running: false, controller: null };

function renderCompareIntro() {
  compareResults.hidden = false;
  results.innerHTML = '';
  moreWrap.hidden = true;
  statusBar.hidden = true;
  compareResults.innerHTML = `
    <div class="empty">
      <h3>Сравнение цен по магазинам города</h3>
      <p>Введите название товара и нажмите «Сравнить цены». Сервис опросит магазины города
         и покажет, где товар дешевле всего.</p>
      <div class="chips">
        ${SUGGESTIONS.map((s) => `<button type="button" class="chip" data-q="${esc(s)}">${esc(s)}</button>`).join('')}
      </div>
    </div>`;
}

function compareProgress(done, total, query, aborted) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  statusBar.hidden = false;
  statusBar.innerHTML = `
    <div>
      ${aborted ? 'Останавливаем' : 'Опрашиваем магазины'}: <b>${done}</b> из ${nf0.format(total)}
      ${query ? `· «${esc(query)}»` : ''}
    </div>
    <div class="status-pills">
      ${state.city ? `<span class="pill">${esc(state.city.city)}</span>` : ''}
    </div>
    <div class="progress"><div style="width:${percent}%"></div></div>`;
}

async function runCompare() {
  if (compareState.running) return;
  if (!state.city) { toast('Сначала выберите город'); return; }
  if (!state.stores.length) { toast('Список магазинов города ещё загружается'); return; }

  const query = queryInput.value.trim();
  if (!query) { toast('Введите название товара для сравнения'); return; }

  const limit = Number(compareCountSelect.value) || 20;
  const stores = state.stores.slice(0, limit);
  const cityId = state.city.id;
  const controller = new AbortController();

  compareState.running = true;
  compareState.controller = controller;

  compareBtn.disabled = true;
  compareCancel.hidden = false;
  compareResults.hidden = false;
  compareResults.innerHTML = '';
  results.innerHTML = '';
  moreWrap.hidden = true;

  const map = new Map();
  const queue = stores.slice();
  let done = 0;
  let failed = 0;

  compareProgress(done, stores.length, query, false);

  const worker = async () => {
    while (queue.length && !controller.signal.aborted) {
      const store = queue.shift();
      try {
        const data = await API.products({
          store: store.code,
          q: query,
          sort: 'price_asc',
          limit: 50,
        }, controller.signal);

        for (const product of data.items || []) {
          const key = product.seoCode || `${product.name}|${product.id}`;
          let entry = map.get(key);
          if (!entry) {
            entry = { sample: product, offers: [] };
            map.set(key, entry);
          }
          entry.offers.push({
            store,
            price: product.price,
            oldPrice: product.oldPrice,
            discount: product.discount,
          });
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        failed += 1;
      }
      done += 1;
      compareProgress(done, stores.length, query, controller.signal.aborted);
    }
  };

  await Promise.all([worker(), worker(), worker(), worker()]);

  const aborted = controller.signal.aborted;
  compareState.running = false;
  compareState.controller = null;
  compareBtn.disabled = false;
  compareCancel.hidden = true;

  if (!state.city || state.city.id !== cityId) return;

  const list = Array.from(map.values()).map((entry) => {
    entry.offers.sort((a, b) => a.price - b.price);
    entry.min = entry.offers[0].price;
    entry.max = entry.offers[entry.offers.length - 1].price;
    entry.best = entry.offers[0];
    return entry;
  }).sort((a, b) => a.min - b.min);

  renderCompareResults(list, done, stores.length, query, aborted, failed);
}

function renderCompareResults(list, checked, planned, query, aborted, failed) {
  compareResults.hidden = false;
  results.innerHTML = '';
  moreWrap.hidden = true;

  if (!list.length) {
    statusBar.hidden = true;
    compareResults.innerHTML = `
      <div class="empty">
        <h3>${aborted ? 'Сравнение остановлено' : 'Ничего не нашлось'}</h3>
        <p>${aborted
          ? 'Вы остановили сравнение до того, как пришли результаты. Запустите его снова или выберите больше магазинов.'
          : `По запросу «${esc(query)}» не удалось найти товары в проверенных магазинах.
             Попробуйте другой запрос или больше магазинов.`}</p>
      </div>`;
    return;
  }

  statusBar.hidden = false;
  const failedNote = failed
    ? ` · <span class="muted">${failed} ${plural(failed, 'магазин', 'магазина', 'магазинов')} не ответил${failed === 1 ? '' : 'и'}</span>`
    : '';
  statusBar.innerHTML = `
    <div>
      Сравнили <b>${checked}</b> ${plural(checked, 'магазин', 'магазина', 'магазинов')}
      ${aborted ? `из ${nf0.format(planned)} (остановлено)` : ''}
      · товаров: <b>${nf0.format(list.length)}</b> · «${esc(query)}»${failedNote}
    </div>
    <div class="status-pills">
      ${state.city ? `<span class="pill">${esc(state.city.city)}</span>` : ''}
      <span class="pill">от ${money(list[0].min)}</span>
    </div>`;

  compareResults.innerHTML = list.map((entry) => {
    const product = entry.sample;
    const best = entry.best;
    const count = entry.offers.length;

    const image = product.image
      ? `<img src="${esc(product.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : '';

    const rating = product.rating
      ? `<span class="rating"><span class="star">★</span> ${nf1.format(product.rating)}</span>` : '';

    const saving = entry.max > entry.min
      ? `<span class="tag-best">экономия до ${money(entry.max - entry.min)}</span>`
      : '';

    const offers = entry.offers.map((offer, index) => `
      <div class="offer${index === 0 ? ' is-best' : ''}">
        <span class="addr">
          ${esc(offer.store.address)}
          <span class="type">· ${esc(storeTypeLabel(offer.store.type))}</span>
        </span>
        <span class="cost">
          ${money(offer.price)}
          ${offer.discount ? `<span class="old">−${esc(offer.discount)}%</span>` : ''}
        </span>
      </div>`).join('');

    return `<details class="cmp">
      <summary>
        <div class="cmp-thumb">${image}</div>
        <div class="cmp-main">
          <span class="cmp-name">${esc(product.name)}</span>
          <span class="cmp-sub">
            <span class="tag-best">${count} ${plural(count, 'магазин', 'магазина', 'магазинов')}</span>
            ${rating}
            ${saving}
            <span>дешевле всего: ${esc(shortAddress(best.store.address))}</span>
          </span>
        </div>
        <div class="cmp-price">
          <span class="now">${money(entry.min)}</span>
          <span class="range">${entry.max > entry.min
            ? 'до ' + money(entry.max)
            : (count > 1 ? 'одинаковая цена' : '')}</span>
        </div>
      </summary>
      <div class="cmp-body">${offers}</div>
    </details>`;
  }).join('');
}

/* ------------------------------------------------------------------- modes */

function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.mode === mode);
  });

  const compare = mode === 'compare';
  compareControls.hidden = !compare;
  storeField.hidden = compare;
  storeField.closest('.panel-row').classList.toggle('row-city-only', compare);
  categoryField.hidden = compare;
  sortSelect.closest('.field').hidden = compare;
  searchBtn.hidden = compare;
  queryInput.placeholder = compare
    ? 'Что сравнить по магазинам города?'
    : 'Например: молоко, сыр, кофе';

  if (compare) {
    closeMap();
    moreWrap.hidden = true;
    results.innerHTML = '';
    statusBar.hidden = true;
    renderCompareIntro();
  } else {
    compareResults.hidden = true;
    statusBar.hidden = true;
    state.query = queryInput.value.trim();
    renderStart();
    if (state.query || state.categoryId) runSearch();
  }
}

/* ------------------------------------------------------------------ events */

document.querySelectorAll('.mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

searchBtn.addEventListener('click', () => runSearch());
moreBtn.addEventListener('click', () => runSearch({ more: true }));

queryInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (state.mode === 'compare') runCompare();
    else runSearch();
  }
});

sortSelect.addEventListener('change', () => {
  state.sort = sortSelect.value;
  if (state.items.length) runSearch();
});

compareBtn.addEventListener('click', runCompare);
compareCancel.addEventListener('click', () => {
  if (compareState.controller) compareState.controller.abort();
});

results.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (chip) {
    queryInput.value = chip.dataset.q || '';
    resetCategoryDisplay();
    if (state.mode === 'compare') runCompare();
    else runSearch();
    return;
  }
  const favButton = event.target.closest('.fav-btn');
  if (favButton) {
    const product = state.items.find((item) => favoriteKey(item) === favButton.dataset.fav);
    if (product) toggleFavorite(product);
    return;
  }
  const card = event.target.closest('.card');
  if (card && card.dataset.href) {
    window.open(card.dataset.href, '_blank', 'noopener');
  }
});

results.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (event.target.closest('.fav-btn')) return;
  const card = event.target.closest('.card');
  if (card && card.dataset.href) {
    event.preventDefault();
    window.open(card.dataset.href, '_blank', 'noopener');
  }
});

favToggle.addEventListener('click', () => {
  if (favLayer.hidden) openFavorites();
  else closeFavorites();
});
favClose.addEventListener('click', closeFavorites);
favBackdrop.addEventListener('click', closeFavorites);
favRetry.addEventListener('click', refreshFavoritePrices);

favClear.addEventListener('click', () => {
  if (!favorites.length) return;
  if (!window.confirm('Очистить корзину?')) return;
  favorites = [];
  persistFavorites();
  updateCardFavButtons();
  renderFavorites();
  toast('Корзина очищена');
});

favList.addEventListener('click', (event) => {
  const remove = event.target.closest('[data-del]');
  if (remove) {
    favorites = favorites.filter((item) => item.key !== remove.dataset.del);
    persistFavorites();
    updateCardFavButtons();
    renderFavorites();
    return;
  }

  const open = event.target.closest('[data-open]');
  if (open) {
    const item = favorites.find((entry) => entry.key === open.dataset.open);
    if (item) window.open(productUrlFor(item.product, item.store), '_blank', 'noopener');
  }
});

window.addEventListener('storage', (event) => {
  if (event.key !== LS_FAV) return;
  loadFavorites();
  updateCardFavButtons();
  if (!favLayer.hidden) renderFavorites();
});

compareResults.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (chip) {
    queryInput.value = chip.dataset.q || '';
    runCompare();
  }
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('#cityCombo')) cityList.hidden = true;
  if (!event.target.closest('#storeCombo')) {
    storeList.hidden = true;
    if (state.store && !storeInput.disabled) storeInput.value = storeLabel(state.store);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeLists();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || favLayer.hidden) return;
  event.stopPropagation();
  closeFavorites();
});

/* -------------------------------------------------------------------- init */

async function init() {
  loadFavorites();

  if (location.protocol === 'file:') {
    renderEmpty(`
      <h3>Сайт нужно запускать через локальный сервер</h3>
      <p>Вы открыли файл напрямую, а браузеру нужен сервер для запросов к Магниту.
         Закройте эту вкладку и запустите <b>start.bat</b> из папки проекта.</p>`);
    compareControls.hidden = true;
    return;
  }

  state.sort = sortSelect.value;

  try {
    const health = await api('/api/health');
    if (!health || !health.ok) throw new Error('Сервер не отвечает');
  } catch (err) {
    renderEmpty(`
      <h3>Локальный сервер не отвечает</h3>
      <p>Запустите <b>start.bat</b> (или <code>server.ps1</code>) и обновите страницу.</p>`);
    return;
  }

  sortSelect.closest('.field').hidden = false;
  categoryField.hidden = false;

  const savedCity = load(LS_CITY);
  if (savedCity && savedCity.id) {
    state.city = savedCity;
    cityInput.value = savedCity.city || '';
    await loadStores();
  } else {
    await pickCityByName('Москва');
  }
}

init();
