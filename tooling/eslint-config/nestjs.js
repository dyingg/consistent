import base from "./base.js";

// NestJS apps inherit the base rules — including the `any` ban. The previous
// blanket "off" override has been removed; reach for `unknown` first, then
// for a per-line eslint-disable with a reason if the third-party shape really
// can't be typed.
export default [...base];
