const fetch = require("node-fetch");
const AbortController = require("abort-controller");

const DEFAULT_TIMEOUT = 60 * 60 * 1000;

module.exports = (url, { signal, ...options } = {}) => {
  const ms = options.timeout ? options.timeout : DEFAULT_TIMEOUT;
  const controller = new AbortController();
  const promise = fetch(url, { signal: controller.signal, ...options });

  // Abort on timeout
  if (signal) signal.addEventListener("abort", () => controller.abort());
  const timeout = setTimeout(() => controller.abort(), ms);

  return promise
    .finally(() => clearTimeout(timeout))
    .catch((err) => {
      if (err.name == "AbortError") {
        const msg = `Timeout calling: ${options.method ? options.method : "GET"
          } ${url} - timeout=${ms}ms`;
        console.error("ERROR:", msg);
        throw new Error(msg);
      } else throw err;
    });
};
