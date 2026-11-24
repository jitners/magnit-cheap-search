'use strict';

// Shared Magnit upstream client for the serverless (Vercel) deployment.
// The local PowerShell server keeps working as before; this is a port of it.

const BASE_URL = 'https://magnit.ru';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEADERS = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
  'x-device-platform': 'Web',
  'x-delivery-type': 'DELIVERY_TYPE_PICKUP',
};

const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value, ttlSeconds) {
  if (cache.size > 400) cache.clear();
  cache.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  return value;
}

function upstreamError(status, details) {
  const err = new Error('Magnit API error: ' + status + (details ? ' ' + details : ''));
  err.status = 502;
  return err;
}

async function upstream(method, path, body) {
  const options = {
    method,
    headers: { ...HEADERS },
    signal: AbortSignal.timeout(25000),
  };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(BASE_URL + path, options);
  const text = await response.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch (e) { json = null; }
  }
  return { status: response.status, text, json };
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value) {
  return Math.round(number(value) ) / 100;
}

/* ------------------------------------------------------------------- cities */

async function getCities(query, limit) {
  let size = Math.trunc(number(limit, 15));
  if (size < 1 || size > 50) size = 15;
  const q = String(query || '').trim();

  const key = `cities|${q}|${size}`;
  const hit = cacheGet(key);
  if (hit) return hit;

  let path = `/webgate/v1/cities?pagination.limit=${size}`;
  if (q) path += '&query=' + encodeURIComponent(q);

  const response = await upstream('GET', path);
  if (response.status !== 200 || !response.json) throw upstreamError(response.status);

  const items = (response.json.data || []).map((city) => ({
    id: String(city.id || ''),
    city: String(city.city || ''),
    region: String(city.region || ''),
    area: String(city.area || ''),
  }));

  return cacheSet(key, { total: number(response.json.total), items }, 3600);
}

/* ------------------------------------------------------------------- stores */

async function getStores(cityId) {
  if (!cityId) {
    const err = new Error('city is required');
    err.status = 400;
    throw err;
  }

  const key = `stores|${cityId}`;
  const hit = cacheGet(key);
  if (hit) return hit;

  const all = [];
  let offset = 0;
  let total = 0;

  for (let page = 0; page < 4; page += 1) {
    const body = {
      filters: {
        cityFIASID: cityId,
        deliveryTypeList: ['DELIVERY_TYPE_PICKUP'],
        storeTypeListV2: ['MM', 'MM_MINI', 'GM', 'MC', 'ME', 'V1', 'MO'],
      },
      pagination: { offset, size: 500 },
      sorting: { sortBy: 'SORT_BY_CITY', sortType: 'SORT_TYPE_ASC' },
    };

    const response = await upstream('POST', '/webgate/v1/stores-facade/search/detail', body);
    if (response.status !== 200 || !response.json) throw upstreamError(response.status);

    total = number(response.json.totalCount);
    let batch = 0;
    for (const store of response.json.data || []) {
      batch += 1;
      const coordinates = store.coordinates || {};
      all.push({
        code: String((store.externalId || {}).storeCode || ''),
        address: String(store.address || ''),
        type: String(store.storeTypeV2 || ''),
        lat: coordinates.latitude === undefined ? null : coordinates.latitude,
        lng: coordinates.longitude === undefined ? null : coordinates.longitude,
        delivery: Array.isArray(store.deliveryTypeList) ? store.deliveryTypeList : [],
      });
    }

    offset += 500;
    if (all.length >= total || batch === 0) break;
  }

  all.sort((a, b) => a.address.localeCompare(b.address, 'ru'));

  return cacheSet(key, { total, items: all }, 900);
}

/* --------------------------------------------------------------- categories */

function convertCategory(category, depth) {
  const children = [];
  if (depth < 3 && Array.isArray(category.children)) {
    for (const child of category.children) {
      children.push(convertCategory(child, depth + 1));
    }
  }
  return {
    id: category.id,
    name: String(category.name || ''),
    children,
  };
}

async function getCategories(storeCode) {
  if (!storeCode) {
    const err = new Error('store is required');
    err.status = 400;
    throw err;
  }

  const key = `categories|${storeCode}`;
  const hit = cacheGet(key);
  if (hit) return hit;

  const path = `/webgate/v3/categories/store/${encodeURIComponent(storeCode)}?storetype=1&catalogtype=1`;
  const response = await upstream('GET', path);
  if (response.status !== 200 || !response.json) throw upstreamError(response.status);

  const items = (response.json.items || []).map((category) => convertCategory(category, 0));
  return cacheSet(key, { items }, 3600);
}

/* ----------------------------------------------------------------- products */

