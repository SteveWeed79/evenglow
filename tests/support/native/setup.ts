/**
 * What React needs to believe before it will let a test drive it.
 *
 * `IS_REACT_ACT_ENVIRONMENT` is React's own switch for "this is a test, batch
 * my updates and let `act()` flush them". Without it every state change from a
 * press warns and some do not flush at all, which reads as a screen that
 * ignored the tap.
 */
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * `react-test-renderer` announces its own deprecation on every mount.
 *
 * It is deprecated in favour of `@testing-library/react-native`, which is a
 * wrapper around it plus a jest preset this project does not use. The warning
 * is real and the replacement is not obviously better here, so it is silenced
 * rather than hidden: when the library is finally removed from React, these
 * tests will fail loudly instead of quietly, which is the right failure.
 */
const warn = console.warn.bind(console);
console.warn = (...args: unknown[]): void => {
  if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) return;
  warn(...args);
};

const error = console.error.bind(console);
console.error = (...args: unknown[]): void => {
  if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) return;
  error(...args);
};

export {};
