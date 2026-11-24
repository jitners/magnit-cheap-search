'use strict';

const { getCities, makeHandler } = require('../lib/magnit');

module.exports = makeHandler(
  (query) => getCities(query.q || query.query || '', query.limit),
  3600,
  { limitPerMinute: 120 }
);