function convertProduct(item) {
  const price = money(item.price);

  let oldPrice = null;
  let discount = null;
  if (item.promotion) {
    if (item.promotion.oldPrice) oldPrice = money(item.promotion.oldPrice);
    if (item.promotion.discountPercent) discount = Math.trunc(number(item.promotion.discountPercent));
  }

  let image = '';
  for (const entry of item.gallery || []) {
    if (entry && entry.type === 'IMAGE' && entry.url) {
      image = String(entry.url);
      break;
    }
  }

  let rating = null;
  let reviews = 0;
  if (item.ratings) {
    if (item.ratings.rating !== undefined && item.ratings.rating !== null) rating = Number(item.ratings.rating);
    if (item.ratings.commentsCount !== undefined && item.ratings.commentsCount !== null) reviews = Math.trunc(number(item.ratings.commentsCount));
  }

  let weighted = false;
  let unitPrice = null;
  let unitLabel = null;
  if (item.weighted) {
    weighted = Boolean(item.weighted.isWeighted);
    if (item.weighted.unitPrice !== undefined && item.weighted.unitPrice !== null) unitPrice = money(item.weighted.unitPrice);
    if (item.weighted.unitLabel) unitLabel = String(item.weighted.unitLabel);
    if (item.weighted.shelfLabel) unitLabel = String(item.weighted.shelfLabel);
  }

  const badges = [];
  for (const badge of item.badges || []) {
    if (badge && badge.text) badges.push(String(badge.text));
  }

  return {
    id: String(item.id || ''),
    productId: String(item.productId || ''),
    name: String(item.name || ''),
    seoCode: String(item.seoCode || ''),
    price,
    oldPrice,
    discount,
    image,
    rating,
    reviews,
    stock: Math.trunc(number(item.quantity)),
    lowStock: Boolean(item.isLowStock),
    weighted,
    unitPrice,
    unitLabel,
    badges,
    storeCode: String(item.storeCode || ''),
  };
}

const SORT_MAP = {
  price_asc: ['asc', 'price'],
  price_desc: ['desc', 'price'],
  discount: ['desc', 'discount'],
  popularity: ['desc', 'popularity'],
  rating: ['desc', 'rating'],
  new: ['desc', 'date_added'],
};

async function getProducts(params) {
  const storeCode = params.store;
  if (!storeCode) {
    const err = new Error('store is required');
    err.status = 400;
    throw err;
  }

  const query = params.q || '';
  const categoryId = params.cat || '';
  const sort = params.sort || 'price_asc';
  let page = Math.trunc(number(params.page, 1));
  let limitValue = Math.trunc(number(params.limit, 24));
  if (page < 1) page = 1;
  if (limitValue < 1 || limitValue > 50) limitValue = 24;

  const pair = SORT_MAP[sort] || SORT_MAP.price_asc;
  const offset = (page - 1) * limitValue;

  const key = `products|${storeCode}|${query}|${categoryId}|${sort}|${page}|${limitValue}`;
  const hit = cacheGet(key);
  if (hit) return hit;

  const body = {
    storeCode,
    storeType: '1',
    catalogType: '1',
    sort: { order: pair[0], type: pair[1] },
    pagination: { limit: limitValue, offset },
    includeAdultGoods: true,
  };
  if (query) body.term = query;
  if (categoryId) {
    const numericId = Number(categoryId);
    if (Number.isFinite(numericId)) body.categories = [Math.trunc(numericId)];
  }
  if (!query && !categoryId) body.correctQuery = true;

  const response = await upstream('POST', '/webgate/v2/goods/search', body);
  if (response.status !== 200 || !response.json) {
    const details = response.json && response.json.message ? String(response.json.message) : '';
    throw upstreamError(response.status, details);
  }

  const items = (response.json.items || []).map(convertProduct);
  const pagination = response.json.pagination;

  return cacheSet(key, {
    items,
    total: pagination ? number(pagination.totalCount) : items.length,
    limit: limitValue,
    page,
    offset,
    hasMore: pagination ? Boolean(pagination.hasMore) : false,
  }, 180);
}

/* ---------------------------------------------------------------- responses */

function sendJson(res, status, data, ttlSeconds) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (ttlSeconds) {
    res.setHeader('Cache-Control', `public, s-maxage=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 2}`);
  } else {
    res.setHeader('Cache-Control', 'no-store');
  }
  res.end(JSON.stringify(data));
}

function makeHandler(loader, ttlSeconds) {
  return async function handler(req, res) {
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
      res.end();
      return;
    }
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    try {
      const data = await loader(req.query || {});
      sendJson(res, 200, data, ttlSeconds);
    } catch (err) {
      sendJson(res, err.status || 502, { error: err.message || 'Upstream error' });
    }
  };
}

module.exports = {
  getCities,
  getStores,
  getCategories,
  getProducts,
  makeHandler,
  sendJson,
};
