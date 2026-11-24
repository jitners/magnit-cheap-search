'use strict';

const { getStores, makeHandler } = require('../lib/magnit');

module.exports = makeHandler(
  (query) => getStores(query.city),
  900
);
