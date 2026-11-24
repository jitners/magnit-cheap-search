'use strict';

const { getProducts, makeHandler } = require('../lib/magnit');

module.exports = makeHandler(
  (query) => getProducts({
    store: query.store,
    q: query.q,
    cat: query.cat,
    sort: query.sort,
    page: query.page,
    limit: query.limit,
  }),
  180
);
