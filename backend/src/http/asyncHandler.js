// Express 5 forwards a rejected promise to the error handler on its own, so
// this exists only to make the intent explicit at each route and to keep the
// routes readable if the framework is ever swapped.
export const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);
