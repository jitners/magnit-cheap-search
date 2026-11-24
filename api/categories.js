'use strict';

const { getCategories, makeHandler } = require('../lib/magnit');

module.exports = makeHandler(
  (query) => getCategories(query.store),
  3600,
  { limitPerMinute: 60 }
);
